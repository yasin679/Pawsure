/** The app must never say a request was understood by AI unless a real AI model is connected. */
import { describe, it, expect } from 'vitest';
import { openDb, migrate, seedDemo } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

async function setup(connected: boolean) {
  const db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  const adapters = mockAdapters(); adapters.llm.connected = connected;
  const app = createApp({ db, adapters, clock: demoClock('2026-11-06T09:00:00+05:30'), pepper: 'test', demoMode: true });
  const call = async <T = Record<string, unknown>>(m: string, p: string, b?: unknown, t?: string) => { const r = await app.request(p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return (await r.json()) as T; };
  const otp = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone: '+919800000021' });
  const token = (await call<{ token: string }>('POST', '/auth/otp/verify', { phone: '+919800000021', code: otp.demoCode })).token;
  return { call, token };
}

describe('how a request was understood is labelled honestly', () => {
  it('no AI connected (the demo and pilot today): “rules (no AI connected)”, and /health says so', async () => {
    const { call, token } = await setup(false);
    expect((await call<{ aiConnected: boolean }>('GET', '/health')).aiConnected).toBe(false);
    const r = await call<{ parsedBy: string; aiConnected: boolean }>('POST', '/v1/households/hh_demo/requests', { text: 'Can someone feed Bruno at 5 pm?' }, token);
    expect(r.parsedBy).toBe('rules (no AI connected)');
    expect(r.aiConnected).toBe(false);
    const m = await call<{ parsedBy: string }>('POST', '/v1/households/hh_demo/requests', { manual: { tasks: ['feed'], petId: 'bruno', time: 1020, access: 'Key handover' } }, token);
    expect(m.parsedBy).toBe('simple form');
  }, 60000);
  it('a real model connected: “AI (structured)”; if it fails, the fallback says rules', async () => {
    const { call, token } = await setup(true);
    expect((await call<{ parsedBy: string }>('POST', '/v1/households/hh_demo/requests', { text: 'Can someone feed Bruno at 5 pm?' }, token)).parsedBy).toBe('AI (structured)');
    await call('POST', '/demo/llm', { mode: 'down' });
    const fb = await call<{ parsedBy: string; needsManualForm?: boolean }>('POST', '/v1/households/hh_demo/requests', { text: 'Can someone feed Bruno at 6 pm?' }, token);
    expect(fb.needsManualForm || fb.parsedBy === 'rules (AI fallback)').toBe(true);
  }, 60000);
});
