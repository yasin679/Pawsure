/**
 * Helper can't come → friend cover end to end (PS-014, PS-061): only the tasks the friend agreed to move to them;
 * other pets' tasks and medicine they weren't asked about stay open and keep escalating.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

let db: Db, app: ReturnType<typeof createApp>, neha: string;
const DAY = '2026-11-06', HH = '/v1/households/hh_demo', MEERA = '+919700000090';
const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as T };
};
const signIn = async (phone: string) => { const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone }); return (await call<{ token: string }>('POST', '/auth/otp/verify', { phone, code: r.body.demoCode })).body.token; };
type Today = { day: { mode: string }; tasks: { id: string; title: string; ev: { state: string } }[] };

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  app = createApp({ db, adapters: mockAdapters(), clock: demoClock(`${DAY}T11:00:00+05:30`), pepper: 'test', demoMode: true });
  neha = await signIn('+919800000021'); await call('POST', '/jobs/tick');
}, 60000);

describe('helper can’t come → a friend covers one task', () => {
  it('moves only the matching task to the friend; the rest stay with the helper and still count', async () => {
    expect((await call('PUT', `${HH}/day`, { helperUnavailable: true }, neha)).status).toBe(200);
    const req = (await call<{ id: string; clarifications: unknown[] }>('POST', `${HH}/requests`, { text: 'Sunita can’t come today. Can someone feed Bruno at 1:00 pm?' }, neha)).body;
    expect(req.clarifications).toEqual([]);
    const s = (await call<{ top: { id: string }[] }>('POST', `${HH}/requests/${req.id}/search`, {}, neha)).body;
    expect(s.top.map(t => t.id)).toContain('u_meera');
    expect((await call('POST', `${HH}/requests/${req.id}/approve`, { friendIds: ['u_meera'], mode: 'one', approved: true }, neha)).status).toBe(200);
    await call('POST', '/webhooks/whatsapp', { from: MEERA, messageId: 'cov-yes', type: 'button', payload: `ff_yes:${req.id}` });
    expect((await call<{ state: string }>('POST', `${HH}/requests/${req.id}/confirm`, { friendId: 'u_meera' }, neha)).body.state).toBe('Confirmed');

    const moved = await db.query<{ id: string }>(`select id from care_tasks where reassigned_to_task_id is not null order by id`);
    expect(moved.map(r => r.id)).toEqual([`r1_${DAY}`]); // Bruno's lunch only
    const today = (await call<Today>('GET', `${HH}/today`, undefined, neha)).body;
    expect(today.day.mode).toBe('friend');
    expect(today.tasks.some(t => t.id === `cover_${req.id}`)).toBe(true);
    const state = (id: string) => today.tasks.find(t => t.id === id)!.ev.state;
    expect(state(`r2_${DAY}`)).not.toBe('Cancelled'); // Bruno's medicine: not asked of Meera
    expect(state(`r3_${DAY}`)).not.toBe('Cancelled'); // Misty's litter: another pet
  });
});
