/** v1.1.0 cover continuity through the real API, webhooks and minute job (PRD v1.4 17.1 rows, PS-127 to PS-141). */
import { describe, it, expect } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

const DAY = '2026-11-06', at = (hm: string, day = DAY) => `${day}T${hm}:00+05:30`, HH = '/v1/households/hh_demo';
const SUNITA = '+919000000035', DESAI = '+919800000040', ANKITA = '+919700000008', ROHAN = '+919800000022', PRIYA = '+919900000012';
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function world(prep?: (db: Db) => Promise<void>) {
  const db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db); if (prep) await prep(db);
  const adapters = mockAdapters(), clock = demoClock(at('09:00'));
  const app = createApp({ db, adapters, clock, pepper: 'test', demoMode: true, limits: { requestsPerHour: 1000 } });
  let n = 0;
  const call = async (method: string, path: string, body?: unknown, token?: string) => { const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() as J }; };
  const signIn = async (phone: string) => { const r = await call('POST', '/auth/otp/request', { phone }); return (await call('POST', '/auth/otp/verify', { phone, code: r.body.demoCode })).body.token as string; };
  const owner = await signIn('+919800000021');
  const tick = () => call('POST', '/jobs/tick');
  const to = async (hm: string, day = DAY) => { clock.set(at(hm, day)); return tick(); };
  const wa = (from: string, b: { payload?: string; text?: string; type?: string; messageId?: string }) => call('POST', '/webhooks/whatsapp', { from, messageId: b.messageId ?? 'm' + ++n, type: b.type ?? (b.payload ? 'button' : 'text'), payload: b.payload, text: b.text });
  const cover = async () => (await call('GET', `${HH}/cover`, undefined, owner)).body;
  const coverOf = async (id: string) => (await db.query<{ state: string; reason: string | null; person_name: string | null; job_id: string | null; lost_by: string | null }>(`select * from task_cover where task_id=$1`, [id]))[0]!;
  const job = async (id: string) => (await call('GET', `${HH}/cover/jobs/${id}`, undefined, owner)).body;
  const helperMsgs = () => db.query<{ template: string | null; body: string; gloss: string | null; buttons: { id: string; label: string }[] | null }>(`select template, body, gloss, buttons from helper_messages where membership_id='m_sunita' order by at, id`);
  const coverMsgs = (pid: string) => db.query<{ direction: string; template: string | null; body: string; buttons: { id: string }[] | null }>(`select direction, template, body, buttons from cover_messages where person_id=$1 order by at, seq`, [pid]);
  const remId = async (date = DAY, key = `hh_demo_${DAY}_v2|m_sunita`) => (await db.query<{ id: string }>(`select id from reminder where care_date=$1 and visit_key=$2`, [date, key]))[0]?.id;
  const T = (rid: string, date = DAY) => `${rid}_${date}`;
  return { db, adapters, clock, app, call, signIn, owner, tick, to, wa, cover, coverOf, job, helperMsgs, coverMsgs, remId, T };
}

describe('PS-127 reminder, PS-128 can’t make it, PS-130 backups, PS-137 checklist, PS-138 handling note', () => {
  it('helper taps Can’t make it at 2:30 → At risk → backups in order → Mrs Desai reads the note, accepts → owner confirms → gate and key', async () => {
    const w = await world();
    await w.to('14:30');
    const rem = await w.remId(); expect(rem).toBeTruthy();
    const msg = (await w.helperMsgs()).find(m => m.template === 'cover_reminder')!;
    expect(msg.body).toContain('नमस्कार सुनीता ताई'); expect(msg.gloss).toContain('Will you come?'); expect(msg.buttons!.map(b => b.id)).toEqual([`cover_yes:${rem}`, `cover_cant:${rem}`, `cover_sub:${rem}`]);
    expect((await w.coverOf(w.T('r4'))).state).toBe('Assigned');
    await w.wa(SUNITA, { payload: `cover_cant:${rem}` });
    const c = await w.coverOf(w.T('r4'));
    expect(c.state).toBe('AskingBackups'); expect(c.reason).toContain('can’t make it'); expect(c.lost_by).toBe('m_sunita');
    const j = await w.job(c.job_id!);
    expect(j.asks.map((a: J) => a.personId)).toEqual(['bk_desai', 'bk_ankita']); // key holders first: the owner is out at 4 PM
    expect((await w.db.query(`select 1 from audit_log where action='access.revoked'`)).length).toBeGreaterThan(0);
    expect(w.adapters.outbox.some(o => o.channel === 'push' && /is at risk/.test(o.body))).toBe(true);
    // no address, gate or key before acceptance + owner approval (9.5)
    expect((await w.coverMsgs('bk_desai')).map(m => m.body).join(' ')).not.toMatch(/B-1104/);
    // PS-138: first-time carer must read the handling note before Yes
    expect((await w.wa(DESAI, { payload: `cb_yes:${j.id}` })).body.status).toBe('needs_note');
    await w.wa(DESAI, { payload: `cb_read:${j.id}` });
    expect((await w.wa(DESAI, { payload: `cb_yes:${j.id}` })).body.status).toBe('hold');
    expect((await w.call('POST', `${w.T('r4') && HH}/cover/jobs/${j.id}/confirm`, { personId: 'bk_desai' }, w.owner)).status).toBe(200);
    expect((await w.coverOf(w.T('r4'))).state).toBe('CoveredByReplacement');
    expect((await w.coverMsgs('bk_desai')).some(m => m.template === 'cover_gate_key_note' && /B-1104/.test(m.body))).toBe(true);
    const ov = await w.cover();
    expect(ov.checklists).toEqual([expect.objectContaining({ taskId: w.T('r4'), person: 'Mrs Desai', gateApproved: false })]);
    expect(ov.lines[w.T('r4')].text).toMatch(/Mrs Desai · replacement confirmed/);
    // ankita (still asked) is told politely that it is closed
    expect((await w.coverMsgs('bk_ankita')).at(-1)!.body).toMatch(/closed/);
    // PS-137: unticked checklist reminds the owner once at task − 15
    await w.to('15:44'); expect(w.adapters.outbox.filter(o => o.template === 'Gate and key')).toHaveLength(0);
    await w.to('15:45'); await w.to('15:46'); expect(w.adapters.outbox.filter(o => o.template === 'Gate and key')).toHaveLength(1);
    expect((await w.call('POST', `${HH}/cover/checklists/${w.T('r4')}`, { gateApproved: true, keyPlan: 'named_person', keyNote: 'Mrs Desai has the spare key' }, w.owner)).status).toBe(200);
    // the replacement's photo is evidence (one photo = Likely); Sunita gets no prompt for this visit
    await w.to('16:02'); await w.wa(DESAI, { type: 'photo', payload: `cb_done:${j.id}` });
    const today = (await w.call('GET', `${HH}/today`, undefined, w.owner)).body;
    expect(today.tasks.find((t: J) => t.id === w.T('r4')).ev.state).toBe('Likely');
    expect((await w.db.query(`select 1 from notifications where dedupe_key=$1`, ['prompt:' + w.T('r4')])).length).toBe(0);
    // ladder steps 2 and 3 are not repeated after cover continuity ran (10.4)
    expect(today.tasks.find((t: J) => t.id === w.T('r4')).escalation.coverHandled).toBe(true);
  });

  it('a reply is counted once: a replayed webhook is ignored', async () => {
    const w = await world(); await w.to('14:30'); const rem = await w.remId();
    expect((await w.wa(SUNITA, { payload: `cover_yes:${rem}`, messageId: 'dup1' })).body.status).toBe('confirmed');
    expect((await w.wa(SUNITA, { payload: `cover_cant:${rem}`, messageId: 'dup1' })).body.status).toBe('duplicate_event');
    expect((await w.wa(SUNITA, { payload: `cover_cant:${rem}` })).body.status).toBe('already_replied');
    expect((await w.coverOf(w.T('r4'))).state).toBe('ConfirmedByCaregiver');
    // A Yes is a plan, not evidence
    expect((await w.call('GET', `${HH}/today`, undefined, w.owner)).body.tasks.find((t: J) => t.id === w.T('r4')).ev.state).toBe('Pending');
  });
});

describe('PS-129 no reply, PS-128 can’t come any time, PS-128 substitute', () => {
  it('no reply by 3:15 → At risk with reason “no reply”, owner alerted once', async () => {
    const w = await world(); await w.to('14:30'); await w.to('15:14');
    expect((await w.coverOf(w.T('r4'))).state).toBe('Assigned');
    await w.to('15:15'); await w.to('15:16');
    const c = await w.coverOf(w.T('r4')); expect(c.state).toBe('AskingBackups'); expect(c.reason).toMatch(/No reply from Sunita/);
    expect(w.adapters.outbox.filter(o => o.channel === 'push' && /is at risk/.test(o.body))).toHaveLength(1);
    expect(c.lost_by).toBeNull(); // silence does not remove her; a late Yes restores the task
    await w.wa(SUNITA, { payload: `cover_yes:${await w.remId()}` });
    expect((await w.coverOf(w.T('r4'))).state).toBe('ConfirmedByCaregiver');
  });
  it('helper writes “can’t come” at 11 AM for the 1 PM visit → At risk; she gets no task prompts for it', async () => {
    const w = await world(); await w.to('11:00');
    expect((await w.wa(SUNITA, { text: 'येऊ शकत नाही' })).body.status).toBe('at_risk');
    for (const r of ['r1', 'r2', 'r3']) expect((await w.coverOf(w.T(r))).state).toBe('AskingBackups');
    expect((await w.helperMsgs()).some(m => m.template === 'cover_cant_come_ack')).toBe(true);
    await w.to('12:55');
    expect((await w.db.query(`select 1 from notifications where dedupe_key like 'prompt:%'`)).length).toBe(0);
  });
  it('basic phone: press 2 on the missed-call line at any time; press 1 on the reminder call', async () => {
    const w = await world(); await w.to('14:30');
    expect((await w.call('POST', '/webhooks/ivr', { callId: 'c1', from: SUNITA, event: 'reminder', digits: '1' })).body.status).toBe('confirmed');
    expect((await w.call('POST', '/webhooks/ivr', { callId: 'c1', from: SUNITA, event: 'reminder', digits: '1' })).body.status).toBe('duplicate_event');
    expect((await w.call('POST', '/webhooks/ivr', { callId: 'c2', from: SUNITA, event: 'cant' })).body.status).toBe('at_risk');
    expect((await w.coverOf(w.T('r4'))).state).toBe('AskingBackups');
  });
  it('Send someone else: nothing about the home is shared until the owner approves; the sister gets a one-time link', async () => {
    const w = await world(); await w.to('14:30'); const rem = await w.remId();
    expect((await w.wa(SUNITA, { payload: `cover_sub:${rem}` })).body.status).toBe('awaiting_name');
    expect((await w.wa(SUNITA, { text: 'Lata Pawar 90000 00077' })).body.status).toBe('substitute_proposed');
    expect((await w.coverOf(w.T('r4'))).state).toBe('SubstituteProposed');
    const ov = await w.cover(); expect(ov.substitutes).toEqual([expect.objectContaining({ name: 'Lata Pawar', by: 'Sunita' })]);
    const sid = ov.substitutes[0].id;
    expect(await w.coverMsgs(sid)).toEqual([]); // not contacted before approval
    const ok = (await w.call('POST', `${HH}/cover/substitutes/${sid}/approve`, {}, w.owner)).body;
    expect((await w.coverOf(w.T('r4'))).state).toBe('CoveredByReplacement');
    const v0 = (await w.call('GET', `/t/${ok.token}`)).body;
    expect(v0.details).toBeNull(); expect(v0.handlingNote).toMatch(/Nervous with strangers/); expect(JSON.stringify(v0)).not.toMatch(/B-1104/);
    expect((await w.call('POST', `/t/${ok.token}/accept`, {})).status).toBe(409); // must read the handling note
    expect((await w.call('POST', `/t/${ok.token}/accept`, { noteRead: true })).status).toBe(200);
    expect((await w.call('GET', `/t/${ok.token}`)).body.details.flat).toBe('B-1104');
    expect((await w.call('GET', `/t/not-a-token`)).status).toBe(404);
  });
  it('declining the substitute sends the task to the backup list', async () => {
    const w = await world(); await w.to('14:30'); const rem = await w.remId();
    await w.wa(SUNITA, { payload: `cover_sub:${rem}` }); await w.wa(SUNITA, { text: 'Lata 9000000077' });
    const sid = (await w.cover()).substitutes[0].id;
    await w.call('POST', `${HH}/cover/substitutes/${sid}/decline`, {}, w.owner);
    expect((await w.coverOf(w.T('r4'))).state).toBe('AskingBackups');
  });
});

describe('PS-130 backups in order, standing approval and owner stop', () => {
  it('two at a time, 10 minutes per pair, key holders first; the owner sees each ask and can stop', async () => {
    const w = await world(); await w.to('14:30'); await w.wa(SUNITA, { payload: `cover_cant:${await w.remId()}` });
    const id = (await w.coverOf(w.T('r4'))).job_id!;
    await w.to('14:39'); expect((await w.job(id)).asks).toHaveLength(2);
    await w.to('14:40'); const j = await w.job(id);
    expect(j.asks.map((a: J) => [a.personId, a.state])).toEqual([['bk_desai', 'noreply'], ['bk_ankita', 'noreply'], ['bk_rohan', 'asked'], ['bk_ritu', 'asked']]);
    expect(j.log.map((l: J) => l.text).join(' | ')).toMatch(/pair 2/);
    const st = await w.call('POST', `${HH}/cover/jobs/${id}/stop`, {}, w.owner);
    expect(st.body.state).toBe('stopped'); expect((await w.coverOf(w.T('r4'))).state).toBe('AtRisk');
  });
  it('without standing approval nothing is sent until the owner taps once', async () => {
    const w = await world(async db => { await db.query(`update households set standing_backup_approval=false`); });
    await w.to('14:30'); await w.wa(SUNITA, { payload: `cover_cant:${await w.remId()}` });
    const id = (await w.coverOf(w.T('r4'))).job_id!;
    expect((await w.job(id)).state).toBe('await-owner'); expect(await w.coverMsgs('bk_desai')).toEqual([]);
    await w.call('POST', `${HH}/cover/jobs/${id}/start`, {}, w.owner);
    expect((await w.job(id)).asks.map((a: J) => a.personId)).toEqual(['bk_desai', 'bk_ankita']);
    expect((await w.db.query(`select 1 from audit_log where action='cover.ask.approved'`)).length).toBe(1);
  });
  it('backups CRUD: max five, reorder, settings; a family member can’t edit the list', async () => {
    const w = await world();
    const add = await w.call('POST', `${HH}/backups`, { name: 'Kiran', phone: '+919890000031', relationship: 'Neighbour' }, w.owner); expect(add.status).toBe(409); // already 5
    const list = (await w.call('GET', `${HH}/backups`, undefined, w.owner)).body;
    expect(list.backups.map((b: J) => b.name)).toEqual(['Mrs Desai', 'Ritu Kulkarni', 'Ankita Joshi', 'Rohan Kulkarni', 'Vikram (dog walker)']);
    expect(list.backups[4].ownerArranged).toBe(true); expect(list.backups[0].phone).toMatch(/••/);
    const ids = list.backups.map((b: J) => b.id).reverse();
    expect((await w.call('PUT', `${HH}/backups/order`, { ids }, w.owner)).status).toBe(200);
    expect((await w.call('GET', `${HH}/backups`, undefined, w.owner)).body.backups[0].name).toBe('Vikram (dog walker)');
    expect((await w.call('PUT', `${HH}/cover/settings`, { standingApproval: false }, w.owner)).status).toBe(200);
    const ankita = await w.signIn(ANKITA);
    expect((await w.call('PUT', `${HH}/backups/order`, { ids }, ankita)).status).toBe(403);
    expect((await w.call('DELETE', `${HH}/backups/${ids[0]}`, undefined, w.owner)).status).toBe(200);
    expect((await w.call('GET', `${HH}/backups`, undefined, w.owner)).body.backups).toHaveLength(4);
  });
});

describe('PS-131 cancel after the cutoff, and the v1.1.0 cutoff-confirm fix', () => {
  const book = async (w: Awaited<ReturnType<typeof world>>, hm: string, text: string, friend = 'u_priya', phone = PRIYA) => {
    w.clock.set(at(hm)); await w.tick();
    const r = (await w.call('POST', `${HH}/requests`, { text }, w.owner)).body;
    const s = (await w.call('POST', `${HH}/requests/${r.id}/search`, {}, w.owner)).body;
    expect(s.top.map((t: J) => t.id)).toContain(friend);
    const ap = await w.call('POST', `${HH}/requests/${r.id}/approve`, { friendIds: [friend], mode: 'one', approved: true }, w.owner);
    return { id: r.id as string, ap, yes: () => w.wa(phone, { payload: `ff_yes:${r.id}` }) };
  };
  it('a friend cancelling at 4:45 for a 5:00 task → Friend Finder does not restart → backup list; owner told why', async () => {
    const w = await world();
    const b = await book(w, '15:30', 'Can someone feed Bruno at 5 pm? Spare key with Ankita.');
    await b.yes(); await w.call('POST', `${HH}/requests/${b.id}/confirm`, { friendId: 'u_priya' }, w.owner);
    await w.to('16:45');
    await w.wa(PRIYA, { payload: `ff_cancel:${b.id}` });
    const reqs = (await w.call('GET', `${HH}/requests`, undefined, w.owner)).body;
    expect(reqs).toHaveLength(1); expect(reqs[0].state).toBe('Cancelled by friend');
    const c = await w.coverOf('cover_' + b.id); expect(c.state).toBe('AskingBackups');
    const j = await w.job(c.job_id!); expect(j.ffSkipped).toBe(true); expect(j.log.map((l: J) => l.text).join(' ')).toMatch(/Friend Finder not started: too close to the task/);
    expect(w.adapters.outbox.some(o => /Too close to the task for Friend Finder/.test(o.body))).toBe(true);
  });
  it('before the cutoff the v1.3 rule still applies: the search reopens without them', async () => {
    const w = await world();
    const b = await book(w, '15:30', 'Can someone feed Bruno at 5 pm? Spare key with Ankita.');
    await b.yes(); await w.call('POST', `${HH}/requests/${b.id}/confirm`, { friendId: 'u_priya' }, w.owner);
    await w.to('16:10'); await w.wa(PRIYA, { payload: `ff_cancel:${b.id}` });
    expect((await w.call('GET', `${HH}/requests`, undefined, w.owner)).body).toHaveLength(2);
  });
  it('new requests are blocked at the cutoff with a clear message; a Yes received before it can still be confirmed', async () => {
    const w = await world();
    const late = await book(w, '16:30', 'Can someone feed Bruno at 5 pm? Spare key with Ankita.');
    expect(late.ap.status).toBe(409); expect(late.ap.body.message).toMatch(/Too close to the task for Friend Finder/);
    const w2 = await world();
    const b = await book(w2, '16:20', 'Can someone feed Bruno at 5 pm? Spare key with Ankita.');
    await w2.to('16:28'); await b.yes(); await w2.to('16:35');
    const conf = await w2.call('POST', `${HH}/requests/${b.id}/confirm`, { friendId: 'u_priya' }, w2.owner);
    expect(conf.status).toBe(200); expect(conf.body.state).toBe('Confirmed');
  });
});

describe('PS-132 / PS-133 cover not found', () => {
  it('must happen (medicine): no Move, no Skip; message + call; care circle called after 15 min without acknowledgement', async () => {
    const w = await world(); await w.to('11:40');
    await w.wa(SUNITA, { text: "I can't come today" });
    const id = (await w.coverOf(w.T('r2'))).job_id!;
    await w.wa(ANKITA, { payload: `cb_yes:${id}` }); // Ankita has cared for Bruno before: no note needed
    await w.call('POST', `${HH}/cover/jobs/${id}/confirm`, { personId: 'bk_ankita' }, w.owner);
    expect((await w.coverOf(w.T('r1'))).state).toBe('CoveredByReplacement'); expect((await w.coverOf(w.T('r2'))).state).toBe('AskingBackups');
    let j = await w.job(id); expect(j.asks.filter((a: J) => a.state === 'asked').map((a: J) => a.personId)).toEqual(['bk_rohan']); // only Rohan may give medicine
    await w.to('11:51'); j = await w.job(id); expect(j.state).toBe('ff');
    await w.to('12:30'); j = await w.job(id);
    expect(j.state).toBe('notfound'); expect(j.ffSkipped).toBe(true);
    expect(j.options).toMatchObject({ handle: true, askSomeone: true, askCircle: true, move: false, skip: false, circleCallAt: 765 });
    expect(w.adapters.outbox.some(o => o.channel === 'call' && /Cover not found/.test(o.body))).toBe(true);
    expect((await w.call('POST', `${HH}/cover/jobs/${id}/skip`, {}, w.owner)).status).toBe(409);
    expect((await w.call('POST', `${HH}/cover/jobs/${id}/move`, { time: 900 }, w.owner)).status).toBe(409);
    await w.to('12:44'); expect(w.adapters.outbox.filter(o => o.channel === 'call' && /must happen/.test(o.body))).toHaveLength(0);
    await w.to('12:45'); expect(w.adapters.outbox.filter(o => o.channel === 'call' && /must happen/.test(o.body)).length).toBeGreaterThan(1);
    expect((await w.job(id)).circleCalled).toBe(true);
    // must-happen alert timing: due + 15
    await w.to('13:15'); expect((await w.call('GET', `${HH}/today`, undefined, w.owner)).body.tasks.find((t: J) => t.id === w.T('r2')).ev.state).toBe('Missed');
  });
  it('can wait (walk): the owner can move or skip; the day records who was asked', async () => {
    const prep = async (db: Db) => { await db.query(`update routine_tasks set task_type='walk', title='Afternoon walk', urgency='CanWait', escalation_profile='walk', min_minutes=15 where id='r4'`); };
    const w = await world(prep);
    for (const hm of ['14:30', '15:15', '15:25', '15:35', '15:45']) await w.to(hm);
    const id = (await w.coverOf(w.T('r4'))).job_id!; const j = await w.job(id);
    expect(j.state).toBe('notfound'); expect(j.options).toMatchObject({ move: true, skip: true, moveWarning: false });
    expect(j.asks.map((a: J) => a.personId)).toEqual(['bk_desai', 'bk_ankita', 'bk_rohan', 'bk_ritu', 'bk_vikram']);
    const mv = await w.call('POST', `${HH}/cover/jobs/${id}/move`, { time: 19 * 60 + 15 }, w.owner);
    expect(mv.status).toBe(200); expect((await w.coverOf(w.T('r4'))).state).toBe('OwnerHandling');
    expect((await w.db.query<{ due_minute: number; moved_from_minute: number }>(`select due_minute, moved_from_minute from care_tasks where id=$1`, [w.T('r4')]))[0]).toEqual({ due_minute: 1155, moved_from_minute: 960 });
    const w2 = await world(prep); for (const hm of ['14:30', '15:15', '15:25', '15:35', '15:45']) await w2.to(hm);
    const id2 = (await w2.coverOf(w2.T('r4'))).job_id!;
    expect((await w2.call('POST', `${HH}/cover/jobs/${id2}/skip`, {}, w2.owner)).status).toBe(200);
    await w2.to('23:59');
    const day = (await w2.call('GET', `${HH}/today`, undefined, w2.owner)).body; expect(day.covered.pets.find((p: J) => p.petId === 'bruno').status).toBe('Not covered');
  });
  it('Ask someone else: a one-time 15-minute link, task and tower only; details after they accept and the owner approves', async () => {
    const prep = async (db: Db) => { await db.query(`update routine_tasks set task_type='walk', title='Afternoon walk', urgency='CanWait', escalation_profile='walk' where id='r4'`); };
    const w = await world(prep); for (const hm of ['14:30', '15:15', '15:25', '15:35', '15:45']) await w.to(hm);
    const id = (await w.coverOf(w.T('r4'))).job_id!;
    const r = await w.call('POST', `${HH}/cover/jobs/${id}/ask-someone`, { name: 'Sneha Rao', phone: '+919820000055' }, w.owner);
    expect(r.status).toBe(200); const tok = r.body.linkToken;
    const v = (await w.call('GET', `/t/${tok}`)).body; expect(v.details).toBeNull(); expect(v.tower).toBe('Tower B'); expect(JSON.stringify(v)).not.toMatch(/B-1104/);
    await w.call('POST', `/t/${tok}/accept`, { noteRead: true });
    expect((await w.call('GET', `/t/${tok}`)).body.details).toBeNull(); // the owner has not approved yet
    const pid = (await w.job(id)).hold.personId;
    await w.call('POST', `${HH}/cover/jobs/${id}/confirm`, { personId: pid }, w.owner);
    expect((await w.call('GET', `/t/${tok}`)).body.details.flat).toBe('B-1104');
    // an ad-hoc number's link that nobody answers expires after 15 minutes
    const w2 = await world(prep); for (const hm of ['14:30', '15:15', '15:25', '15:35', '15:45']) await w2.to(hm);
    const id2 = (await w2.coverOf(w2.T('r4'))).job_id!;
    const t2 = (await w2.call('POST', `${HH}/cover/jobs/${id2}/ask-someone`, { name: 'Sneha', phone: '+919820000055' }, w2.owner)).body.linkToken;
    await w2.to('16:00'); expect((await w2.job(id2)).state).toBe('notfound'); expect((await w2.call('GET', `/t/${t2}`)).status).toBe(410);
  });
});

describe('PS-134 leaving with nobody confirmed', () => {
  it('“I’m leaving” shows the warning and options; Leave anyway marks No cover planned and the day is not covered', async () => {
    const w = await world();
    await w.call('PUT', `${HH}/day`, { helperUnavailable: true, reason: 'Unwell' }, w.owner);
    const pd = (await w.call('GET', `${HH}/day/pre-departure`, undefined, w.owner)).body;
    expect(pd.warn).toBe(true); expect(pd.messages[0]).toBe('Nobody has accepted Bruno’s 1:00 PM lunch + fresh water yet.');
    expect(pd.options).toEqual(['do_it_before_leaving', 'leave_later', 'take_the_pet', 'own_paid_provider', 'ask_circle_now', 'leave_anyway']); expect(pd.wideAsk).toBe(true);
    expect((await w.call('POST', `${HH}/day/pre-departure`, { option: 'leave_anyway' }, w.owner)).body.noCoverPlanned).toBe(true);
    await w.call('POST', `${HH}/day/leaving`, { checklist: null, returnAt: 1140, planB: 'I’ll come back myself' }, w.owner);
    expect((await w.coverOf(w.T('r1'))).state).toBe('NoCoverPlanned');
    const ov = await w.cover(); expect(ov.noCoverPlanned).toBe(true); expect(ov.planB).toBe('I’ll come back myself');
    await w.to('23:59');
    expect((await w.call('GET', `${HH}/today`, undefined, w.owner)).body.covered.household).toBe('Not covered');
  });
  it('Ask my circle now with more than 3 hours to go: backups asked together, 60-minute window', async () => {
    const w = await world();
    await w.call('PUT', `${HH}/day`, { helperUnavailable: true }, w.owner);
    const r = (await w.call('POST', `${HH}/day/pre-departure`, { option: 'ask_circle_now' }, w.owner)).body;
    expect(r.wide).toBe(true); const j = await w.job(r.jobId); expect(j.asks).toHaveLength(5); expect(j.asks[0].until).toBe(9 * 60 + 60);
  });
  it('Do it before leaving → matched by the owner; Own paid provider → owner-arranged cover', async () => {
    const w = await world();
    await w.call('PUT', `${HH}/day`, { helperUnavailable: true }, w.owner);
    await w.call('POST', `${HH}/day/pre-departure`, { option: 'do_it_before_leaving' }, w.owner);
    const t = (await w.call('GET', `${HH}/today`, undefined, w.owner)).body.tasks.find((x: J) => x.id === w.T('r1'));
    expect(t.ev.state).toBe('Matched'); expect(t.cover.state).toBe('OwnerHandling');
  });
});

describe('PS-136 I’m delayed', () => {
  it('7 → 9 PM: walk and dinner added; Sunita asked first; “Only until 8” → request for the dinner only', async () => {
    const w = await world(); await w.to('18:30');
    const d = (await w.call('POST', `${HH}/day/delay`, { returnAt: 21 * 60 }, w.owner)).body;
    expect(d.added.map((t: J) => t.title)).toEqual(['Evening walk', 'Dinner + water']); expect(d.planOnly).toBe(false); expect(d.ask.first).toBe('current_caregiver');
    expect((await w.call('POST', `${HH}/day/delay/${d.id}/ask`, {}, w.owner)).body.asked).toBe('helper');
    const m = (await w.helperMsgs()).find(x => x.template === 'cover_extension_request')!;
    expect(m.buttons!.map(b => b.id)).toEqual([`cover_ext:${d.id}:yes`, `cover_ext:${d.id}:1200`, `cover_ext:${d.id}:cant`]);
    await w.wa(SUNITA, { payload: `cover_ext:${d.id}:1200` });
    expect((await w.coverOf(w.T('r5'))).state).toBe('ConfirmedByCaregiver');
    const c6 = await w.coverOf(w.T('r6')); expect(c6.state).toBe('AskingBackups'); expect(c6.reason).toMatch(/only until 8:00 PM/);
    const ov = await w.cover(); expect(ov.extensions[0].result).toMatch(/covers until 8:00 PM \(Evening walk\)/);
    // nothing new due → plan only
    expect((await w.call('POST', `${HH}/day/delay`, { returnAt: 21 * 60 + 10 }, w.owner)).body.planOnly).toBe(true);
  });
});

describe('PS-140 newcomer circle builder, PS-141 switch, PS-135 advisory, 16.3 metrics, templates', () => {
  it('circle builder offers the four routes; a paid provider is added as owner-arranged', async () => {
    const w = await world(async db => { await db.query(`delete from backup_contact`); });
    for (const kind of ['society_link', 'pet_swap', 'building_helper']) expect((await w.call('POST', `${HH}/circle-builder`, { kind }, w.owner)).status).toBe(201);
    const p = await w.call('POST', `${HH}/circle-builder`, { kind: 'paid_provider', name: 'Raju walker', phone: '+919811100001' }, w.owner);
    expect(p.body.note).toMatch(/owner-arranged, not verified by Pawsure/);
    expect((await w.call('GET', `${HH}/backups`, undefined, w.owner)).body.backups).toEqual([expect.objectContaining({ name: 'Raju walker', ownerArranged: true })]);
    expect((await w.cover()).thin).toEqual({ keyHolders: 0, thin: true });
    await w.tick(); expect(w.adapters.outbox.some(o => o.template === 'Your circle is thin')).toBe(true);
  });
  it('same-society fallback is OFF and locked', async () => {
    const w = await world(); const lead = await w.signIn('+919811000002');
    const f = (await w.call('GET', '/admin/flags', undefined, lead)).body.flags.find((x: J) => x.key === 'sameSocietyFallback');
    expect(f).toMatchObject({ locked: true }); expect(JSON.parse(JSON.stringify(f.default_value))).toBe(false);
    expect((await w.call('PUT', '/admin/flags', { key: 'sameSocietyFallback', value: true }, lead)).status).toBe(409);
  });
  it('ops sends a cluster advisory → owners told → tomorrow’s reminders go out this evening', async () => {
    const w = await world(); await w.to('18:40'); const ops = await w.signIn('+919811000001');
    const a = await w.call('POST', '/admin/advisories', { cluster: 'Powai · Lake Vista CHS', reason: 'red rain alert' }, ops);
    expect(a.status).toBe(201); expect(a.body.households).toBe(1);
    await w.tick();
    expect(w.adapters.outbox.some(o => o.template === 'Many helpers may not come tomorrow')).toBe(true);
    const rems = await w.db.query<{ care_date: string }>(`select care_date::text as care_date from reminder where care_date='2026-11-07'`);
    expect(rems.length).toBe(2);
    const auditor = await w.signIn('+919811000004'); expect((await w.call('POST', '/admin/advisories', { cluster: 'x', reason: 'strike' }, auditor)).status).toBe(403);
  });
  it('metrics and the template catalogue are available to staff', async () => {
    const w = await world(); await w.to('14:30'); await w.wa(SUNITA, { payload: `cover_cant:${await w.remId()}` });
    const ops = await w.signIn('+919811000001');
    const m = (await w.call('GET', '/admin/cover-metrics', undefined, ops)).body;
    expect(m.pilot.counts).toMatchObject({ reminders: 1, replied: 1, atRisk: 1 }); expect(m.reviewLine).toBe(0.1);
    const t = (await w.call('GET', '/admin/templates', undefined, ops)).body;
    expect(t.map((x: J) => x.id)).toEqual(['cover_reminder', 'cover_cant_come_ack', 'cover_backup_request', 'cover_substitute_link', 'cover_not_found_owner', 'cover_adhoc_link', 'cover_extension_request', 'cover_gate_key_note', 'cluster_advisory']);
    expect(t.every((x: J) => x.languages.join() === 'en,hi,mr' && /not submitted/.test(x.approval))).toBe(true);
  });
});

describe('isolation and revocation', () => {
  it('a backup who can’t make it after confirming loses the details; the task goes back to the list', async () => {
    const w = await world(); await w.to('14:30'); await w.wa(SUNITA, { payload: `cover_cant:${await w.remId()}` });
    const id = (await w.coverOf(w.T('r4'))).job_id!;
    await w.wa(ANKITA, { payload: `cb_yes:${id}` }); await w.call('POST', `${HH}/cover/jobs/${id}/confirm`, { personId: 'bk_ankita' }, w.owner);
    const t0 = Date.now(); await w.wa(ANKITA, { text: "Sorry, can't come" }); expect(Date.now() - t0).toBeLessThan(60000);
    const c = await w.coverOf(w.T('r4')); expect(c.state).toBe('AskingBackups'); expect(c.lost_by).toBe('bk_ankita');
    expect((await w.job(c.job_id!)).asks.map((a: J) => a.personId)).not.toContain('bk_ankita');
  });
  it('another household cannot read this household’s cover', async () => {
    const w = await world(); const priya = await w.signIn(PRIYA);
    expect((await w.call('GET', `${HH}/cover`, undefined, priya)).status).toBe(403);
    expect((await w.call('GET', `${HH}/backups`, undefined, priya)).status).toBe(403);
    expect((await w.call('POST', `${HH}/day/pre-departure`, { option: 'leave_anyway' }, priya)).status).toBe(403);
  });
  it('co-owner assigned a task gets the same reminder and answers in the app (PS-139)', async () => {
    const w = await world(async db => { await db.query(`update routine_tasks set assignee_membership_id='m_rohan' where id='r4'`); });
    await w.to('14:30');
    const rem = (await w.db.query<{ id: string; recipient_kind: string }>(`select id, recipient_kind from reminder where visit_key like '%|m_rohan'`))[0]!;
    expect(rem.recipient_kind).toBe('co_owner');
    const rohan = await w.signIn(ROHAN);
    expect((await w.call('POST', `${HH}/cover/reminders/${rem.id}/reply`, { reply: 'yes' }, w.owner)).status).toBe(403); // only Rohan answers his own reminder
    expect((await w.call('POST', `${HH}/cover/reminders/${rem.id}/reply`, { reply: 'yes' }, rohan)).body.status).toBe('confirmed');
  });
});
