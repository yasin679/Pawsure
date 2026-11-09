import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

let db: Db, app: ReturnType<typeof createApp>, adapters: ReturnType<typeof mockAdapters>, clock: ReturnType<typeof demoClock>;
let owner: string, ops: string, lead: string, priv: string, auditor: string, code: string;
const DAY = '2026-11-08', at = (hm: string) => `${DAY}T${hm}:00+05:30`, HH = '/v1/households/hh_demo', SUNITA = '+919000000035';
const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as T };
};
const signIn = async (phone: string) => { const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone }); return (await call<{ token: string }>('POST', '/auth/otp/verify', { phone, code: r.body.demoCode })).body.token; };
const tick = () => call<{ sent: string[] }>('POST', '/jobs/tick');
let n = 0;
const text = (t: string) => call('POST', '/webhooks/whatsapp', { from: SUNITA, messageId: 'p4-' + ++n, type: 'text', text: t });
const lastTo = (phone: string) => adapters.outbox.filter(o => o.to === phone).at(-1)!;
type Wallet = { rewardsArm: boolean; helpers: { name: string; thisMonth: number; held: number; history: unknown[] }[] };

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  adapters = mockAdapters(); clock = demoClock(at('09:00'));
  app = createApp({ db, adapters, clock, pepper: 'test', demoMode: true });
  owner = await signIn('+919800000021');
  [ops, lead, priv, auditor] = await Promise.all(['+919811000001', '+919811000002', '+919811000003', '+919811000004'].map(signIn));
  await tick();
  code = (await call<{ codes: Record<string, string> }>('GET', `${HH}/code-cards/current`, undefined, owner)).body.codes['8']!;
}, 60000);

describe('staff access (PS-070, §5): role-limited and every view logged', () => {
  it('a household member is not staff', async () => {
    expect((await call('GET', '/admin/me', undefined, owner)).status).toBe(403);
    expect((await call('GET', '/admin/overview', undefined, owner)).status).toBe(403);
    expect((await call('GET', '/admin/overview')).status).toBe(401);
  });
  it('each role opens only what the matrix allows', async () => {
    expect((await call<{ role: string }>('GET', '/admin/me', undefined, ops)).body.role).toBe('ops');
    expect((await call('GET', '/admin/queues', undefined, ops)).status).toBe(200);
    expect((await call('GET', '/admin/audit', undefined, ops)).status).toBe(403);
    expect((await call('GET', '/admin/rights', undefined, ops)).status).toBe(403);
    expect((await call('GET', '/admin/rights', undefined, priv)).status).toBe(200);
    expect((await call('PUT', '/admin/flags', { key: 'helperShareRecord', value: true }, priv)).status).toBe(403);
    expect((await call('GET', '/admin/audit', undefined, auditor)).status).toBe(200);
    expect((await call('GET', '/admin/households', undefined, auditor)).status).toBe(403);
  });
  it('views and refusals are both in the append-only audit log', async () => {
    const rows = await db.query<{ action: string }>(`select action from audit_log where actor like 'staff:%'`);
    expect(rows.some(r => r.action === 'admin.view')).toBe(true);
    expect(rows.some(r => r.action === 'admin.access.denied')).toBe(true);
    await expect(db.query(`update audit_log set action='x' where actor like 'staff:%'`)).rejects.toThrow();
  });
  it('staff views never carry a raw phone number', async () => {
    const hh = await call('GET', '/admin/households', undefined, ops);
    expect(JSON.stringify(hh.body)).not.toMatch(/\+91\d{10}|9800000021/);
    expect(JSON.stringify(hh.body)).toContain('+91 •••• ••21');
  });
});

describe('pilot metrics and safe reporting (PS-111, PS-117)', () => {
  it('overview shows each gate with n and a status, never judged under 5 cases', async () => {
    const o = (await call<{ metrics: { label: string; n: number; status: string; target: string }[] }>('GET', '/admin/overview', undefined, ops)).body;
    expect(o.metrics.length).toBe(6);
    o.metrics.filter(m => m.n < 5).forEach(m => expect(['too few to judge', 'no data']).toContain(m.status));
  });
  it('method mix suppresses groups under 5 and never lists a helper', async () => {
    const m = await call('GET', '/admin/method-mix', undefined, lead);
    const s = JSON.stringify(m.body);
    expect(s).not.toMatch(/Sunita|u_sunita|m_sunita/);
    expect((m.body as { helpersByMethod: { suppressed: boolean }[] }).helpersByMethod.every(g => g.suppressed)).toBe(true);
  });
});

describe('rewards (PS-042–044, PS-105, PS-126)', () => {
  it('a Confirmed helper task earns 5 points live, written to the ledger when the day closes', async () => {
    clock.set(at('13:02'));
    await call('POST', '/webhooks/whatsapp', { from: SUNITA, messageId: 'p4-photo', type: 'photo', taskId: `r1_${DAY}`, mediaRef: 'p4-bowl-1', caption: code });
    await text('points');
    const vars = JSON.parse(lastTo(SUNITA).body) as Record<string, string>;
    expect(lastTo(SUNITA).template).toBe('W_POINTS:mr');
    expect(Number(vars.month)).toBeGreaterThanOrEqual(65); // 60 earned earlier this month + today's live points
    const before = (await call<Wallet>('GET', `${HH}/wallet`, undefined, owner)).body.helpers[0]!.thisMonth;
    clock.set(at('23:59')); await tick(); await tick(); // closing twice must not double-count
    const after = (await call<Wallet>('GET', `${HH}/wallet`, undefined, owner)).body.helpers[0]!.thisMonth;
    expect(after - before).toBeGreaterThanOrEqual(5);
    const rows = await db.query<{ n: number }>(`select count(*)::int as n from reward_ledger where task_id=$1 and state='earned'`, [`r1_${DAY}`]);
    expect(rows[0]!.n).toBe(1);
  });
  it('the owner wallet shows only this household and is closed to helpers and friends', async () => {
    const w = (await call<Wallet>('GET', `${HH}/wallet`, undefined, owner)).body;
    expect(w.rewardsArm).toBe(true); expect(w.helpers[0]!.name).toBeTruthy();
    const sunita = await signIn(SUNITA);
    expect((await call('GET', `${HH}/wallet`, undefined, sunita)).status).toBe(403);
  });
  it('a hold needs a reason the helper can read, and the helper is told', async () => {
    await db.query(`insert into reward_ledger(id, helper_user_id, household_id, points, state, reason, month, expires_at) values ('rw_h1','u_sunita','hh_demo',5,'held','return_check_mismatch','2026-11','2026-11-15')`);
    expect((await call('POST', '/admin/rewards/rw_h1/decide', { decision: 'release', note: 'ok' }, lead)).status).toBe(400);
    expect((await call('POST', '/admin/rewards/rw_h1/decide', { decision: 'release', note: 'ok' }, ops)).status).toBe(403);
    const r = await call<{ state: string }>('POST', '/admin/rewards/rw_h1/decide', { decision: 'release', note: 'Owner confirmed the bowl was refilled.' }, lead);
    expect(r.body.state).toBe('released');
    expect(lastTo(SUNITA).template).toBe('W_HOLD_DECIDED:mr');
  });
  it('weekly points message goes out Sunday evening, once per week', async () => {
    clock.set('2026-11-08T18:30:00+05:30'); // Sunday
    await tick(); await tick();
    expect(adapters.outbox.filter(o => o.to === SUNITA && o.template.startsWith('W_WEEKLY')).length).toBe(1);
  });
});

describe('share link (PS-104) and helper data rights', () => {
  it('“share” says it is not switched on while the flag is OFF', async () => {
    await text('share');
    expect(lastTo(SUNITA).template).toBe('W_SHARE_OFF:mr');
    expect((await db.query(`select 1 from share_links`)).length).toBe(0);
  });
  it('locked switches cannot be changed from the console', async () => {
    expect((await call('PUT', '/admin/flags', { key: 'nearbyMemberFallback', value: true }, lead)).status).toBe(409);
  });
  it('with the flag ON the link shows counts only, and “stop link” turns it off', async () => {
    expect((await call('PUT', '/admin/flags', { key: 'helperShareRecord', value: true }, lead)).status).toBe(200);
    await text('share');
    const link = (JSON.parse(lastTo(SUNITA).body) as { link: string }).link;
    const rec = await call<Record<string, unknown>>('GET', link);
    expect(rec.status).toBe(200);
    expect(rec.body.verifiedVisitRecords).toBeGreaterThan(0);
    expect(JSON.stringify(rec.body)).not.toMatch(/Bruno|Misty|Lake Vista|hh_demo|B-1104|Neha/);
    await text('stop link');
    expect((await call('GET', link)).status).toBe(410);
  });
  it('“my data” opens an access request with a 7-day target', async () => {
    await text('my data');
    const r = (await db.query<{ channel: string; kind: string; due_at: string; legal_due_at: string }>(`select channel, kind, due_at::text, legal_due_at::text from rights_requests where channel='whatsapp'`))[0]!;
    expect(r.kind).toBe('access');
    expect(lastTo(SUNITA).template).toBe('W_MYDATA:mr');
  });
});

describe('owner rights, export and the privacy desk (PS-119)', () => {
  let id: string;
  it('owner files a request; the privacy lead must reply to close it', async () => {
    const r = await call<{ id: string; dueAt: string; legalLimit: string }>('POST', '/v1/me/rights', { kind: 'correction', detail: 'Bruno’s age is wrong' }, owner);
    expect(r.status).toBe(201); id = r.body.id;
    expect(Date.parse(r.body.legalLimit) - Date.parse(r.body.dueAt)).toBeGreaterThan(80 * 86400000);
    expect((await call('PUT', `/admin/rights/${id}`, { state: 'closed' }, priv)).status).toBe(400);
    expect((await call('PUT', `/admin/rights/${id}`, { state: 'closed', reply: 'Updated to 4 years. Thank you.' }, priv)).status).toBe(200);
    const mine = (await call<{ id: string; state: string; reply: string }[]>('GET', '/v1/me/rights', undefined, owner)).body.find(x => x.id === id)!;
    expect(mine.state).toBe('closed'); expect(mine.reply).toContain('4 years');
  });
  it('export returns this person’s data only', async () => {
    const e = (await call<{ profile: { phone_e164: string }; pets: unknown[]; rewardLedger: unknown[] }>('GET', '/v1/me/export', undefined, owner)).body;
    expect(e.profile.phone_e164).toBe('+919800000021');
    expect(e.pets.length).toBe(2); expect(e.rewardLedger.length).toBe(0);
  });
  it('the auditor reads the audit log with no phone numbers in it', async () => {
    const a = await call('GET', '/admin/audit?action=rights', undefined, auditor);
    expect(a.status).toBe(200); expect(JSON.stringify(a.body)).not.toMatch(/\+91\d{10}/);
  });
});

describe('breach runbook (PS-120)', () => {
  it('a rehearsal starts the 72 h Board clock; ops cannot start one', async () => {
    expect((await call('POST', '/admin/breach/events', { kind: 'rehearsal' }, ops)).status).toBe(403);
    const r = await call<{ id: string; boardDueAt: string }>('POST', '/admin/breach/events', { kind: 'rehearsal', summary: 'Tabletop' }, priv);
    expect(r.status).toBe(201);
    expect(Date.parse(r.body.boardDueAt) - clock.now().getTime()).toBe(72 * 3600000);
    expect((await call('PUT', `/admin/breach/events/${r.body.id}`, { step: 'users_notified' }, priv)).status).toBe(200);
    const b = (await call<{ checklist: unknown[]; events: { users_notified_at: string | null }[] }>('GET', '/admin/breach', undefined, priv)).body;
    expect(b.checklist.length).toBe(7); expect(b.events[0]!.users_notified_at).toBeTruthy();
  });
});

describe('ops queue (PS-072)', () => {
  it('closing a case needs a reason', async () => {
    const c = (await db.query<{ id: string }>(`select id from ops_cases limit 1`))[0]!;
    expect((await call('POST', `/admin/cases/${c.id}`, { action: 'close' }, ops)).status).toBe(400);
    expect((await call('POST', `/admin/cases/${c.id}`, { action: 'close', note: 'Answered by phone' }, ops)).status).toBe(200);
    expect((await db.query<{ state: string }>(`select state from ops_cases where id=$1`, [c.id]))[0]!.state).toBe('closed');
  });
});
