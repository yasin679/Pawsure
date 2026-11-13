/**
 * QA defect tracker (Pawsure_QA_Defect_Tracker.xlsx, PAW-001 to PAW-016): one check per item, at the API level.
 * Screen-level checks for the same items are in e2e/13-qa-defects.spec.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

let db: Db, app: ReturnType<typeof createApp>, adapters: ReturnType<typeof mockAdapters>, clock: ReturnType<typeof demoClock>, owner: string;
const DAY = '2026-11-06', at = (hm: string, d = DAY) => `${d}T${hm}:00+05:30`, HH = '/v1/households/hh_demo';
const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as T };
};
const signIn = async (phone: string) => { const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone }); return (await call<{ token: string }>('POST', '/auth/otp/verify', { phone, code: r.body.demoCode })).body.token; };
const tick = () => call('POST', '/jobs/tick');
let n = 0;
const reply = (from: string, payload: string) => call('POST', '/webhooks/whatsapp', { from, messageId: 'qa' + ++n, type: 'button', payload });
type View = { id: string; state: string; parsed: { petId: string; tasks: string[]; time: number; medsInstructions: string | null }; clarifications: { field: string }[]; blocked: string[]; history: { at: number; state: string; note: string; ts?: string }[]; editable: boolean; petChanged?: string[]; duplicateOf?: string | null };
const ask = async (text: string) => (await call<View>('POST', `${HH}/requests`, { text }, owner)).body;
const search = (id: string) => call<{ request: View; top: { id: string }[] }>('POST', `${HH}/requests/${id}/search`, {}, owner);
const get = async (id: string) => (await call<View>('GET', `${HH}/requests/${id}`, undefined, owner)).body;
const patch = (id: string, body: unknown) => call<View & { error?: string; message?: string }>('PATCH', `${HH}/requests/${id}`, body, owner);
const approve = (id: string, friendIds = ['u_priya']) => call<View & { error?: string; message?: string; duplicateOf?: string }>('POST', `${HH}/requests/${id}/approve`, { friendIds, mode: 'one', approved: true }, owner);
const PRIYA = '+919900000012', SUNITA = '+919000000035';

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  adapters = mockAdapters(); clock = demoClock(at('12:50'));
  app = createApp({ db, adapters, clock, pepper: 'test', demoMode: true, limits: { requestsPerHour: 1000 } });
  owner = await signIn('+919800000021'); await tick();
}, 60000);

describe('New task (PAW-002, PAW-008, PAW-009)', () => {
  it('PAW-002/008 a task without a name is refused with a plain message, and nothing is saved', async () => {
    const r = await call<{ error: string; issues: string[]; message?: string }>('POST', `${HH}/routine`, { petId: 'bruno', type: 'feeding', due: 1080, assignee: 'helper' }, owner);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Give the task a name.');
    const blank = await call<{ message?: string }>('POST', `${HH}/routine`, { petId: 'bruno', title: '   ', type: 'feeding', due: 1080, assignee: 'helper' }, owner);
    expect(blank.status).toBe(400); expect(blank.body.message).toBe('Give the task a name.');
    expect((await db.query(`select 1 from routine_tasks where household_id='hh_demo' and coalesce(trim(title),'')=''`)).length).toBe(0);
  });
  it('PAW-009 every day starts tomorrow, just for today starts today — by India time, also just after midnight', async () => {
    clock.set(at('00:10', '2026-11-07')); // 18:40 UTC on 6 Nov
    const daily = await call<{ effectiveFrom: string }>('POST', `${HH}/routine`, { petId: 'bruno', title: 'Night check', type: 'other', due: 1380, assignee: 'owner' }, owner);
    const once = await call<{ effectiveFrom: string }>('POST', `${HH}/routine`, { petId: 'bruno', title: 'Early walk', type: 'walk', due: 420, assignee: 'owner', oneOffToday: true }, owner);
    expect(daily.body.effectiveFrom).toBe('2026-11-08'); expect(once.body.effectiveFrom).toBe('2026-11-07');
    clock.set(at('12:50'));
    await db.query(`delete from routine_tasks where title in ('Night check','Early walk')`);
  });
});

describe('Must happen and co-owner tasks (PAW-010, PAW-011)', () => {
  it('PAW-010 a must-happen task alerts the owner once at +15 min; a task with evidence never alerts', async () => {
    await call('POST', '/webhooks/whatsapp', { from: SUNITA, messageId: 'qa-lunch', type: 'photo', taskId: `r1_${DAY}`, mediaRef: 'qa-lunch-1', caption: 'done' });
    const alerts = async (task: string) => (await db.query(`select 1 from notifications where dedupe_key=$1`, [`esc:${task}_${DAY}:1`])).length;
    clock.set(at('13:14')); await tick(); expect(await alerts('r2')).toBe(0);
    clock.set(at('13:15')); await tick(); expect(await alerts('r2')).toBe(1);
    clock.set(at('13:16')); await tick(); clock.set(at('13:20')); await tick(); expect(await alerts('r2')).toBe(1);
    clock.set(at('13:31')); await tick(); expect(await alerts('r1')).toBe(0);
  });
  it('PAW-011 a co-owner task reminds the co-owner only, and only they can answer it', async () => {
    expect((await call('POST', `${HH}/routine`, { petId: 'misty', title: 'Brush Misty', type: 'other', due: 930, assignee: 'co_owner', oneOffToday: true }, owner)).status).toBe(201);
    clock.set(at('14:00')); await tick(); await tick();
    const rows = await db.query<{ id: string; recipient_kind: string; visit_key: string }>(`select id, recipient_kind, visit_key from reminder where household_id='hh_demo' and care_date=$1 and visit_key like '%|m_rohan'`, [DAY]);
    expect(rows).toHaveLength(1); expect(rows[0]!.recipient_kind).toBe('co_owner');
    const rohan = await signIn('+919800000022');
    expect((await call('POST', `${HH}/cover/reminders/${rows[0]!.id}/reply`, { reply: 'yes' }, owner)).status).toBe(403);
    expect((await call<{ status: string }>('POST', `${HH}/cover/reminders/${rows[0]!.id}/reply`, { reply: 'yes' }, rohan)).body.status).toBe('confirmed');
    const day = (await call<{ tasks: { title: string; cover?: { person?: string; state?: string } | null }[] }>('GET', `${HH}/today`, undefined, owner)).body;
    expect(day.tasks.find(t => t.title === 'Brush Misty')?.cover).toMatchObject({ state: 'ConfirmedByCaregiver' });
  });
});

describe('Find cover editing (PAW-001, PAW-005, PAW-006, PAW-015, PAW-016)', () => {
  it('PAW-005 a request is editable before it is sent, and refused with a reason after', async () => {
    clock.set(at('15:30'));
    const r = await ask('Can someone feed Bruno at 6 pm? Spare key with Ankita.');
    expect(r.editable).toBe(true);
    await search(r.id); expect((await get(r.id)).editable).toBe(true); // awaiting approval: still editable
    await approve(r.id);
    const after = await get(r.id); expect(after.state).toBe('Sent'); expect(after.editable).toBe(false);
    const p = await patch(r.id, { fields: { time: 1110 } });
    expect(p.status).toBe(409); expect(p.body.message).toMatch(/already been sent/);
    await call('POST', `${HH}/requests/${r.id}/cancel`, {}, owner);
  });
  it('PAW-001/006 after the pet profile changes, an unsent request shows it and uses the new details', async () => {
    const r = await ask('Can someone give Bruno his medicine at 6 pm? Spare key with Ankita.');
    if (r.clarifications.some(c => c.field === 'meds')) await patch(r.id, { clarify: { field: 'meds', value: 'profile' } });
    expect((await get(r.id)).parsed.medsInstructions).toContain('1 chewable');
    await call('PATCH', `${HH}/pets/bruno`, { medicines: 'Joint supplement — 2 chewables with lunch (vet changed the dose)' }, owner);
    const v = await get(r.id);
    expect(v.petChanged).toEqual(['medicine instructions']);
    const s = await search(r.id);
    expect(s.body.request.parsed.medsInstructions).toContain('2 chewables');
    expect((await get(r.id)).petChanged ?? []).toEqual([]);
    await call('POST', `${HH}/requests/${r.id}/cancel`, {}, owner);
  });
  it('PAW-015 switching the pet replaces the medicine instructions with the new pet’s', async () => {
    const r = await ask('Can someone give Bruno his medicine at 6 pm? Spare key with Ankita.');
    if (r.clarifications.some(c => c.field === 'meds')) await patch(r.id, { clarify: { field: 'meds', value: 'profile' } });
    const v = (await patch(r.id, { fields: { petId: 'misty' } })).body;
    expect(v.parsed.petId).toBe('misty');
    expect(v.parsed.medsInstructions ?? '').not.toContain('chewable'); // never Bruno's medicine for Misty
    expect(v.clarifications.map(c => c.field)).toContain('meds'); // Misty has none on file: the owner must answer
    await call('POST', `${HH}/requests/${r.id}/cancel`, {}, owner);
  });
  it('PAW-016 after an edit, the old suggestions can’t be approved: search again', async () => {
    const r = await ask('Can someone feed Bruno at 6 pm? Spare key with Ankita.');
    await search(r.id);
    await patch(r.id, { fields: { time: 1140 } });
    const a = await approve(r.id);
    expect(a.status).toBe(409); expect(a.body.error).toBe('search_first'); expect(a.body.message).toMatch(/changed since the suggestions/);
    await call('POST', `${HH}/requests/${r.id}/cancel`, {}, owner);
  });
});

describe('Request history (PAW-003, PAW-012)', () => {
  it('PAW-003 tapping a value that is already selected records nothing', async () => {
    const r = await ask('Can someone feed Bruno at 6 pm? Spare key with Ankita.');
    await search(r.id);
    const before = (await get(r.id)).history.length;
    await patch(r.id, { fields: { time: r.parsed.time } }); await patch(r.id, { fields: { petId: 'bruno' } });
    const after = await get(r.id);
    expect(after.history.length).toBe(before); expect(after.state).toBe('Awaiting owner approval');
    await call('POST', `${HH}/requests/${r.id}/cancel`, {}, owner);
  });
  it('PAW-012 each event has an exact time; reopening and refreshing adds nothing', async () => {
    const r = await ask('Can someone feed Bruno at 6 pm? Spare key with Ankita.');
    clock.set(at('15:31')); await search(r.id);
    const v = await get(r.id); await get(r.id); await call('GET', `${HH}/requests`, undefined, owner);
    expect((await get(r.id)).history.length).toBe(v.history.length);
    expect(v.history.every(h => !!h.ts)).toBe(true);
    const ts = v.history.map(h => Date.parse(h.ts!)); expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    expect(v.history.at(-1)!.ts).toBe(new Date(at('15:31')).toISOString());
    await call('POST', `${HH}/requests/${r.id}/cancel`, {}, owner);
  });
});

describe('Duplicates and repeats (PAW-007, PAW-014)', () => {
  it('PAW-007 a cancelled request stays cancelled; a second active request for the same pet and time is stopped', async () => {
    clock.set(at('16:00'));
    const a = await ask('Can someone feed Bruno at 7 pm? Spare key with Ankita.'); await search(a.id); await approve(a.id);
    await call('POST', `${HH}/requests/${a.id}/cancel`, {}, owner);
    const b = await ask('Can someone feed Bruno at 7 pm? Spare key with Ankita.'); await search(b.id);
    expect((await approve(b.id)).status).toBe(200);
    expect((await get(a.id)).state).toBe('Cancelled');
    const c = await ask('Can someone feed Bruno at 7 pm? Spare key with Ankita.');
    const s = await search(c.id); expect(s.body.request.duplicateOf).toBe(b.id);
    const ap = await approve(c.id); expect(ap.status).toBe(409); expect(ap.body.error).toBe('duplicate_active'); expect(ap.body.duplicateOf).toBe(b.id);
    const active = await db.query(`select id from friend_requests where household_id='hh_demo' and state in ('Sent','Provisional hold','Accepted - pending owner confirmation','Confirmed') and (parse->'parsed'->>'time')::int = 1140`);
    expect(active.length).toBe(1);
    await call('POST', `${HH}/requests/${b.id}/cancel`, {}, owner); await call('POST', `${HH}/requests/${c.id}/cancel`, {}, owner);
  });
  it('PAW-014 Confirm sent twice: one transition, one access message, both calls succeed', async () => {
    const r = await ask('Can someone feed Bruno at 8 pm? Spare key with Ankita.'); await search(r.id); await approve(r.id);
    expect((await approve(r.id)).status).toBe(200); // a retried Send is ignored, not an error
    await reply(PRIYA, `ff_yes:${r.id}`);
    const [c1, c2] = await Promise.all([1, 2].map(() => call<View>('POST', `${HH}/requests/${r.id}/confirm`, { friendId: 'u_priya' }, owner)));
    expect([c1!.status, c2!.status]).toEqual([200, 200]);
    expect((await get(r.id)).history.filter(h => h.state === 'Confirmed').length).toBe(1);
    expect(adapters.outbox.filter(o => o.template === 'FF-ACCESS' && JSON.stringify(o.vars ?? {}).includes(r.id)).length).toBeLessThanOrEqual(1);
    expect((await db.query(`select 1 from access_grants where request_id=$1`, [r.id])).length).toBe(1);
    const x1 = await call('POST', `${HH}/requests/${r.id}/cancel`, {}, owner), x2 = await call('POST', `${HH}/requests/${r.id}/cancel`, {}, owner);
    expect([x1.status, x2.status]).toEqual([200, 200]);
  });
});

describe('New task: field rules shared by the form and the server (PAW-008)', () => {
  it('a medicine task needs written instructions; other tasks don’t', async () => {
    const med = await call<{ message?: string }>('POST', `${HH}/routine`, { petId: 'bruno', title: 'Eye drops', type: 'medicine', due: 1200, assignee: 'owner' }, owner);
    expect(med.status).toBe(400); expect(med.body.message).toBe('Add the vet’s written instructions for a medicine task.');
    expect((await call('POST', `${HH}/routine`, { petId: 'bruno', title: 'Eye drops', type: 'medicine', due: 1200, assignee: 'owner', instructions: '1 drop each eye, as on the vet’s card' }, owner)).status).toBe(201);
    expect((await call('POST', `${HH}/routine`, { petId: 'bruno', title: 'Play', type: 'other', due: 1200, assignee: 'owner' }, owner)).status).toBe(201);
    const long = await call<{ message?: string }>('POST', `${HH}/routine`, { petId: 'bruno', title: 'x'.repeat(81), type: 'other', due: 1200, assignee: 'owner' }, owner);
    expect(long.body.message).toBe('Keep the task name under 80 characters.');
  });
});
