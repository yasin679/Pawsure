/** Regressions for issues reported on 11 Nov 2026: OTP resend, login after sign-out, required pet details. */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

const ESS = { food: 'Dry food 150 g at 8 AM and 7 PM', allergies: 'None known', medicines: 'None', vet_name: 'Dr. Rao', vet_phone: '+91 22 5555 0101' };
let call: <T = any>(m: string, p: string, b?: unknown, t?: string) => Promise<{ status: number; body: T }>;
let clock: ReturnType<typeof demoClock>;

beforeAll(async () => {
  const db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  clock = demoClock('2026-11-06T09:00:00+05:30');
  const app = createApp({ db, adapters: mockAdapters(), clock, pepper: 'test', demoMode: true });
  call = async (m, p, b, t) => { const r = await app.request(p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json() }; };
}, 60000);

describe('demo clock', () => {
  it('a live demo clock moves with real time, and set/advance still jump it', async () => {
    const c = demoClock('2026-11-06T09:00:00+05:30', { live: true });
    const a = c.now().getTime(); await new Promise(r => setTimeout(r, 120));
    expect(c.now().getTime() - a).toBeGreaterThanOrEqual(100);
    c.advance(5); expect(c.now().getTime() - a).toBeGreaterThanOrEqual(5 * 60000);
    c.set('2026-11-06T13:00:00+05:30'); expect(Math.abs(c.now().getTime() - new Date('2026-11-06T13:00:00+05:30').getTime())).toBeLessThan(50);
  });
  it('the test clock stays frozen', () => {
    const c = demoClock('2026-11-06T09:00:00+05:30'); const a = c.now().getTime();
    expect(c.now().getTime()).toBe(a);
  });
});

describe('sign-in codes', () => {
  it('a new code can be requested once 30 seconds have passed', async () => {
    const phone = '+919811121212';
    expect((await call('POST', '/auth/otp/request', { phone })).status).toBe(200);
    expect((await call('POST', '/auth/otp/request', { phone })).status).toBe(429);
    clock.advance(0.55); // 33 seconds
    const r = await call<{ demoCode?: string }>('POST', '/auth/otp/request', { phone });
    expect(r.status).toBe(200); expect(r.body.demoCode).toMatch(/^\d{6}$/);
  });
  it('signing out and straight back in is not blocked (used codes don’t count toward the limits)', async () => {
    const phone = '+919800000021';
    for (let i = 0; i < 4; i++) {
      const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone });
      expect(r.status, `sign-in ${i + 1}`).toBe(200);
      const v = await call<{ token: string }>('POST', '/auth/otp/verify', { phone, code: r.body.demoCode });
      await call('POST', '/v1/auth/logout', {}, v.body.token);
    }
  });
  it('unused codes are still limited (abuse protection kept)', async () => {
    const phone = '+919811131313';
    for (let i = 0; i < 3; i++) { expect((await call('POST', '/auth/otp/request', { phone })).status).toBe(200); clock.advance(0.6); }
    expect((await call<{ error: string }>('POST', '/auth/otp/request', { phone })).body.error).toBe('rate_limited');
  });
});

describe('pet details', () => {
  let token: string;
  beforeAll(async () => { clock.advance(1); const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone: '+919800000021' }); token = (await call<{ token: string }>('POST', '/auth/otp/verify', { phone: '+919800000021', code: r.body.demoCode })).body.token; });
  it('a pet needs its essential care and medical details', async () => {
    const r = await call<{ issues: string[] }>('POST', '/v1/households/hh_demo/pets', { name: 'Coco' }, token);
    expect(r.status).toBe(400);
    for (const f of ['food', 'allergies', 'medicines', 'vet_name', 'vet_phone']) expect(r.body.issues.join(' ')).toContain(f);
    expect((await call('POST', '/v1/households/hh_demo/pets', { name: 'Coco', ...ESS }, token)).status).toBe(201);
  });
  it('“None” is a valid answer, but an essential detail can’t be blanked later', async () => {
    expect((await call('PATCH', '/v1/households/hh_demo/pets/bruno', { allergies: 'None' }, token)).status).toBe(200);
    expect((await call('PATCH', '/v1/households/hh_demo/pets/bruno', { vet_phone: '   ' }, token)).status).toBe(400);
  });
});
