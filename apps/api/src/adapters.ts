import { parseRequestRules, type ParseContext, type ParseResult } from '@pawsure/domain';
/**
 * Vendor adapter interfaces + mock implementations (master prompt §3, §10).
 * No vendor is selected or connected. Mocks record what would be sent; nothing leaves the machine.
 * Swap a mock for a real adapter only when the vendor contract, template approval and credentials exist.
 */
export interface SmsOtpAdapter { send(phone: string, code: string): Promise<{ providerId: string }> }
export interface WhatsAppAdapter { sendTemplate(to: string, template: string, language: 'en' | 'hi' | 'mr', vars: Record<string, string>): Promise<{ messageId: string }> }
export interface VoiceCallAdapter { call(to: string, script: string): Promise<{ callId: string }> }
export interface PushAdapter { push(userId: string, title: string, body: string): Promise<void> }
/**
 * LLM request parser (PS-055, PS-065, PS-125). Must return the structured ParseResult schema only — it never decides
 * eligibility, sends messages, or invents availability, capability or location. Callers enforce the 8-second timeout.
 */
export interface LlmAdapter { mode: 'ok' | 'timeout' | 'down' | 'lowconf'; parse(text: string, ctx: ParseContext, signal: AbortSignal): Promise<ParseResult> }

export interface SentRecord { at: string; channel: 'sms' | 'whatsapp' | 'call' | 'push'; to: string; template: string; body: string }

export function mockAdapters() {
  const outbox: SentRecord[] = [];
  const now = () => new Date().toISOString();
  let seq = 0;
  /** Simulated provider outages (demo and drills): a channel in this set throws like a real vendor error. */
  const outage = new Set<'sms' | 'whatsapp' | 'call' | 'push'>();
  const down = (c: 'sms' | 'whatsapp' | 'call' | 'push') => { if (outage.has(c)) throw new Error(c + '_provider_unavailable'); };
  return {
    outbox, outage,
    sms: { async send(phone, code) { down('sms'); outbox.push({ at: now(), channel: 'sms', to: phone, template: 'OTP-DLT-1', body: `Pawsure code ${code}` }); return { providerId: 'mock-sms-' + ++seq }; } } as SmsOtpAdapter,
    whatsapp: { async sendTemplate(to, template, language, vars) { down('whatsapp'); outbox.push({ at: now(), channel: 'whatsapp', to, template: `${template}:${language}`, body: JSON.stringify(vars) }); return { messageId: 'wamid.mock.' + ++seq }; } } as WhatsAppAdapter,
    voice: { async call(to, script) { down('call'); outbox.push({ at: now(), channel: 'call', to, template: 'IVR-ALERT', body: script }); return { callId: 'call.mock.' + ++seq }; } } as VoiceCallAdapter,
    push: { async push(userId, title, body) { down('push'); outbox.push({ at: now(), channel: 'push', to: userId, template: title, body }); } } as PushAdapter,
    /**
     * Mock LLM: in 'ok' mode it answers with the deterministic rules parser (same schema a real model must return).
     * 'timeout' never answers (the caller's 8 s abort fires), 'down' throws, 'lowconf' returns confidence 0.3.
     * No real model is called; nothing leaves the machine.
     */
    llm: {
      mode: 'ok',
      async parse(text, ctx, signal) {
        if (this.mode === 'down') throw new Error('llm_unavailable');
        if (this.mode === 'timeout') return new Promise<ParseResult>((_, reject) => signal.addEventListener('abort', () => reject(new Error('llm_timeout'))));
        const r = parseRequestRules(text, ctx);
        return { ...r, parser: 'llm', confidence: this.mode === 'lowconf' ? 0.3 : r.confidence };
      }
    } as LlmAdapter
  };
}
export type Adapters = ReturnType<typeof mockAdapters>;
