import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

let db: Db, app: ReturnType<typeof createApp>, adapters: ReturnType<typeof mockAdapters>, clock: ReturnType<typeof demoClock>, owner: string, code: string;
const DAY = '2026-11-06', at = (hm: string) => `${DAY}T${hm}:00+05:30`, HH = '/v1/households/hh_demo';
const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as T };
};
const signIn = async (phone: string) => { const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone }); return (await call<{ token: string }>('POST', '/auth/otp/verify', { phone, code: r.body.demoCode })).body.token; };
const tick = () => call<{ sent: string[] }>('POST', '/jobs/tick');
const wa = (m: Record<string, unknown>) => call<Record<string, unknown>>('POST', '/webhooks/whatsapp', { from: '+919000000035', ...m });

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  adapters = mockAdapters(); clock = demoClock(at('09:00'));
  app = createApp({ db, adapters, clock, pepper: 'test', demoMode: true });
  owner = await signIn('+919800000021'); await tick();
  code = (await call<{ codes: Record<string, string> }>('GET', `${HH}/code-cards/current`, undefined, owner)).body.codes['6']!;
}, 60000);

describe('code card (PS-024, PS-109)', () => {
  it('the month’s card is created automatically and code values never appear in the audit log', async () => {
    expect(code).toMatch(/^\d{4}$/);
    const logs = await db.query(`select detail from audit_log where action like 'codecard%'`);
    expect(JSON.stringify(logs)).not.toContain(code);
  });
  it('rotation makes the old card stop counting', async () => {
    await call('POST', `${HH}/code-cards`, { reason: 'Suspected copying' }, owner);
    const fresh = (await call<{ codes: Record<string, string>; version: number }>('GET', `${HH}/code-cards/current`, undefined, owner)).body;
    expect(fresh.version).toBe(2);
    clock.set(at('13:02')); await tick();
    const old = await wa({ messageId: 'cc1', type: 'photo', taskId: `r1_${DAY}`, mediaRef: 'cc-img-1', caption: code });
    expect(old.body.photoCode).toBe(code === fresh.codes['6'] ? 'today' : 'old');
    code = fresh.codes['6']!;
  });
});

describe('helper channel (PS-020–022, PS-110, PS-027)', () => {
  let mid: string;
  it('invite sends W1 consent in Marathi with Yes / Not now; nothing is collected before Yes', async () => {
    mid = (await call<{ membershipId: string }>('POST', `${HH}/helpers/invite`, { name: 'Lata', phone: '+919000000077', language: 'mr' }, owner)).body.membershipId;
    const thread = (await call<{ body: string; buttons: { id: string }[] }[]>('GET', `/demo/helper-thread/${mid}`)).body;
    expect(thread[0]!.body).toContain('तुमचा चेहरा कधीच नाही');
    expect(thread[0]!.buttons.map(b => b.id.split(':')[0])).toEqual(expect.arrayContaining(['consent_yes', 'consent_notnow']));
    expect((await call('POST', '/webhooks/whatsapp', { from: '+919000000077', messageId: 'l0', type: 'photo', taskId: `r1_${DAY}`, caption: code })).status).toBe(409);
  });
  it('“Not now” records a refusal and tells the owner; nothing is collected', async () => {
    await call('POST', '/webhooks/whatsapp', { from: '+919000000077', messageId: 'l1', type: 'button', payload: 'consent_notnow:hh_demo' });
    const h = (await call<{ id: string; consent: string }[]>('GET', `${HH}/helpers`, undefined, owner)).body.find(x => x.id === mid)!;
    expect(h.consent).toBe('notnow');
    expect(adapters.outbox.some(o => o.channel === 'push' && /Not now/.test(o.template))).toBe(true);
  });
  it('Yes → method menu → method stored; “stop” withdraws', async () => {
    await call('POST', '/webhooks/whatsapp', { from: '+919000000077', messageId: 'l2', type: 'button', payload: 'consent_yes:hh_demo' });
    await call('POST', '/webhooks/whatsapp', { from: '+919000000077', messageId: 'l3', type: 'button', payload: 'method_ivr:hh_demo' });
    let h = (await call<{ id: string; consent: string; method: string }[]>('GET', `${HH}/helpers`, undefined, owner)).body.find(x => x.id === mid)!;
    expect([h.consent, h.method]).toEqual(['yes', 'ivr']);
    await call('POST', '/webhooks/whatsapp', { from: '+919000000077', messageId: 'l4', type: 'text', text: 'stop' });
    h = (await call<{ id: string; consent: string; method: string }[]>('GET', `${HH}/helpers`, undefined, owner)).body.find(x => x.id === mid)!;
    expect(h.consent).toBe('withdrawn');
  });
  it('task prompts go out 10 minutes before due, exactly once', async () => {
    clock.set(at('15:50'));
    const a = await tick(), b = await tick();
    expect(a.body.sent).toContain(`prompt:r4_${DAY}`); expect(b.body.sent).not.toContain(`prompt:r4_${DAY}`);
  });
  it('a typed photo code is checked on the server; a wrong code is flagged', async () => {
    expect((await wa({ messageId: 'p1', type: 'photo', taskId: `r4_${DAY}`, mediaRef: 'pad-1', caption: '0000' })).body.photoCode).toBe('wrong');
  });
  it('an IVR keypad code counts only if it is today’s', async () => {
    expect((await call<{ codeOk: boolean }>('POST', '/webhooks/ivr', { callId: 'k1', from: '+919000000035', event: 'code', taskId: `r3_${DAY}`, digits: code })).body.codeOk).toBe(true);
  });
  it('#9 helper reports “pet hurt” → S1 incident, ops case, parallel calls', async () => {
    await wa({ messageId: 'h1', type: 'button', payload: 'problem_pet_hurt:hh_demo' });
    const inc = (await call<{ severity: string; plan: { sent: boolean; purpose: string }[] }[]>('GET', `${HH}/incidents`, undefined, owner)).body[0]!;
    expect(inc.severity).toBe('S1');
    expect(inc.plan.filter(p => p.sent).map(p => p.purpose)).toEqual(['alert', 'emergency_card', 'open_case']);
    expect(adapters.outbox.some(o => o.channel === 'call')).toBe(true);
  });
});

describe('day flows (PS-007, PS-014, PS-033, PS-012)', () => {
  it('helper can’t come: plan kept, alone-window warning raised', async () => {
    await call('PUT', `${HH}/day`, { helperUnavailable: true, reason: 'Unwell' }, owner);
    const d = (await call<{ day: { helperUnavailable: boolean; alone: { exceeds: boolean } }; tasks: unknown[] }>('GET', `${HH}/today`, undefined, owner)).body;
    expect(d.day.helperUnavailable).toBe(true); expect(d.day.alone.exceeds).toBe(true); expect(d.tasks.length).toBe(4);
    await call('PUT', `${HH}/day`, { helperUnavailable: false, mode: 'tracked' }, owner);
  });
  it('leaving checklist can be skipped and never certifies safety', async () => {
    expect((await call<{ note: string }>('POST', `${HH}/day/leaving`, { checklist: null, returnAt: 1140 }, owner)).body.note).toMatch(/does not check/);
  });
  it('#12 return check contradicting a Likely task → Mismatch, points held, helper told', async () => {
    clock.set(at('16:05'));
    await wa({ messageId: 'p2', type: 'photo', taskId: `r4_${DAY}`, mediaRef: 'pad-2', caption: 'done' });
    clock.set(at('19:05'));
    // r3 (Misty's litter) is Likely from the IVR code; the owner finds the bowl untouched → contradiction.
    // r4 had a wrong-code photo, so it is already Not confirmed and an "old pad" answer leaves it unchanged.
    const r = await call<{ outcomes: { taskId: string; result: string }[] }>('POST', `${HH}/day/return-check`, { food: 1, water: 0, pad: 1, pet: 0, damage: 0 }, owner);
    expect(r.body.outcomes.find(o => o.taskId === `r3_${DAY}`)!.result).toBe('contradicted');
    expect(r.body.outcomes.find(o => o.taskId === `r4_${DAY}`)!.result).toBe('unchanged');
    expect((await db.query(`select count(*)::int as n from reward_ledger where state='held'`))[0]).toEqual({ n: 1 });
    const d = (await call<{ tasks: { id: string; ev: { state: string } }[] }>('GET', `${HH}/today`, undefined, owner)).body;
    expect(d.tasks.find(t => t.id === `r3_${DAY}`)!.ev.state).toBe('Mismatch');
  });
  it('timeline is chronological; day report lists every task', async () => {
    const tl = (await call<{ at: number }[]>('GET', `${HH}/day/timeline`, undefined, owner)).body;
    expect(tl.map(e => e.at)).toEqual([...tl.map(e => e.at)].sort((a, b) => a - b));
    const rep = (await call<{ tasks: unknown[]; covered: { rule: string } }>('GET', `${HH}/day/report`, undefined, owner)).body;
    expect(rep.tasks.length).toBe(4); expect(rep.covered.rule).toBe('covered-day-v1.4');
  });
  it('closing the day stores PS-111 results once, with the rule version', async () => {
    await call('POST', `${HH}/day/close`, {}, owner); await call('POST', `${HH}/day/close`, {}, owner);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from care_days where care_date='2026-11-06'`))[0]!.n).toBe(2);
  });
});

describe('routine (PS-010, PS-011)', () => {
  it('an edit takes effect tomorrow and keeps the original row', async () => {
    const r = await call<{ effectiveFrom: string }>('PUT', `${HH}/routine/r1`, { petId: 'bruno', title: 'Lunch + water', type: 'feeding', due: 810, assignee: 'helper' }, owner);
    expect(r.body.effectiveFrom).toBe('2026-11-07');
    expect((await db.query<{ superseded_by: string | null }>(`select superseded_by from routine_tasks where id='r1'`))[0]!.superseded_by).not.toBeNull();
  });
});

describe('look-in link and care circle (PS-102, PS-005)', () => {
  it('backup link is logged on every open and dies on revocation', async () => {
    const link = adapters.outbox.find(o => o.template.startsWith('LOOKIN-15'));
    expect(link).toBeTruthy();
    const token = (JSON.parse(link!.body) as { link: string }).link.split('/l/')[1]!;
    await call('GET', `/l/${token}`);
    const backup = (await call<{ id: string; role: string }[]>('GET', `${HH}/circle`, undefined, owner)).body.find(m => m.role === 'backup')!;
    expect((await call<{ channels: unknown[] }>('POST', `${HH}/circle/${backup.id}/revoke`, {}, owner)).body.channels.length).toBe(3);
    expect((await call('GET', `/l/${token}`)).status).toBe(410);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from lookin_opens`))[0]!.n).toBeGreaterThanOrEqual(2);
  });
  it('a revoked member loses API access at once', async () => {
    expect((await call('GET', `${HH}/today`, undefined, await signIn('+919700000008'))).status).toBe(403);
  });
});

describe('health calendar (PS-040, PS-041)', () => {
  it('states, reminders once per state, done', async () => {
    const list = (await call<{ id: string; state: string }[]>('GET', `${HH}/health`, undefined, owner)).body;
    expect(list.map(h => h.state)).toEqual(expect.arrayContaining(['overdue', 'due']));
    await tick();
    expect((await tick()).body.sent.filter(k => k.startsWith('health:'))).toEqual([]);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from notifications where dedupe_key like 'health:%'`))[0]!.n).toBeGreaterThan(0);
    await call('POST', `${HH}/health/h2/done`, {}, owner);
    expect((await call<{ id: string; state: string }[]>('GET', `${HH}/health`, undefined, owner)).body.find(h => h.id === 'h2')!.state).toBe('done');
  });
});
