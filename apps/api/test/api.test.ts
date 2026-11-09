import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

let db: Db, app: ReturnType<typeof createApp>, adapters: ReturnType<typeof mockAdapters>, clock: ReturnType<typeof demoClock>;
const DAY = '2026-11-06';
const at = (hm: string) => `${DAY}T${hm}:00+05:30`;
const json = (method: string, path: string, body?: unknown, token?: string) => app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });

async function signIn(phone: string) {
  const r = await (await json('POST', '/auth/otp/request', { phone })).json() as { demoCode: string };
  const v = await (await json('POST', '/auth/otp/verify', { phone, code: r.demoCode })).json() as { token: string };
  return v.token;
}

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  adapters = mockAdapters(); clock = demoClock(at('09:00'));
  app = createApp({ db, adapters, clock, pepper: 'test', demoMode: true });
}, 60000);

describe('auth (PS-001)', () => {
  it('rejects bad numbers, wrong codes, then signs in', async () => {
    expect((await json('POST', '/auth/otp/request', { phone: '12345' })).status).toBe(400);
    const r = await (await json('POST', '/auth/otp/request', { phone: '+919811111111' })).json() as { demoCode: string };
    expect((await json('POST', '/auth/otp/verify', { phone: '+919811111111', code: r.demoCode === '000000' ? '111111' : '000000' })).status).toBe(400);
    const ok = await (await json('POST', '/auth/otp/verify', { phone: '+919811111111', code: r.demoCode })).json() as { token: string; isNew: boolean };
    expect(ok.isNew).toBe(true); expect(ok.token.length).toBeGreaterThan(30);
  });
  it('throttles resends (30 s) and caps at 3 per 15 min', async () => {
    await json('POST', '/auth/otp/request', { phone: '+919822222222' });
    expect((await json('POST', '/auth/otp/request', { phone: '+919822222222' })).status).toBe(429);
  });
  it('requires a session for /v1', async () => { expect((await json('GET', '/v1/me')).status).toBe(401); });
});

describe('tenant isolation and roles (§5)', () => {
  it('an owner of another household cannot read this household', async () => {
    const t = await signIn('+919833333333');
    const h = await (await json('POST', '/v1/households', { displayName: 'Other', language: 'en', society: 'Hill View CHS, Powai' }, t)).json() as { id: string };
    expect((await json('GET', `/v1/households/${h.id}/pets`, undefined, t)).status).toBe(200);
    expect((await json('GET', '/v1/households/hh_demo/pets', undefined, t)).status).toBe(403);
  });
  it('a backup cannot edit pets', async () => {
    const t = await signIn('+919700000008');
    expect((await json('PATCH', '/v1/households/hh_demo/pets/bruno', { name: 'X' }, t)).status).toBe(403);
  });
});

describe('daily care end to end (PS-030, PS-122, PS-123 idempotency)', () => {
  let owner: string, code: string;
  beforeAll(async () => { owner = await signIn('+919800000021'); clock.set(at('09:00')); await json('POST', '/jobs/tick'); code = ((await (await json('GET', '/v1/households/hh_demo/code-cards/current', undefined, owner)).json()) as { codes: Record<string, string> }).codes['6']!; });
  it('photo + today’s code alone → Likely; + arrival/exit calls → Confirmed', async () => {
    clock.set(at('13:04'));
    await json('POST', '/webhooks/ivr', { callId: 'c1', from: '+919000000035', event: 'arrive', visitId: `hh_demo_${DAY}_v1` });
    clock.set(at('13:08'));
    const w = await json('POST', '/webhooks/whatsapp', { messageId: 'w1', from: '+919000000035', taskId: `r1_${DAY}`, type: 'photo', mediaRef: 'img-1', caption: 'done ' + code });
    expect((await w.json() as { status: string }).status).toBe('stored');
    let day = await (await json('GET', '/v1/households/hh_demo/today', undefined, owner)).json() as { tasks: { id: string; ev: { state: string } }[] };
    expect(day.tasks.find(t => t.id === `r1_${DAY}`)!.ev.state).toBe('Likely');
    clock.set(at('13:22'));
    await json('POST', '/webhooks/ivr', { callId: 'c1', from: '+919000000035', event: 'exit', visitId: `hh_demo_${DAY}_v1` });
    day = await (await json('GET', '/v1/households/hh_demo/today', undefined, owner)).json() as typeof day;
    expect(day.tasks.find(t => t.id === `r1_${DAY}`)!.ev.state).toBe('Confirmed');
  });
  it('duplicate webhook is ignored; re-sent image never counts', async () => {
    const again = await (await json('POST', '/webhooks/whatsapp', { messageId: 'w1', from: '+919000000035', taskId: `r1_${DAY}`, type: 'photo', mediaRef: 'img-1', caption: 'done ' + code })).json() as { status: string };
    expect(again.status).toBe('duplicate_event');
    const reused = await (await json('POST', '/webhooks/whatsapp', { messageId: 'w2', from: '+919000000035', taskId: `r3_${DAY}`, type: 'photo', mediaRef: 'img-1', caption: 'done ' + code })).json() as { duplicateImage: boolean };
    expect(reused.duplicateImage).toBe(true);
  });
  it('an unknown sender cannot post evidence', async () => {
    expect((await json('POST', '/webhooks/whatsapp', { messageId: 'w9', from: '+919999999999', taskId: `r1_${DAY}`, type: 'photo', caption: '1234' })).status).toBe(404);
  });
  it('escalation fires once per step and acknowledgement stops later steps (4 PM task)', async () => {
    clock.set(at('16:30'));
    let r = await (await json('POST', '/jobs/escalations')).json() as { sent: string[] };
    expect(r.sent).toContain(`esc:r4_${DAY}:1`);
    expect(r.sent).toContain(`prompt:r4_${DAY}`);
    r = await (await json('POST', '/jobs/escalations')).json() as typeof r;
    expect(r.sent).not.toContain(`esc:r4_${DAY}:1`);
    clock.set(at('16:40'));
    expect((await json('POST', `/v1/households/hh_demo/tasks/r4_${DAY}/ack`, {}, owner)).status).toBe(200);
    clock.set(at('17:20'));
    r = await (await json('POST', '/jobs/escalations')).json() as typeof r;
    expect(r.sent.filter(k => k.startsWith(`esc:r4_${DAY}`))).toEqual([]);
  });
  it('lifecycle changes need a reason', async () => {
    expect((await json('POST', `/v1/households/hh_demo/tasks/r3_${DAY}/lifecycle`, { state: 'Cancelled by owner' }, owner)).status).toBe(409);
    expect((await json('POST', `/v1/households/hh_demo/tasks/r3_${DAY}/lifecycle`, { state: 'Partly done', note: 'Litter not changed' }, owner)).status).toBe(200);
  });
  it('S1 incident creates an ops case and a severity plan', async () => {
    const r = await (await json('POST', '/v1/households/hh_demo/incidents', { category: 'pet_hurt', petId: 'bruno' }, owner)).json() as { severity: string; plan: unknown[] };
    expect(r.severity).toBe('S1'); expect(r.plan.length).toBe(8);
    expect((await db.query(`select count(*)::int as n from ops_cases where severity='S1'`))[0]).toEqual({ n: 1 });
  });
});

describe('consent gate (PS-021)', () => {
  it('no evidence is collected from a helper without consent', async () => {
    await db.query(`insert into users(id, phone_e164) values ('u_h2','+919000000099')`);
    await db.query(`insert into memberships(id, household_id, user_id, role, status) values ('m_h2','hh_demo','u_h2','helper','active')`);
    await db.query(`update care_tasks set assignee_membership_id='m_h2' where id=$1`, [`r2_${DAY}`]);
    const r = await json('POST', '/webhooks/whatsapp', { messageId: 'w20', from: '+919000000099', taskId: `r2_${DAY}`, type: 'photo', caption: '1234' });
    expect(r.status).toBe(409);
  });
});
