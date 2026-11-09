/**
 * Vendor failover (master prompt §16 Phase 5, §12): every outbound message is retried once, then sent on a fallback
 * channel, and every attempt is written to delivery_log with a masked recipient. Nothing here decides *whether* to
 * alert — the callers (escalation, incidents, Friend Finder) already did that idempotently.
 *
 * Fallbacks: WhatsApp → SMS · automated call → SMS · SMS OTP → no fallback (the user can ask again) · push → logged only
 * (push has no phone number; the owner's WhatsApp alerts and calls cover critical steps).
 * Real SMS fallback needs DLT-registered templates in India before launch (decision D-29).
 */
import type { Db } from '@pawsure/db';
import { maskPhone } from '@pawsure/domain';
import type { Adapters } from './adapters.js';

const mask = (to: string) => (to.startsWith('+') ? maskPhone(to) : to.replace(/:.*/, ':…'));

export function withFailover(a: Adapters, db: Db): Adapters {
  const log = (channel: string, to: string, template: string, status: string, attempt: number, latency: number, error?: string, fallbackOf?: string) =>
    db.query(`insert into delivery_log(channel, recipient_masked, template, status, attempt, error, latency_ms, fallback_of) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [channel, mask(to), template, status, attempt, error ?? null, Math.round(latency), fallbackOf ?? null]).catch(() => undefined);

  async function attempt<T>(channel: string, to: string, template: string, fn: () => Promise<T>, tries = 2): Promise<T | null> {
    for (let i = 1; i <= tries; i++) {
      const t0 = performance.now();
      try { const r = await fn(); await log(channel, to, template, 'sent', i, performance.now() - t0); return r; }
      catch (e) { await log(channel, to, template, 'failed', i, performance.now() - t0, (e as Error).message.slice(0, 120)); }
    }
    return null;
  }
  const smsFallback = async (from: string, to: string, template: string, text: string) => {
    const r = await attempt('sms', to, template, () => a.sms.send(to, text), 1);
    if (r) await log('sms', to, template, 'fallback_sent', 1, 0, undefined, from);
    else await log(from, to, template, 'gave_up', 0, 0, 'primary and fallback failed');
    return r;
  };

  return {
    ...a,
    sms: { async send(phone, code) { const r = await attempt('sms', phone, 'OTP', () => a.sms.send(phone, code)); if (!r) { await log('sms', phone, 'OTP', 'gave_up', 0, 0, 'no fallback for OTP'); throw new Error('otp_delivery_failed'); } return r; } },
    whatsapp: {
      async sendTemplate(to, template, language, vars) {
        const r = await attempt('whatsapp', to, template, () => a.whatsapp.sendTemplate(to, template, language, vars));
        if (r) return r;
        await smsFallback('whatsapp', to, template, `Pawsure: ${template.replace(/_/g, ' ').toLowerCase()} — please open WhatsApp or the Pawsure app.`);
        return { messageId: 'fallback-sms' };
      }
    },
    voice: {
      async call(to, script) {
        const r = await attempt('call', to, 'IVR-ALERT', () => a.voice.call(to, script));
        if (r) return r;
        await smsFallback('call', to, 'IVR-ALERT', 'Pawsure urgent: ' + script.slice(0, 120));
        return { callId: 'fallback-sms' };
      }
    },
    push: { async push(userId, title, body) { const r = await attempt('push', userId, title, () => a.push.push(userId, title, body).then(() => true)); if (!r) await log('push', userId, title, 'gave_up', 0, 0, 'push unavailable'); } }
  };
}
