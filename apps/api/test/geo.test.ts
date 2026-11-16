/** Sign-up location suggestion (15 Nov): nearest city and state, and the society within 2 km. */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo } from '@pawsure/db';
import { nearestCity } from '@pawsure/domain';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

let app: ReturnType<typeof createApp>; let token = '';
const auth = () => ({ headers: { authorization: 'Bearer ' + token } });
const near = async (lat: number, lng: number) => { const r = await app.request(`/v1/societies/near?lat=${lat}&lng=${lng}`, auth()); return { status: r.status, body: await r.json() as { city: string | null; state: string | null; society: { id: string; name: string } | null } }; };

beforeAll(async () => {
  const db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  app = createApp({ db, adapters: mockAdapters(), clock: demoClock('2026-11-06T09:00:00+05:30'), pepper: 'test', demoMode: true });
  // A new owner signing up (signed in, no household yet).
  const json = { 'content-type': 'application/json' };
  const otp = await (await app.request('/auth/otp/request', { method: 'POST', headers: json, body: JSON.stringify({ phone: '+919822277001' }) })).json() as { demoCode: string };
  token = ((await (await app.request('/auth/otp/verify', { method: 'POST', headers: json, body: JSON.stringify({ phone: '+919822277001', code: otp.demoCode }) })).json()) as { token: string }).token;
});

describe('Location suggestion at sign-up', () => {
  it('next to Lake Vista CHS in Powai suggests that society in Mumbai, Maharashtra', async () => {
    const r = await near(19.1178, 72.9058);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ city: 'Mumbai', state: 'Maharashtra', society: { id: 'soc_lakevista_mum', name: 'Lake Vista CHS' } });
  });
  it('elsewhere in a listed city suggests the city and state but no society', async () => {
    const r = await near(28.6315, 77.2167); // central Delhi
    expect(r.body).toMatchObject({ city: 'Delhi', state: 'Delhi', society: null });
  });
  it('far from any listed city suggests nothing, and bad input is refused', async () => {
    expect((await near(10.0, 93.0)).body).toMatchObject({ city: null, state: null, society: null });
    expect((await app.request('/v1/societies/near?lat=abc&lng=1', auth())).status).toBe(400);
    expect((await app.request('/v1/societies/near?lat=19.1&lng=72.9')).status).toBe(401); // signed-in only
    expect(nearestCity(19.2, 72.95)?.city).toBe('Thane');
  });
});
