/**
 * QA consolidated tracker (Pawsure_QA_Consolidated_Tracker_2026-11-14.xlsx): PAW-017 to PAW-062 and the second-pass
 * audit R-01 to R-20, at the API level, with the demo clock moved across minutes and days (including a 7-day run that
 * covers the 6-day pause). PAW-001 to PAW-016 are in qa-defects.test.ts.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { matchFriends, windowCovers, parseRequestRules, type FriendProfile, type ParsedRequest } from '@pawsure/domain';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

let db: Db, app: ReturnType<typeof createApp>, adapters: ReturnType<typeof mockAdapters>, clock: ReturnType<typeof demoClock>;
let owner: string, priya: string, arjun: string, sunita: string, ankita: string, owner2: string;
const DAY = '2026-11-06', at = (hm: string, d = DAY) => `${d}T${hm}+05:30`, HH = '/v1/households/hh_demo', HH2 = () => `/v1/households/${hh2}`;
let hh2 = '';
type R<T> = { status: number; body: T };
async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string, a = () => app): Promise<R<T>> {
  const r = await a().request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as T };
}
const signIn = async (phone: string, a = () => app) => { const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone }, undefined, a); return (await call<{ token: string }>('POST', '/auth/otp/verify', { phone, code: r.body.demoCode }, undefined, a)).body.token; };
const tick = () => call('POST', '/jobs/tick');
let n = 0;
const wa = (from: string, body: Record<string, unknown>) => call<Record<string, unknown>>('POST', '/webhooks/whatsapp', { from, messageId: 'qc' + ++n, ...body });
const ivr = (body: Record<string, unknown>) => call<Record<string, unknown>>('POST', '/webhooks/ivr', { callId: 'qcall' + ++n, ...body });
type View = { id: string; state: string; parsed: ParsedRequest; taskTime: number; history: { note: string; state: string }[]; lateMin?: number | null; doneTasks?: string[] | null; error?: string; message?: string; confirmedFriendId?: string };
type Search = { request: View; top: { id: string; message: string; reasons: string[] }[]; excludedCounts: Record<string, number> };
const PH = { neha: '+919800000021', priya: '+919900000012', arjun: '+919800000077', sunita: '+919000000035', ankita: '+919700000008', kavya: '+919600000045', owner2: '+919822200001' };

const manual = (petIds: string[], time: number, tasks = ['feed'], hh = HH, tok = () => owner) => call<View>('POST', `${hh}/requests`, { manual: { tasks, petId: petIds[0], petIds, time, access: 'Key handover' } }, tok());
const search = (id: string, hh = HH, tok = () => owner) => call<Search>('POST', `${hh}/requests/${id}/search`, {}, tok());
const approve = (id: string, friendIds: string[], hh = HH, tok = () => owner) => call<View>('POST', `${hh}/requests/${id}/approve`, { friendIds, mode: friendIds.length > 1 ? 'all3' : 'one', approved: true }, tok());
const get = async (id: string, hh = HH, tok = () => owner) => (await call<View>('GET', `${hh}/requests/${id}`, undefined, tok())).body;
const friendYes = (id: string, tok: string) => call('POST', `/v1/me/requests/${id}/reply`, { reply: 'yes' }, tok);
/** Owner asks Priya, Priya says yes, owner confirms. Returns the confirmed request. */
async function confirmed(petIds: string[], time: number, tasks = ['feed'], friend: [string, () => string] = ['u_priya', () => priya], hh = HH, tok = () => owner) {
  const r = (await manual(petIds, time, tasks, hh, tok)).body;
  const s = await search(r.id, hh, tok); expect(s.body.top.map(t => t.id)).toContain(friend[0]);
  expect((await approve(r.id, [friend[0]], hh, tok)).status).toBe(200);
  await friendYes(r.id, friend[1]());
  const c = await call<View>('POST', `${hh}/requests/${r.id}/confirm`, { friendId: friend[0] }, tok());
  expect(c.body.state).toBe('Confirmed');
  return c.body;
}
const setFriend = (tok: string, body: Record<string, unknown>) => call<Record<string, unknown>>('PUT', '/v1/me/friend', body, tok);
const push = (re: RegExp) => adapters.outbox.filter(m => m.channel === 'push' && re.test(m.body));

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  adapters = mockAdapters(); clock = demoClock(at('15:00:00'));
  app = createApp({ db, adapters, clock, pepper: 'test', demoMode: true, limits: { requestsPerHour: 1000, invitesPerDay: 1000 } });
  owner = await signIn(PH.neha); priya = await signIn(PH.priya); arjun = await signIn(PH.arjun); sunita = await signIn(PH.sunita); ankita = await signIn(PH.ankita);
  // A second home in another society, with Priya as a friend too (capacity across homes, access control).
  owner2 = await signIn(PH.owner2);
  await call('POST', '/v1/consents', { language: 'en', items: [{ kind: 'terms', version: 'T-1.0', granted: true }, { kind: 'privacy', version: 'PN-1.0', granted: true }] }, owner2);
  hh2 = (await call<{ id: string }>('POST', '/v1/households', { displayName: 'Isha Rao', language: 'en', city: 'Mumbai', societyId: 'soc_hiranandani_mum', tower: 'Eden 2', flat: 'E2-501' }, owner2)).body.id;
  await call('POST', `/v1/households/${hh2}/pets`, { name: 'Coco', species: 'Dog', food: '1 cup kibble', allergies: 'None', medicines: 'None', vet_name: 'Dr. Rao', vet_phone: '+91 22 5555 1111' }, owner2);
  await db.query(`insert into friend_links(household_id, friend_user_id, status, distance_band, help_count, checked_in_count) values ($1,'u_priya','accepted',0,3,3)`, [hh2]);
  await tick();
}, 90000);

/** Each test leaves no request out to friends, so the next one starts clean. */
afterEach(async () => {
  for (const r of await db.query<{ id: string; household_id: string }>(`select id, household_id from friend_requests where state in ('Draft','Ready for search','Awaiting owner approval','Sent','Provisional hold','Accepted - pending owner confirmation','Confirmed')`))
    await call('POST', `/v1/households/${r.household_id}/requests/${r.id}/cancel`, {}, r.household_id === 'hh_demo' ? owner : owner2);
  await db.query(`update friend_profiles set paused=false, paused_until=null, discoverable=true, max_pets=1, species='["Dog","Cat","Other"]', windows='[[990,1260]]', capabilities='{"feed":true,"walk":true}' where user_id='u_priya'`);
  clock.set(at('15:00:00'));
});

/* ================================================================ Profile, city and society ================== */
describe('PAW-017 / PAW-018 / PAW-036 / R-11 profile, city and society', () => {
  it('lists societies by city; the same name in two cities stays two societies', async () => {
    const all = (await call<{ cities: { city: string }[] }>('GET', '/v1/societies', undefined, owner)).body;
    expect(all.cities.map(c => c.city)).toEqual(expect.arrayContaining(['Mumbai', 'Pune', 'Bengaluru', 'Hyderabad']));
    const mum = (await call<{ societies: { id: string; name: string }[] }>('GET', '/v1/societies?city=Mumbai&q=lake', undefined, owner)).body.societies;
    const pune = (await call<{ societies: { id: string; name: string }[] }>('GET', '/v1/societies?city=Pune&q=lake', undefined, owner)).body.societies;
    expect(mum.map(s => s.id)).toEqual(['soc_lakevista_mum']); expect(pune.map(s => s.id)).toEqual(['soc_lakevista_pune']);
    expect(mum[0]!.name).toBe(pune[0]!.name);
  });
  it('the owner sees and edits name, city, society, tower and flat; every change is logged without the values', async () => {
    const p0 = (await call<{ city: string; society_id: string; flat: string; canEdit: boolean }>('GET', `${HH}/profile`, undefined, owner)).body;
    expect(p0).toMatchObject({ city: 'Mumbai', society_id: 'soc_lakevista_mum', flat: 'B-1104', canEdit: true });
    const r = await call<{ changed: string[] }>('PUT', `${HH}/profile`, { tower: 'Tower C', flat: 'C-202' }, owner);
    expect(r.body.changed).toEqual(['tower', 'flat']);
    const log = (await db.query<{ detail: { fields: string[] } }>(`select detail from audit_log where household_id='hh_demo' and action='household.profile_changed' order by at desc limit 1`))[0]!;
    expect(log.detail.fields).toEqual(['tower', 'flat']); expect(JSON.stringify(log.detail)).not.toContain('C-202');
    expect(push(/Changed: tower, flat/).length).toBeGreaterThan(0);
    // Saving the same values again changes nothing and tells nobody.
    expect((await call<{ changed: string[] }>('PUT', `${HH}/profile`, { tower: 'Tower C', flat: 'C-202' }, owner)).body.changed).toEqual([]);
    // The form sends every field; only what changed is reported (no false address alerts).
    expect((await call<{ changed: string[] }>('PUT', `${HH}/profile`, { displayName: 'Neha Kulkarni', city: 'Mumbai', societyId: 'soc_lakevista_mum', tower: 'Tower D', flat: 'C-202' }, owner)).body.changed).toEqual(['tower']);
    await call('PUT', `${HH}/profile`, { tower: 'Tower B', flat: 'B-1104' }, owner);
  });
  it('a society from another city is refused; moving city needs that city’s society; a typed society is unverified', async () => {
    const bad = await call<{ message: string }>('PUT', `${HH}/profile`, { city: 'Mumbai', societyId: 'soc_lakevista_pune' }, owner);
    expect(bad.status).toBe(400); expect(bad.body.message).toMatch(/in Pune, not Mumbai/);
    expect((await call('PUT', `${HH}/profile`, { city: 'Pune', societyId: 'soc_lakevista_pune' }, owner)).status).toBe(200);
    expect((await call<{ city: string; society: string; society_verified: boolean }>('GET', `${HH}/profile`, undefined, owner)).body).toMatchObject({ city: 'Pune', society: 'Lake Vista CHS, Baner', society_verified: true });
    await call('PUT', `${HH}/profile`, { city: 'Mumbai', society: 'Green Acres CHS, Andheri' }, owner);
    expect((await call<{ society_verified: boolean }>('GET', `${HH}/profile`, undefined, owner)).body.society_verified).toBe(false);
    await call('PUT', `${HH}/profile`, { city: 'Mumbai', societyId: 'soc_lakevista_mum' }, owner);
    expect((await call<{ society_verified: boolean; society: string }>('GET', `${HH}/profile`, undefined, owner)).body).toMatchObject({ society_verified: true, society: 'Lake Vista CHS, Powai' });
  });
  it('a new home records city and society id; a mismatched pair is refused', async () => {
    expect((await db.query<{ city: string; society_id: string; society_verified: boolean }>(`select city, society_id, society_verified from households where id=$1`, [hh2]))[0]).toEqual({ city: 'Mumbai', society_id: 'soc_hiranandani_mum', society_verified: true });
    const t = await signIn('+919822200009');
    expect((await call<{ message: string }>('POST', '/v1/households', { displayName: 'X', language: 'en', city: 'Bengaluru', societyId: 'soc_myhome_hyd' }, t)).status).toBe(400);
  });
  it('only owners and co-owners edit; the backup never sees the flat; the helper can only report wrong details (PAW-019)', async () => {
    expect((await call('PUT', `${HH}/profile`, { tower: 'X' }, ankita)).status).toBe(403);
    expect((await call('PUT', `${HH}/profile`, { tower: 'X' }, sunita)).status).toBe(403);
    const b = await call<{ flat: string | null }>('GET', `${HH}/profile`, undefined, ankita);
    if (b.status === 200) expect(b.body.flat).toBeNull(); else expect(b.status).toBe(403);
    const r = await call<{ ok: boolean }>('POST', `${HH}/report-details`, { note: 'Tower shows B, I work in A' }, sunita);
    expect(r.body.ok).toBe(true);
    expect((await db.query(`select 1 from ops_cases where household_id='hh_demo' and title='Home details reported wrong'`)).length).toBe(1);
    expect(push(/helper says the society or tower shown is wrong/).length).toBe(1);
    expect((await call('POST', `${HH2()}/report-details`, {}, sunita)).status).toBe(403); // not her home
  });
});

/* ================================================================ Helper channels =========================== */
describe('PAW-020 to PAW-025, PAW-050, PAW-053, PAW-054, R-09 helper WhatsApp and basic phone', () => {
  it('a WhatsApp photo with today’s code is recorded once; a replayed message is ignored; a wrong code is flagged', async () => {
    clock.set(at('13:05:00')); await tick();
    const code = (await call<{ codes: Record<number, string>; today: number }>('GET', `${HH}/code-cards/current`, undefined, owner)).body;
    const ok = await call<{ photoCode: string }>('POST', '/webhooks/whatsapp', { from: PH.sunita, messageId: 'qc-photo-1', type: 'photo', taskId: `r1_${DAY}`, mediaRef: 'qc-img-1', caption: `done ${code.codes[code.today]}` });
    expect(ok.body.photoCode).toBe('today');
    expect((await call<{ status: string }>('POST', '/webhooks/whatsapp', { from: PH.sunita, messageId: 'qc-photo-1', type: 'photo', taskId: `r1_${DAY}`, mediaRef: 'qc-img-1', caption: 'done' })).body.status).toBe('duplicate_event');
    const wrong = await call<{ photoCode: string }>('POST', '/webhooks/whatsapp', { from: PH.sunita, messageId: 'qc-photo-2', type: 'photo', taskId: `r3_${DAY}`, mediaRef: 'qc-img-2', caption: 'done 0000' });
    expect(['wrong', 'old']).toContain(wrong.body.photoCode);
  });
  it('a keypad code from an unregistered phone never counts, even when it is today’s code (PAW-021, PAW-025)', async () => {
    const code = (await call<{ codes: Record<number, string>; today: number }>('GET', `${HH}/code-cards/current`, undefined, owner)).body;
    const r = await ivr({ from: '+919811199999', event: 'code', taskId: `r4_${DAY}`, digits: code.codes[code.today] });
    expect(r.body).toMatchObject({ registered: false, codeOk: false });
  });
  it('a helper can’t answer another helper’s task by keypad (PAW-025)', async () => {
    await db.query(`insert into users(id, phone_e164, display_name, language) values ('u_lata','+919000000099','Lata','hi') on conflict do nothing`);
    await db.query(`insert into memberships(id, household_id, user_id, role, status, accepted_at, method) values ('m_lata','hh_demo','u_lata','helper','active',now(),'ivr') on conflict do nothing`);
    await db.query(`insert into consent_records(id, user_id, household_id, kind, version, language, granted) values ('c_lata','u_lata','hh_demo','helper_monitoring','W1-1.0','hi',true) on conflict do nothing`);
    const code = (await call<{ codes: Record<number, string>; today: number }>('GET', `${HH}/code-cards/current`, undefined, owner)).body;
    const r = await ivr({ from: '+919000000099', event: 'code', taskId: `r4_${DAY}`, digits: code.codes[code.today] });
    expect([r.status, r.body.error]).toEqual([409, 'not_your_task']);
    await db.query(`update memberships set status='revoked' where id='m_lata'`);
  });
  it('commands: points, my data, help each answer; stop stops collection at once; start resumes (PAW-022)', async () => {
    // The demo clock is frozen, so compare what was sent before and after each command.
    const sent = async () => (await db.query<{ template: string }>(`select template from helper_messages where membership_id='m_sunita' and direction='out'`)).map(r => r.template);
    let before: string[] = await sent();
    const last = async () => { const now = await sent(); const added = now.slice(before.length); before = now; return added[added.length - 1] ?? now.filter(t => !before.includes(t))[0]; };
    await wa(PH.sunita, { type: 'text', text: 'points' }); expect(await last()).toBe('W_POINTS');
    await wa(PH.sunita, { type: 'text', text: 'help' }); expect(await last()).toBe('W_SUPPORT');
    await wa(PH.sunita, { type: 'text', text: 'my data' }); expect(await last()).toBe('W_MYDATA');
    await wa(PH.sunita, { type: 'text', text: 'stop' }); expect(await last()).toBe('W_STOPPED');
    const blocked = await call<{ error: string }>('POST', '/webhooks/whatsapp', { from: PH.sunita, messageId: 'qc-after-stop', type: 'photo', taskId: `r4_${DAY}`, mediaRef: 'qc-img-9' });
    expect([blocked.status, blocked.body.error]).toEqual([409, 'no_helper_consent']);
    await wa(PH.sunita, { type: 'text', text: 'start' });
    expect((await db.query<{ paused: boolean }>(`select paused from memberships where id='m_sunita'`))[0]!.paused).toBe(false);
    // Re-consent after start (the invite is sent again; nothing is collected until Yes).
    await wa(PH.sunita, { type: 'button', payload: 'consent_yes:hh_demo' });
  });
  it('a WhatsApp outage falls back to SMS and every attempt is logged with a masked number (PAW-053)', async () => {
    await call('POST', '/demo/outage', { channel: 'whatsapp', down: true });
    await call('POST', `${HH}/helpers/m_sunita/practice`, {}, owner);
    await call('POST', '/demo/outage', { channel: 'whatsapp', down: false });
    const rows = await db.query<{ channel: string; status: string; recipient_masked: string }>(`select channel, status, recipient_masked from delivery_log order by id desc limit 4`);
    expect(rows.map(r => r.status)).toEqual(expect.arrayContaining(['failed', 'fallback_sent']));
    expect(rows.every(r => !r.recipient_masked.includes('9000000035'))).toBe(true);
  });
});

/* ================================================================ Privacy =================================== */
describe('PAW-023 / R-10 privacy: phone and flat stay hidden until consent and confirmation', () => {
  it('the owner never gets helper or friend phone numbers; friends get no flat or key before confirmation; nothing after', async () => {
    const helpers = (await call<Record<string, unknown>[]>('GET', `${HH}/helpers`, undefined, owner)).body;
    expect(JSON.stringify(helpers)).not.toMatch(/9000000035/);
    const friends = (await call<Record<string, unknown>[]>('GET', `${HH}/friends`, undefined, owner)).body;
    expect(JSON.stringify(friends)).not.toMatch(/99000000|98000000/);
    const r = (await manual(['bruno'], 1080)).body; const s = await search(r.id);
    expect(s.body.top.find(t => t.id === 'u_priya')!.message).not.toMatch(/B-1104|Ankita/);
    await approve(r.id, ['u_priya']);
    expect((await call('GET', `/v1/me/requests/${r.id}/access`, undefined, priya)).status).toBe(403);
    const before = (await call<{ messages: { body: string }[] }>('GET', '/v1/me/friend', undefined, priya)).body.messages.map(m => m.body).join('\n');
    expect(before).not.toMatch(/B-1104/);
    await friendYes(r.id, priya); await call('POST', `${HH}/requests/${r.id}/confirm`, { friendId: 'u_priya' }, owner);
    expect((await call<{ flat: string }>('GET', `/v1/me/requests/${r.id}/access`, undefined, priya)).body.flat).toBe('B-1104');
    expect((await call('GET', `/v1/me/requests/${r.id}/access`, undefined, arjun)).status).toBe(404); // not his request
    await call('POST', `${HH}/requests/${r.id}/cancel`, {}, owner);
    expect((await call('GET', `/v1/me/requests/${r.id}/access`, undefined, priya)).status).toBe(403);
    expect((await db.query(`select 1 from audit_log where action='access.viewed' and detail->>'request'=$1`, [r.id])).length).toBeGreaterThanOrEqual(3);
  });
});

/* ================================================================ Points ===================================== */
describe('PAW-024 / R-14 points are credited once per verified task', () => {
  it('closing the same day twice never adds points twice; the owner sees the history', async () => {
    clock.set(at('23:59:00'));
    await call('POST', `${HH}/day/close`, {}, owner); await call('POST', `${HH}/day/close`, {}, owner); await tick(); await tick();
    const rows = await db.query<{ task_id: string; n: number }>(`select task_id, count(*)::int as n from reward_ledger where household_id='hh_demo' and task_id is not null group by task_id`);
    expect(rows.every(r => r.n === 1)).toBe(true);
    const w = (await call<{ helpers: { name: string; history: unknown[] }[] }>('GET', `${HH}/wallet`, undefined, owner)).body;
    expect(w.helpers.find(h => h.name === 'Sunita')!.history.length).toBeGreaterThan(0);
  });
});

/* ================================================================ Friend settings ============================ */
describe('PAW-027 to PAW-032, PAW-035, R-04 to R-06, R-13, R-20 friend visibility, pause, hours and tasks', () => {
  it('Friends can find me OFF: out of search at 0 s, 59 s, 60 s and 90 s; still listed for the owner, not findable', async () => {
    clock.set(at('15:00:00'));
    const r = (await manual(['bruno'], 1080)).body; expect((await search(r.id)).body.top.map(t => t.id)).toContain('u_priya');
    expect((await setFriend(priya, { discoverable: false })).body.removedFromSearch).toBe('immediately');
    for (const s of ['15:00:00', '15:00:59', '15:01:00', '15:01:30']) { clock.set(at(s)); expect((await search(r.id)).body.top.map(t => t.id)).not.toContain('u_priya'); }
    expect((await approve(r.id, ['u_priya'])).body.error).toBe('not_eligible');
    const f = (await call<{ id: string; findable: boolean }[]>('GET', `${HH}/friends`, undefined, owner)).body.find(x => x.id === 'u_priya')!;
    expect(f.findable).toBe(false);
    await setFriend(priya, { discoverable: true });
    expect((await search(r.id)).body.top.map(t => t.id)).toContain('u_priya');
  });
  it('Pause: no new requests, the friend stays in the Friends list as Paused, a confirmed visit stays booked (PAW-028, PAW-035)', async () => {
    const v = await confirmed(['bruno'], 1080);
    const p = await setFriend(priya, { paused: true });
    expect(p.body).toMatchObject({ pauseActive: true, pausedUntil: null, stillConfirmed: 1 });
    const r = (await manual(['misty'], 1140)).body; const s = await search(r.id);
    expect(s.body.top.map(t => t.id)).not.toContain('u_priya'); expect(s.body.excludedCounts['Paused requests']).toBeGreaterThanOrEqual(1);
    expect((await call<{ id: string; availability: string }[]>('GET', `${HH}/friends`, undefined, owner)).body.find(x => x.id === 'u_priya')!.availability).toBe('Paused');
    expect((await get(v.id)).state).toBe('Confirmed');
    expect((await call<{ state: string }>('POST', `/v1/me/requests/${v.id}/arrived`, {}, priya)).status).toBe(200);
    expect((await call<{ state: string }>('POST', `/v1/me/requests/${v.id}/done`, {}, priya)).body.state).toBe('Completed');
    expect((await setFriend(priya, { paused: false })).body).toMatchObject({ pauseActive: false });
  });
  it('Pause for 6 days counts today as day 1, by India time, even just after midnight (PAW-029)', async () => {
    clock.set(at('00:10:00', '2026-11-07')); // 18:40 UTC on 6 Nov
    const r = await setFriend(priya, { pauseDays: 6 });
    expect(r.body).toMatchObject({ pauseActive: true, pausedUntil: '2026-11-12', resumesOn: '2026-11-13' });
    const me = (await call<{ profile: { pause_active: boolean; paused: boolean; resumes_on: string } }>('GET', '/v1/me/friend', undefined, priya)).body.profile;
    expect(me).toMatchObject({ pause_active: true, paused: false, resumes_on: '2026-11-13' });
    // Turning the switch off ends a timed pause straight away.
    expect((await setFriend(priya, { paused: false })).body).toMatchObject({ pauseActive: false, pausedUntil: null });
  });
  it('free 4:30–9 PM: 4:15 no, 4:30 yes, 8:50 for 10 min yes, 8:55 for 10 min no (PAW-030, R-13 boundaries)', async () => {
    await setFriend(priya, { windows: [[990, 1260]] });
    const tryAt = async (t: number) => { const r = (await manual(['bruno'], t)).body; const ok = (await search(r.id)).body.top.some(x => x.id === 'u_priya'); await call('POST', `${HH}/requests/${r.id}/cancel`, {}, owner); return ok; };
    expect(await tryAt(975)).toBe(false); expect(await tryAt(990)).toBe(true); expect(await tryAt(1250)).toBe(true); expect(await tryAt(1255)).toBe(false);
  });
  it('an overnight window 9 PM–6 AM matches 11 PM and 5:30 AM, not 6 AM; a window with the same start and end is refused (R-13)', async () => {
    expect((await setFriend(priya, { windows: [[1260, 360]] })).status).toBe(200);
    expect(windowCovers([1260, 360], 1380, 1390)).toBe(true); expect(windowCovers([1260, 360], 330, 340)).toBe(true);
    expect(windowCovers([1260, 360], 360, 370)).toBe(false); expect(windowCovers([1260, 360], 1430, 1450)).toBe(true);
    const r = (await manual(['bruno'], 1380)).body; expect((await search(r.id)).body.top.map(t => t.id)).toContain('u_priya');
    const bad = await setFriend(priya, { windows: [[1020, 1020]] });
    expect(bad.status).toBe(400); expect(bad.body.message).toBe('A free time needs a different start and end.');
  });
  it('task choices: no walks means no walk requests; no medicines means no medicine requests (PAW-031, PAW-048)', async () => {
    await setFriend(priya, { capabilities: { feed: true, walk: false, meds: false, large: false } });
    const w = (await manual(['bruno'], 1080, ['walk'])).body; const s = await search(w.id);
    expect(s.body.top.map(t => t.id)).not.toContain('u_priya'); expect(s.body.excludedCounts['Has not chosen walk']).toBeGreaterThanOrEqual(1);
    await call('POST', `${HH}/requests/${w.id}/cancel`, {}, owner);
    const m = (await manual(['bruno'], 1110, ['meds'])).body; const s2 = await search(m.id);
    expect(s2.body.top.map(t => t.id)).toEqual(['u_arjun']); // the only friend who chose medicines and is free then
  });
  it('settings survive a refresh, sign-out and sign-in (PAW-032, R-20)', async () => {
    await setFriend(priya, { windows: [[1050, 1230]], capabilities: { feed: true, walk: true, meds: false, large: false }, keyMode: 'yes', maxPets: 2, species: ['Dog'], pauseDays: 3 });
    await call('POST', '/v1/auth/logout', {}, priya);
    expect((await call('GET', '/v1/me/friend', undefined, priya)).status).toBe(401);
    priya = await signIn(PH.priya);
    const p = (await call<{ profile: Record<string, unknown> }>('GET', '/v1/me/friend', undefined, priya)).body.profile;
    expect(p).toMatchObject({ windows: [[1050, 1230]], key_mode: 'yes', max_pets: 2, species: ['Dog'], pause_active: true, paused_until: '2026-11-08' });
    expect(p.updated_at).toBeTruthy();
    await setFriend(priya, { keyMode: 'handover', paused: false });
  });
});

/* ================================================================ Capacity and several pets ================= */
describe('PAW-026, PAW-033, PAW-034, PAW-043, R-02, R-03 several pets, capacity and double booking', () => {
  it('one request for Bruno and Misty: both pets named in the message, each with their own instructions (PAW-033, R-02)', async () => {
    await setFriend(priya, { maxPets: 2 }); await setFriend(arjun, { maxPets: 2 });
    const r = (await manual(['bruno', 'misty'], 1080, ['feed', 'meds'])).body;
    expect(r.parsed.petIds).toEqual(['bruno', 'misty']);
    expect(r.parsed.medsInstructions).toBe('Bruno: Joint supplement, 1 chewable with lunch, as on the vet’s card'); // Misty has none
    const s = await search(r.id);
    expect(s.body.top.map(t => t.id)).toEqual(['u_arjun']); // only Arjun gives medicines
    expect(s.body.top[0]!.message).toMatch(/Bruno और Misty|ब्रूनो और मिस्टी/); // Arjun reads Hindi
    const f = (await manual(['bruno', 'misty'], 1110, ['feed'])).body; const s2 = await search(f.id);
    expect(s2.body.top.find(t => t.id === 'u_priya')!.message).toMatch(/feed Bruno and Misty/);
    expect(s2.body.top.find(t => t.id === 'u_priya')!.reasons).toContain('Happy to look after 2 pets at once');
    await setFriend(arjun, { maxPets: 1 });
  });
  it('the parser understands “both” and two names; editing the pets refreshes medicine instructions', async () => {
    const ctx = { now: 900, pets: [{ id: 'bruno', name: 'Bruno', species: 'Dog', medsInstructions: 'x' }, { id: 'misty', name: 'Misty', species: 'Cat', medsInstructions: 'None' }], defaultAccess: null };
    expect(parseRequestRules('Can someone feed both pets at 7 pm? key with Ankita', ctx).parsed.petIds).toEqual(['bruno', 'misty']);
    expect(parseRequestRules('Feed Bruno and Misty at 7 pm, key with Ankita', ctx).parsed.petIds).toEqual(['bruno', 'misty']);
    expect(parseRequestRules('Feed Bruno at 7 pm, key with Ankita', ctx).parsed.petIds).toBeUndefined();
    const r = (await manual(['misty'], 1080, ['feed', 'meds'])).body;
    const e = await call<View>('PATCH', `${HH}/requests/${r.id}`, { fields: { petIds: ['misty', 'bruno'] } }, owner);
    expect(e.body.parsed.medsInstructions).toBe('Bruno: Joint supplement, 1 chewable with lunch, as on the vet’s card');
    expect((await call<View>('PATCH', `${HH}/requests/${r.id}`, { fields: { petIds: ['misty', 'u_other'] } }, owner)).status).toBe(400);
  });
  it('a friend who looks after one pet at a time is not offered a two-pet visit; a dogs-only friend is not offered the cat (PAW-026)', async () => {
    const r = (await manual(['bruno', 'misty'], 1080)).body; const s = await search(r.id);
    expect(s.body.top.map(t => t.id)).not.toContain('u_priya'); expect(s.body.excludedCounts['Looks after up to 1 pet at a time']).toBeGreaterThanOrEqual(1);
    await setFriend(priya, { species: ['Dog'] });
    const c = (await manual(['misty'], 1110)).body; const s2 = await search(c.id);
    expect(s2.body.top.map(t => t.id)).not.toContain('u_priya'); expect(s2.body.excludedCounts['Does not look after this kind of pet']).toBeGreaterThanOrEqual(1);
  });
  it('booked at 6 PM in one home: not offered at 6:10 in another home, offered again at 7 (PAW-034, R-03)', async () => {
    await confirmed(['bruno'], 1080); // 6:00–6:10
    const coco = (await call<{ id: string }[]>('GET', `${HH2()}/pets`, undefined, owner2)).body[0]!.id;
    const a = (await manual([coco], 1085, ['feed'], HH2(), () => owner2)).body; const s = await search(a.id, HH2(), () => owner2);
    expect(s.body.top.map(t => t.id)).not.toContain('u_priya'); expect(s.body.excludedCounts['Already helping someone']).toBe(1);
    const b = (await manual([coco], 1140, ['feed'], HH2(), () => owner2)).body;
    expect((await search(b.id, HH2(), () => owner2)).body.top.map(t => t.id)).toContain('u_priya');
  });
  it('two owners confirm the same friend for overlapping visits: the second is refused, not double-booked (PAW-043)', async () => {
    const coco = (await call<{ id: string }[]>('GET', `${HH2()}/pets`, undefined, owner2)).body[0]!.id;
    const a = (await manual(['bruno'], 1080)).body; await search(a.id); await approve(a.id, ['u_priya']);
    const b = (await manual([coco], 1080, ['feed'], HH2(), () => owner2)).body; await search(b.id, HH2(), () => owner2); await approve(b.id, ['u_priya'], HH2(), () => owner2);
    await friendYes(a.id, priya); await friendYes(b.id, priya);
    // While A's Yes waits for its owner, B's search already counts her as busy — but B was sent before that.
    const [ca, cb] = [await call<View>('POST', `${HH}/requests/${a.id}/confirm`, { friendId: 'u_priya' }, owner), await call<View>('POST', `${HH2()}/requests/${b.id}/confirm`, { friendId: 'u_priya' }, owner2)];
    expect(ca.body.state).toBe('Confirmed');
    expect([cb.status, cb.body.error]).toEqual([409, 'friend_busy']);
    expect(cb.body.message).toMatch(/just been booked for another visit/);
  });
  it('travel time: a friend 8 min away is not offered for a visit starting in 5 min (PAW-040)', () => {
    const base: Omit<FriendProfile, 'id' | 'displayName' | 'distanceBand'> = { distanceLabel: '', language: 'en', inviteAccepted: true, discoverable: true, paused: false, blocked: false, windows: [[0, 1439]], windowsLabel: '', capabilities: { feed: true }, key: 'yes', stairsOk: true, capacity: 1, activeRequests: 0, helpCount: 0, checkedInCount: 0, responseBand: '', responseRank: 1, updatedLabel: '' };
    const req = { tasks: ['feed'], petId: 'p', time: 600, durationMin: 10, access: 'Key handover', lift: null, urgency: 'Today', medsInstructions: null, sources: {} } as ParsedRequest;
    const m = matchFriends(req, [{ ...base, id: 'near', displayName: 'Near', distanceBand: 0 }, { ...base, id: 'far', displayName: 'Far', distanceBand: 3 }], { maxBand: 3, minutesUntilStart: 5 });
    expect(m.eligible.map(x => x.friend.id)).toEqual(['near']); expect(m.excludedCounts['Can’t get there in time']).toBe(1);
  });
});

/* ================================================================ Running late ============================== */
describe('PAW-041, PAW-045, PAW-051 the friend is running late', () => {
  it('“late 20” in the app: the owner gets the new arrival time; the no-show alarm waits for it', async () => {
    const v = await confirmed(['bruno'], 1080);
    const r = await call<{ lateMin: number }>('POST', `/v1/me/requests/${v.id}/late`, { minutes: 20 }, priya);
    expect(r.body.lateMin).toBe(20);
    expect(push(/Priya is running about 20 min late\. New arrival about 6:20 PM/).length).toBe(1);
    expect((await call<{ lateMin: number }>('POST', `/v1/me/requests/${v.id}/late`, { minutes: 20 }, priya)).status).toBe(200);
    expect((await get(v.id)).history.filter(h => /running about 20 min late/.test(h.note))).toHaveLength(1); // the repeat changed nothing
    clock.set(at('18:21:00')); await tick(); expect((await get(v.id)).state).toBe('Confirmed'); // without the delay this was a no-show
    clock.set(at('18:30:00')); await tick(); expect((await get(v.id)).state).toBe('No-show');
  });
  it('by WhatsApp or SMS text: “late 15” and “10 min late” both work; after check-in a delay is refused', async () => {
    const v = await confirmed(['bruno'], 1080);
    await wa(PH.priya, { type: 'text', text: 'late 15' }); expect((await get(v.id)).lateMin).toBe(15);
    await wa(PH.priya, { type: 'text', text: '10 min late' }); expect((await get(v.id)).lateMin).toBe(10);
    await call('POST', `/v1/me/requests/${v.id}/arrived`, {}, priya);
    const r = await call<{ message: string }>('POST', `/v1/me/requests/${v.id}/late`, { minutes: 10 }, priya);
    expect([r.status, r.body.message]).toEqual([409, 'You have already checked in.']);
    expect((await call('POST', `/v1/me/requests/${v.id}/late`, { minutes: 500 }, priya)).status).toBe(400);
  });
});

/* ================================================================ Mid-visit emergency ======================= */
describe('PAW-056 to PAW-062 the friend has an emergency and must leave', () => {
  it('after feeding: Interrupted (not Completed), feeding recorded, owner and co-owner called, access removed, backups asked', async () => {
    const v = await confirmed(['bruno'], 1080, ['feed', 'walk']);
    clock.set(at('18:02:00')); await call('POST', `/v1/me/requests/${v.id}/arrived`, {}, priya);
    const helps = (await db.query<{ n: number }>(`select help_count as n from friend_links where household_id='hh_demo' and friend_user_id='u_priya'`))[0]!.n;
    const calls0 = adapters.outbox.filter(m => m.channel === 'call').length;
    const r = await call<{ state: string; done: string[] }>('POST', `/v1/me/requests/${v.id}/emergency`, { done: ['feed', 'meds'] }, priya);
    expect(r.body).toEqual({ ok: true, state: 'Interrupted', done: ['feed'] }); // medicine wasn't part of the visit
    expect(push(/URGENT: Priya had an emergency and has left after: feed/).length).toBe(1);
    expect(adapters.outbox.filter(m => m.channel === 'call').length - calls0).toBe(2); // Neha and Rohan
    expect((await call('GET', `/v1/me/requests/${v.id}/access`, undefined, priya)).status).toBe(403);
    const ev = await db.query<{ state: string; note: string }>(`select state, note from task_events where task_id=$1 order by at desc, id desc limit 1`, ['cover_' + v.id]);
    expect(ev[0]).toMatchObject({ state: 'Partly done' }); expect(ev[0]!.note).toMatch(/after: feed; backups asked/);
    const cover = (await call<{ jobs: { taskIds?: string[]; reason?: string; state?: string }[] }>('GET', `${HH}/cover`, undefined, owner)).body;
    expect(JSON.stringify(cover)).toMatch(new RegExp('cover_' + v.id));
    // Done after leaving, a second emergency, or a late check-in change nothing; help count is not raised.
    const d = await call<{ error: string; message: string }>('POST', `/v1/me/requests/${v.id}/done`, {}, priya);
    expect([d.status, d.body.message]).toEqual([409, 'This visit was interrupted. The owner’s backups have taken over.']);
    expect((await call<{ state: string; done: string[] }>('POST', `/v1/me/requests/${v.id}/emergency`, { done: [] }, priya)).body).toMatchObject({ state: 'Interrupted', done: ['feed'] }); // a repeat changes nothing
    expect((await db.query<{ n: number }>(`select help_count as n from friend_links where household_id='hh_demo' and friend_user_id='u_priya'`))[0]!.n).toBe(helps);
    expect((await get(v.id)).doneTasks).toEqual(['feed']);
  });
  it('by WhatsApp / SMS: “emergency, fed already” before the walk works from a basic phone (PAW-061)', async () => {
    const v = await confirmed(['bruno'], 1110, ['feed', 'walk']);
    await wa(PH.priya, { type: 'text', text: 'emergency, done feed, cannot walk' });
    const g = await get(v.id); expect([g.state, g.doneTasks]).toEqual(['Interrupted', ['feed']]);
  });
  it('before starting: nothing marked done, the task is Missed and goes to backups (PAW-059)', async () => {
    const v = await confirmed(['bruno'], 1140, ['feed']);
    await call('POST', `/v1/me/requests/${v.id}/emergency`, {}, priya);
    const ev = (await db.query<{ state: string; note: string }>(`select state, note from task_events where task_id=$1 order by at desc, id desc limit 1`, ['cover_' + v.id]))[0]!;
    expect(ev.state).toBe('Missed'); expect(ev.note).toMatch(/had an emergency and left; backups asked/);
  });
});

/* ================================================================ Check-in, duplicates, access control ====== */
describe('PAW-047, PAW-054, PAW-062, R-12, R-17 check-in, duplicate taps across channels, access control', () => {
  it('a second “I’ve arrived” and a second Done change nothing; Done never counts twice', async () => {
    const v = await confirmed(['bruno'], 1080);
    await call('POST', `/v1/me/requests/${v.id}/arrived`, {}, priya); await call('POST', `/v1/me/requests/${v.id}/arrived`, {}, priya);
    await wa(PH.priya, { type: 'button', payload: `ff_arrived:${v.id}` });
    expect((await get(v.id)).history.filter(h => h.note === 'Friend checked in')).toHaveLength(1);
    const h0 = (await db.query<{ n: number }>(`select help_count as n from friend_links where household_id='hh_demo' and friend_user_id='u_priya'`))[0]!.n;
    const [d1, d2] = await Promise.all([call<{ state: string }>('POST', `/v1/me/requests/${v.id}/done`, {}, priya), call<{ state: string }>('POST', `/v1/me/requests/${v.id}/done`, {}, priya)]);
    expect([d1.body.state, d2.body.state]).toEqual(['Completed', 'Completed']);
    expect((await db.query<{ n: number }>(`select help_count as n from friend_links where household_id='hh_demo' and friend_user_id='u_priya'`))[0]!.n).toBe(h0 + 1);
    expect((await call('POST', `/v1/me/requests/${v.id}/cancel`, {}, priya)).status).toBe(409);
  });
  it('Yes in the app and on WhatsApp at the same moment counts once (PAW-054)', async () => {
    const r = (await manual(['bruno'], 1080)).body; await search(r.id); await approve(r.id, ['u_priya']);
    const pushes0 = push(/Priya said yes/).length;
    await Promise.all([friendYes(r.id, priya), wa(PH.priya, { type: 'button', payload: `ff_yes:${r.id}` })]);
    const g = await get(r.id);
    expect(g.state).toBe('Accepted - pending owner confirmation');
    expect(g.history.filter(h => /said yes/.test(h.note))).toHaveLength(1);
    expect(push(/Priya said yes/).length - pushes0).toBe(1);
  });
  it('another owner, another friend or a signed-out session can’t read or act on this request (R-17)', async () => {
    const v = await confirmed(['bruno'], 1080);
    expect((await call('GET', `${HH}/requests/${v.id}`, undefined, owner2)).status).toBe(403);
    expect((await call('GET', `${HH2()}/requests/${v.id}`, undefined, owner2)).status).toBe(404);
    expect((await call('POST', `${HH2()}/requests/${v.id}/cancel`, {}, owner2)).status).toBe(404);
    expect((await call('POST', `/v1/me/requests/${v.id}/done`, {}, arjun)).status).toBe(404);
    expect((await call('POST', `/v1/me/requests/${v.id}/emergency`, {}, arjun)).status).toBe(404);
    expect((await call('GET', `${HH}/requests/${v.id}`, undefined, 'not-a-token')).status).toBe(401);
    expect((await get(v.id)).state).toBe('Confirmed');
  });
  it('localisation: Hindi and Marathi friends get their language; unsupported languages are refused, not half-translated (R-18)', async () => {
    const r = (await manual(['bruno'], 1080, ['feed', 'walk'])).body; const s = await search(r.id);
    expect(s.body.top.find(t => t.id === 'u_arjun')?.message).toMatch(/नमस्ते/);
    expect((await setFriend(priya, { language: 'te' })).status).toBe(400);
  });
});

/* ================================================================ Seven days on the demo clock ============== */
describe('R-05 / R-08 / PAW-009 / PAW-010 / PAW-029 seven days on the clock (6-day pause, routine, alerts, points)', () => {
  let d2: Db, a2: ReturnType<typeof createApp>, ad2: ReturnType<typeof mockAdapters>, ck: ReturnType<typeof demoClock>;
  const A = () => a2;
  const c2 = <T = Record<string, unknown>>(m: string, p: string, b?: unknown, t?: string) => call<T>(m, p, b, t, A);
  const days = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'];
  const summary: Record<string, unknown>[] = [];

  beforeAll(async () => {
    d2 = await openDb({ dataDir: 'memory' }); await migrate(d2); await seedDemo(d2);
    ad2 = mockAdapters(); ck = demoClock(`${days[0]}T08:00:00+05:30`);
    a2 = createApp({ db: d2, adapters: ad2, clock: ck, pepper: 'test', demoMode: true, limits: { requestsPerHour: 1000 } });
  }, 60000);

  it('runs 6 Nov to 12 Nov: pause holds for 6 days and ends on the 7th; routine, alerts and points stay single', async () => {
    const neha = await signIn(PH.neha, A), pr = await signIn(PH.priya, A), su = PH.sunita;
    // Day 1: Priya pauses for 6 days; Neha adds a one-off task for today only.
    expect((await c2<{ pausedUntil: string; resumesOn: string }>('PUT', '/v1/me/friend', { pauseDays: 6 }, pr)).body).toMatchObject({ pausedUntil: '2026-11-11', resumesOn: '2026-11-12' });
    expect((await c2('POST', `${HH}/routine`, { petId: 'misty', title: 'Vet drops', type: 'other', due: 1200, assignee: 'owner', oneOffToday: true }, neha)).status).toBe(201);
    let k = 0;
    for (const [i, date] of days.entries()) {
      const T = (hm: string) => ck.set(`${date}T${hm}:00+05:30`);
      const run = async (hm: string) => { T(hm); await c2('POST', '/jobs/tick'); };
      // Paused all day on days 1–6, at the first and last minute too; free again on the 7th.
      for (const hm of ['00:00', '12:00', '23:59']) {
        T(hm); const f = (await c2<{ id: string; availability: string }[]>('GET', `${HH}/friends`, undefined, neha)).body.find(x => x.id === 'u_priya')!;
        expect(f.availability.startsWith('Paused'), `${date} ${hm}`).toBe(i < 6);
      }
      for (const hm of ['07:00', '12:45', '13:00']) await run(hm);
      // Sunita sends photo evidence for lunch every day except the 3rd.
      if (i !== 2) await c2('POST', '/webhooks/whatsapp', { from: su, messageId: `day${i}-lunch`, type: 'photo', taskId: `r1_${date}`, mediaRef: `img-${date}`, caption: 'done' });
      for (const hm of ['13:16', '13:31', '16:00', '16:16', '20:00', '23:59']) await run(hm);
      await run('23:59'); // a second run in the same minute must not add anything
      const tasks = await d2.query<{ id: string }>(`select id from care_tasks where household_id='hh_demo' and care_date=$1 and id like 'r%'`, [date]);
      const ids = tasks.map(t => t.id.replace('_' + date, '')).sort();
      expect(ids.filter(x => /^r[1-4]$/.test(x)), date).toEqual(['r1', 'r2', 'r3', 'r4']);
      const oneOff = await d2.query(`select 1 from care_tasks where household_id='hh_demo' and care_date=$1 and title='Vet drops'`, [date]);
      expect(oneOff.length, date).toBe(i === 0 ? 1 : 0);
      const alerts = await d2.query<{ n: number }>(`select count(*)::int as n from notifications where dedupe_key=$1`, [`esc:r2_${date}:1`]);
      expect(alerts[0]!.n, `medicine alert ${date}`).toBe(1);
      const dup = await d2.query<{ n: number }>(`select count(*)::int as n from (select dedupe_key from notifications where household_id='hh_demo' group by dedupe_key having count(*) > 1) x`);
      expect(dup[0]!.n).toBe(0);
      const earned = await d2.query<{ task_id: string; n: number }>(`select task_id, count(*)::int as n from reward_ledger where task_id like $1 group by task_id`, [`%_${date}`]);
      expect(earned.every(e => e.n === 1)).toBe(true);
      expect(earned.some(e => e.task_id === `r1_${date}`), `lunch points ${date}`).toBe(i !== 2);
      summary.push({ date, paused: i < 6, tasks: ids.length, medicineAlerts: alerts[0]!.n, lunchPoints: earned.some(e => e.task_id === `r1_${date}`) });
      k++;
    }
    expect(k).toBe(7);
    // After the pause: Priya is offered again, and she can still turn on a new pause.
    ck.set('2026-11-12T15:00:00+05:30');
    const r = (await c2<View>('POST', `${HH}/requests`, { manual: { tasks: ['feed'], petId: 'bruno', time: 1080, access: 'Key handover' } }, neha)).body;
    expect((await c2<Search>('POST', `${HH}/requests/${r.id}/search`, {}, neha)).body.top.map(t => t.id)).toContain('u_priya');
    // Visibility OFF is not overridden when a pause ends.
    await c2('PUT', '/v1/me/friend', { discoverable: false, pauseDays: 1 }, pr);
    ck.set('2026-11-13T15:00:00+05:30');
    const r2 = (await c2<View>('POST', `${HH}/requests`, { manual: { tasks: ['feed'], petId: 'misty', time: 1080, access: 'Key handover' } }, neha)).body;
    expect((await c2<Search>('POST', `${HH}/requests/${r2.id}/search`, {}, neha)).body.top.map(t => t.id)).not.toContain('u_priya');
    console.log('7-day run', JSON.stringify(summary));
  }, 240000);
});
