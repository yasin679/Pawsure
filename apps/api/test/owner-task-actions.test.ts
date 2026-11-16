/** Owner actions on a task from Home (16 Nov): Send reminder and Mark completed. */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

let db: Db, app: ReturnType<typeof createApp>, owner = '';
const HH = '/v1/households/hh_demo';
const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token = owner) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as T };
};
const signIn = async (phone: string) => { const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone }, ''); return (await call<{ token: string }>('POST', '/auth/otp/verify', { phone, code: r.body.demoCode }, '')).body.token; };
type Day = { tasks: { id: string; title: string; ev: { state: string } }[] };
const task = async (title: string) => (await call<Day>('GET', `${HH}/today`)).body.tasks.find(t => t.title === title)!;

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  app = createApp({ db, adapters: mockAdapters(), clock: demoClock('2026-11-06T12:30:00+05:30'), pepper: 'test', demoMode: true });
  owner = await signIn('+919800000021');
});

describe('Owner task actions', () => {
  it('Mark completed makes a pending task Matched (owner check), with no helper points', async () => {
    const t = await task('Joint supplement');
    expect(t.ev.state).not.toBe('Matched');
    expect((await call('POST', `${HH}/tasks/${t.id}/owner-done`, {})).body).toMatchObject({ ok: true, state: 'Matched' });
    expect((await task('Joint supplement')).ev.state).toBe('Matched');
  });
  it('Send reminder sends Sunita one WhatsApp prompt for the task, at most once every 15 minutes', async () => {
    const t = await task('Lunch + fresh water');
    const before = (await db.query<{ n: number }>(`select count(*)::int as n from helper_messages where task_id=$1`, [t.id]))[0]!.n;
    const r1 = await call<{ note: string }>('POST', `${HH}/tasks/${t.id}/remind`, {});
    expect(r1.body.note).toBe('Reminder sent to Sunita on WhatsApp.');
    const msgs = await db.query<{ body: string }>(`select body from helper_messages where task_id=$1 order by at desc`, [t.id]);
    expect(msgs.length).toBe(before + 1);
    expect(msgs[0]!.body).toContain('Lunch + fresh water');
    const r2 = await call<{ note: string }>('POST', `${HH}/tasks/${t.id}/remind`, {});
    expect(r2.body.note).toMatch(/already sent/);
    expect((await db.query(`select 1 from helper_messages where task_id=$1`, [t.id])).length).toBe(before + 1);
  });
  it('another home’s owner cannot remind or complete this home’s tasks', async () => {
    const other = await signIn('+919822299001');
    const hh = (await call<{ id: string }>('POST', '/v1/households', { displayName: 'Kiran', language: 'en', state: 'Maharashtra', city: 'Mumbai', society: 'Green Acres CHS' }, other)).body.id;
    expect(hh).toBeTruthy();
    const t = await task('Lunch + fresh water');
    expect((await call('POST', `${HH}/tasks/${t.id}/remind`, {}, other)).status).toBe(403);
    expect((await call('POST', `${HH}/tasks/${t.id}/owner-done`, {}, other)).status).toBe(403);
  });
});

describe('Pet breed and sex (asked together at sign-up)', () => {
  it('stores the breed and sex and sets him/her for friend messages', async () => {
    const r = await call<{ id: string }>('POST', `${HH}/pets`, { name: 'Coco', species: 'Dog', breed: 'Indie', sex: 'Female', food: 'Kibble', allergies: 'None known', medicines: 'None', vet_name: 'Dr. Rao', vet_phone: '+91 22 5555 0101' });
    expect(r.status).toBe(201);
    const row = (await db.query<{ breed: string; sex: string; pronoun: string }>(`select breed, sex, pronoun from pets where id=$1`, [r.body.id]))[0]!;
    expect(row).toMatchObject({ breed: 'Indie', sex: 'Female', pronoun: 'her' });
    expect((await call('POST', `${HH}/pets`, { name: 'Max', species: 'Dog', sex: 'Unknown', food: 'x', allergies: 'x', medicines: 'x', vet_name: 'Dr. Rao', vet_phone: '1' })).status).toBe(400);
  });
});
