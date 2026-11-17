/**
 * Phase 3 — AI Friend Finder (PS-050–069, PS-123, PS-125). Owner side (F1–F5), friend side (F6–F7), WhatsApp replies,
 * request lifecycle via the pure domain reducer, timers on the minute job. AI only parses; deterministic rules decide.
 */
import type { Hono, Context } from 'hono';
import { z } from 'zod';
import { uid, type Db } from '@pawsure/db';
import {
  matchFriends, newRequest, reduce, searchBlockedReasons, correctedCriticalFields, parseRequestRules, parseProposedTime, historySummary, petsOf,
  type FriendProfile, type FriendRequest, type FFEvent, type Effect, type ParsedRequest, type Clarification, type ParseResult, type ParseContext, type FFTask,
  isPersonName, NAME_MESSAGE, LANG_CODES, msgLang
} from '@pawsure/domain';
import type { Deps } from './app.js';
import type { Ctx } from './daily.js';
import { istDate, minutesOnDay, atMinute } from './clock.js';
import { audit } from './care.js';
import { requestText, FRIEND_MSG, BTN, type Lang } from './friendTemplates.js';
import { ProofIn, recordProof, proofMessage } from './proof.js';

type Env = { Variables: { userId: string } };
const BAND_LABEL = ['Same tower', 'About 2 min away', 'About 5 min away', 'Next society, about 8 min'];
const LLM_TIMEOUT_MS = 8000;

interface ReqRow { id: string; household_id: string; state: string; parse: { parsed: ParsedRequest; clarifications: Clarification[]; parser: string; confidence: number; originalParsed?: ParsedRequest; careDate: string; text: string; fallbackReason?: string; maxBand?: number } | null; parser: string | null; corrected_fields: string[]; doc: FriendRequest }

export function makeFriendFinder(d: Deps) {
  const { db } = d; const A = d.adapters; const now = () => d.clock.now();
  const today = () => istDate(now()); const nowMin = () => minutesOnDay(now(), today());
  /** Minutes on the request's own care day (a request for tomorrow morning is measured against tomorrow). */
  const rowNow = (row: { parse: { careDate?: string } | null }) => minutesOnDay(now(), row.parse?.careDate ?? today());
  const hooks: { onCoverConfirmed?: (hh: string, reqId: string, origin: { jobId: string }, taskId: string, friendName: string) => Promise<void>; onBackupRunner?: (hh: string, taskId: string, friendName: string, friendId: string, why?: { reason: 'cancelled' | 'emergency'; done: string[] }) => Promise<void> } = {};
  const firstTime = async (hh: string, fid: string) => ((await db.query<{ n: number }>(`select help_count as n from friend_links where household_id=$1 and friend_user_id=$2`, [hh, fid]))[0]?.n ?? 0) === 0;

  /**
   * PAW-034: pets each friend has already agreed to look after at a time overlapping this visit (any household).
   * Confirmed visits, a provisional hold and a Yes waiting for the owner all count, so two owners can't both book them.
   */
  async function busyPets(forReq: { id: string; careDate: string; start: number; end: number; confirmedOnly?: boolean }) {
    // At confirm time only confirmed visits count: of two owners waiting on the same friend's Yes, the first to confirm wins.
    const rows = await db.query<{ id: string; state: string; doc: FriendRequest; parse: ReqRow['parse'] }>(`select id, state, doc, parse from friend_requests where id<>$1 and parse->>'careDate'=$2 and state = any($3::text[])`, [forReq.id, forReq.careDate, forReq.confirmedOnly ? ['Confirmed'] : ['Confirmed', 'Provisional hold', 'Accepted - pending owner confirmation']]);
    const busy = new Map<string, number>();
    for (const r of rows) {
      const p = r.parse?.parsed; const t = r.doc.taskTime ?? p?.time; if (!p || t == null) continue;
      if (!(t < forReq.end && forReq.start < t + (p.durationMin || 15))) continue;
      const who = r.state === 'Confirmed' ? [r.doc.confirmedFriendId] : r.state === 'Provisional hold' ? [r.doc.holdFriendId] : r.doc.recipients.filter(x => x.state === 'accepted').map(x => x.friendId);
      for (const f of who) if (f) busy.set(f, (busy.get(f) ?? 0) + petsOf(p).length);
    }
    return busy;
  }
  /** PAW-029: a timed pause ends on its own; an open-ended pause lasts until the friend turns it off. */
  const pauseState = (r: { paused?: unknown; paused_until?: unknown }) => {
    const until = (r.paused_until as string | null) ?? null, timed = !!until && until >= today();
    return { active: !!r.paused || timed, until: timed ? until : null, resumesOn: timed ? new Date(Date.parse(until + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10) : null };
  };
  async function loadFriends(hh: string, forReq?: { id: string; careDate: string; start: number; end: number; confirmedOnly?: boolean }): Promise<(FriendProfile & { userId: string; phone: string; pausedUntil: string | null })[]> {
    const rows = await db.query<Record<string, unknown>>(`select l.friend_user_id, l.status, l.distance_band, l.help_count, l.checked_in_count, coalesce(l.display_label, u.display_name) as name, u.language, u.phone_e164,
      p.discoverable, p.opt_out_requested_at, p.paused, p.paused_until::text as paused_until, p.windows, p.capabilities, p.key_mode, p.stairs_ok, p.response_band, p.updated_at, p.max_pets, p.species
      from friend_links l join users u on u.id=l.friend_user_id left join friend_profiles p on p.user_id=l.friend_user_id where l.household_id=$1 and l.status <> 'left'`, [hh]);
    const busy = forReq ? await busyPets(forReq) : new Map<string, number>();
    return rows.map(r => {
      const band = (r.distance_band as number | null) ?? 9;
      const windows = (r.windows as [number, number][] | null) ?? [];
      return {
        id: r.friend_user_id as string, userId: r.friend_user_id as string, phone: r.phone_e164 as string, displayName: (r.name as string) ?? 'Friend',
        distanceBand: band, distanceLabel: BAND_LABEL[band] ?? 'Hidden until they opt in', language: msgLang(r.language as string),
        inviteAccepted: r.status === 'accepted', discoverable: !!r.discoverable, optOutPending: !!r.opt_out_requested_at, blocked: r.status === 'blocked',
        paused: pauseState(r).active, pausedUntil: pauseState(r).until, windows,
        windowsLabel: windows.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(', ') || '—', capabilities: (r.capabilities as FriendProfile['capabilities']) ?? {},
        key: ((r.key_mode as string) ?? 'handover') as FriendProfile['key'], stairsOk: r.stairs_ok !== false, capacity: (r.max_pets as number | null) ?? 1, species: (r.species as string[] | null) ?? undefined,
        activeRequests: busy.get(r.friend_user_id as string) ?? 0, helpCount: (r.help_count as number) ?? 0, checkedInCount: (r.checked_in_count as number) ?? 0,
        responseBand: (r.response_band as string) ?? 'No requests yet', responseRank: /within 10/.test((r.response_band as string) ?? '') ? 1 : /10–20/.test((r.response_band as string) ?? '') ? 2 : 3,
        updatedLabel: r.updated_at ? new Date(r.updated_at as string).toISOString().slice(0, 10) : '—'
      };
    });
  }
  const fmt = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${Math.floor(m / 60) % 24 >= 12 ? 'PM' : 'AM'}`;

  async function getReq(id: string, hh?: string): Promise<ReqRow | undefined> {
    return (await db.query<ReqRow>(`select * from friend_requests where id=$1 ${hh ? 'and household_id=$2' : ''}`, hh ? [id, hh] : [id]))[0];
  }
  async function saveReq(row: ReqRow, req: FriendRequest) {
    const before = row.doc.history.length, ts = now().toISOString();
    for (const h of req.history) if (!h.ts) h.ts = ts; // PAW-012: exact time on every event, from the same clock as everything else
    await db.query(`update friend_requests set state=$2, doc=$3, parse=$4, corrected_fields=$5, updated_at=now() where id=$1`, [row.id, req.state, JSON.stringify(req), JSON.stringify(row.parse), row.corrected_fields]);
    for (const h of req.history.slice(before)) await db.query(`insert into friend_request_events(request_id, state, note, at) values ($1,$2,$3,$4)`, [row.id, h.state, h.note, h.ts]);
    row.doc = req; row.state = req.state;
  }
  async function ownerInfo(hh: string) {
    return (await db.query<{ owner: string; tower: string; flat: string; access: string }>(`select (select coalesce(u.display_name,'Owner') from memberships m join users u on u.id=m.user_id where m.household_id=h.id and m.role='owner' limit 1) as owner, coalesce(h.tower,'') as tower, h.flat_private as flat, h.access_note_private as access from households h where h.id=$1`, [hh]))[0]!;
  }
  async function friendSay(hh: string | null, requestId: string | null, friendUserId: string, body: string, template: string, buttons?: { id: string; label: string }[]) {
    const u = (await db.query<{ phone_e164: string; language: string }>(`select phone_e164, language from users where id=$1`, [friendUserId]))[0]!;
    await A.whatsapp.sendTemplate(u.phone_e164, template, msgLang(u.language), { request: requestId ?? '' });
    await db.query(`insert into friend_messages(id, request_id, friend_user_id, household_id, direction, template, body, buttons, at) values ($1,$2,$3,$4,'out',$5,$6,$7,$8)`, [uid('fm'), requestId, friendUserId, hh, template, body, buttons ? JSON.stringify(buttons) : null, now().toISOString()]);
  }
  const langOf = async (userId: string): Promise<Lang> => msgLang((await db.query<{ language: string }>(`select language from users where id=$1`, [userId]))[0]?.language);

  async function messageFor(hh: string, row: ReqRow, friendUserId: string) {
    const o = await ownerInfo(hh); const l = await langOf(friendUserId);
    const p = row.parse!.parsed; const ids = petsOf(p);
    const pets = (await db.query<{ id: string; name: string; pronoun: string | null }>(`select id, name, pronoun from pets where id = any($1)`, [ids])).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    const name = (await db.query<{ n: string }>(`select coalesce(display_name,'friend') as n from users where id=$1`, [friendUserId]))[0]!.n;
    return { lang: l, text: requestText(l, { friend: name, owner: o.owner, tower: o.tower, pet: pets[0]?.name ?? 'your pet', pets: pets.map(x => x.name), pronoun: pets.length > 1 ? 'them' : pets[0]?.pronoun ?? pets[0]?.name ?? 'them', p }) };
  }

  async function runEffects(hh: string, row: ReqRow, effects: Effect[]) {
    for (const e of effects) {
      if (e.type === 'send_request') {
        const m = await messageFor(hh, row, e.friendId);
        // PS-138: someone covering for the first time sees the handling note and must confirm reading it before Yes.
        const note = (await firstTime(hh, e.friendId)) ? (await db.query<{ n: string | null }>(`select handling_note as n from pets where id=$1`, [row.parse!.parsed.petId]))[0]?.n : null;
        const btns = [{ id: `ff_yes:${row.id}`, label: BTN.yes![m.lang] }, { id: `ff_no:${row.id}`, label: BTN.no![m.lang] }, ...(note ? [{ id: `ff_read:${row.id}`, label: 'I have read this' }] : [])];
        await friendSay(hh, row.id, e.friendId, (e.reminder ? FRIEND_MSG.reminder![m.lang] + '\n\n' + m.text : m.text) + (note && !e.reminder ? `\n\nHandling note, please read first: ${note}` : ''), e.reminder ? 'FF-REQ-REMINDER' : 'FF-REQ-1', btns);
        await audit(db, e.reminder ? 'system' : 'owner', hh, e.reminder ? 'friend.request.reminder' : 'message.sent', { request: row.id, friend: e.friendId, language: m.lang });
      } else if (e.type === 'message_friend') {
        const l = await langOf(e.friendId);
        await friendSay(hh, row.id, e.friendId, FRIEND_MSG[e.template]![l], 'FF-' + e.template.toUpperCase(), e.template === 'reconfirm' ? [{ id: `ff_yes:${row.id}`, label: BTN.yes![l] }, { id: `ff_no:${row.id}`, label: BTN.no![l] }] : undefined);
      } else if (e.type === 'notify_owner') {
        const n = e.friendId ? (await db.query<{ n: string }>(`select coalesce(display_name,'A friend') as n from users where id=$1`, [e.friendId]))[0]?.n.split(' ')[0] : '';
        const text: Record<string, string> = { friend_cancelled_after_cutoff: `${n} cancelled. Too close to the task for Friend Finder: your backups are being asked instead.`, friend_yes: `${n} said yes. Confirm to share access details.`, friend_declined: `${n} can’t help this time.`, friend_proposed: `${n} suggested another time. Confirm before anything changes.`, hold_reminder: `${n} is waiting for you to confirm (hold ends in 5 min).`, none_accepted: 'Nobody accepted. See safe next steps.', friend_cancelled: `${n} had to cancel. Access details removed; search reopened without them.`, no_show: `No check-in from ${n} yet. Your backup is being alerted.`, search_closed: 'Search closed 30 minutes before the task.',
          friend_late: `${n} is running about ${e.minutes} min late. New arrival about ${fmt((row.doc.taskTime ?? 0) + (e.minutes ?? 0))}. You can keep the visit or ask your backups.`,
          friend_emergency: `URGENT: ${n} had an emergency and has left${row.doc.doneTasks?.length ? ' after: ' + row.doc.doneTasks.join(', ') : ' before starting'}. Your backups are being asked now.` };
        await A.push.push('owner:' + hh, e.template === 'friend_emergency' ? 'Urgent: cover' : 'Find cover', text[e.template] ?? e.template);
        // PAW-058: an emergency exit also rings the owner and co-owner; if nobody answers, the cover job's 15-minute care-circle call follows.
        if (e.template === 'friend_emergency') for (const m of await db.query<{ phone: string }>(`select u.phone_e164 as phone from memberships m join users u on u.id=m.user_id where m.household_id=$1 and m.status='active' and m.role in ('owner','co_owner')`, [hh])) await A.voice.call(m.phone, text[e.template]!);
      } else if (e.type === 'disclose_access') {
        const o = await ownerInfo(hh); const p = row.parse!.parsed;
        const petRows = await db.query<{ name: string; food: string; fears: string }>(`select name, food, fears from pets where id = any($1) order by name`, [petsOf(p)]);
        const pet = { name: petRows.map(x => x.name).join(' and '), food: petRows.length > 1 ? petRows.map(x => `${x.name}: ${x.food ?? ''}`).join('; ') : petRows[0]?.food ?? '', fears: petRows.map(x => x.fears).filter(Boolean).join(' ') };
        await db.query(`insert into access_grants(id, request_id, friend_user_id, household_id, expires_at) values ($1,$2,$3,$4,$5)`, [uid('ag'), row.id, e.friendId, hh, atMinute(row.parse!.careDate, (row.doc.taskTime ?? 0) + 120).toISOString()]);
        await friendSay(hh, row.id, e.friendId, `Confirmed ✅ ${fmt(row.doc.taskTime ?? 0)}\nFlat ${o.flat}, ${o.tower}\n${p.access === 'Someone at home' ? 'Someone will be at home.' : 'Key: ' + o.access}\n${pet.name}: ${pet.food ?? ''}. ${pet.fears ?? ''}\nThe emergency card opens in the app during this visit. These details disappear after the visit.`, 'FF-ACCESS', [{ id: `ff_arrived:${row.id}`, label: 'I’ve arrived' }, { id: `ff_cancel:${row.id}`, label: 'Can’t make it' }]);
        await audit(db, 'owner', hh, 'access.disclosed', { request: row.id, friend: e.friendId, fields: ['flat', 'tower', 'key_note', 'pet_care'] });
      } else if (e.type === 'revoke_access') {
        await db.query(`update access_grants set revoked_at=$3 where request_id=$1 and friend_user_id=$2 and revoked_at is null`, [row.id, e.friendId, now().toISOString()]);
        await db.query(`update live_location_sessions set stopped_at=$3 where request_id=$1 and friend_user_id=$2 and stopped_at is null`, [row.id, e.friendId, now().toISOString()]);
        await audit(db, 'system', hh, 'access.revoked', { request: row.id, friend: e.friendId });
      } else if (e.type === 'create_cover_task') {
        const p = row.parse!.parsed, date = row.parse!.careDate, tid = 'cover_' + row.id;
        const type = p.tasks.includes('walk') ? 'walk' : p.tasks.includes('meds') ? 'medicine' : 'feeding';
        await db.query(`insert into care_tasks(id, household_id, pet_id, care_date, title, task_type, due_minute, min_minutes, escalation_profile, assignee_friend_user_id, cover_request_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do nothing`,
          [tid, hh, p.petId, date, p.tasks.map(t => ({ feed: 'Feed', walk: 'Short walk', meds: 'Medicine', water: 'Water', litter: 'Litter', toilet: 'Toilet pad' } as Record<string, string>)[t]).join(' + ') + (petsOf(p).length > 1 ? ` for ${(await db.query<{ name: string }>(`select name from pets where id = any($1) order by name`, [petsOf(p)])).map(x => x.name).join(' and ')}` : '') + ' (friend cover)', type, e.time, Math.min(30, p.durationMin), type === 'medicine' ? 'medicine' : type === 'walk' ? 'walk' : 'standard', e.friendId, row.id]);
        await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,'Planned','owner',$3)`, [tid, hh, 'Created from ' + row.id]);
        // PS-137: a friend new to this household gets the gate and key checklist on the owner's Today.
        const fname = (await db.query<{ n: string }>(`select coalesce(display_name,'Friend') as n from users where id=$1`, [e.friendId]))[0]!.n;
        if (await firstTime(hh, e.friendId)) await db.query(`insert into visit_access_checklist(task_id, household_id, person_name) values ($1,$2,$3) on conflict do nothing`, [tid, hh, fname]);
        if (row.doc.origin && hooks.onCoverConfirmed) { await hooks.onCoverConfirmed(hh, row.id, row.doc.origin, tid, fname); continue; }
        const ds = (await db.query<{ helper_unavailable: boolean }>(`select helper_unavailable from day_states where household_id=$1 and care_date=$2`, [hh, date]))[0];
        if (ds?.helper_unavailable) {
          // Hand over only what the friend agreed to: same pet, same kind of task, near the same time. Anything else
          // (another pet, medicine they weren't asked about) stays with the unavailable helper, so it still escalates.
          const KIND: Record<string, string> = { feed: 'feeding', walk: 'walk', meds: 'medicine', water: 'water', litter: 'litter', toilet: 'toilet' };
          const kinds = p.tasks.map(t => KIND[t]).filter(Boolean);
          const helperTasks = await db.query<{ id: string }>(`select t.id from care_tasks t join memberships m on m.id=t.assignee_membership_id where t.household_id=$1 and t.care_date=$2 and m.role='helper' and abs(t.due_minute-$3) <= 60 and t.reassigned_to_task_id is null and t.pet_id=$4 and t.task_type = any($5::text[])`, [hh, date, e.time, p.petId, kinds]);
          for (const ht of helperTasks) { await db.query(`update care_tasks set reassigned_to_task_id=$2 where id=$1`, [ht.id, tid]); await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,'Reassigned','owner',$3)`, [ht.id, hh, 'To a friend via ' + row.id + '; original kept']); }
          await db.query(`update day_states set mode='friend' where household_id=$1 and care_date=$2`, [hh, date]);
        }
      } else if (e.type === 'resume_escalation_backup') {
        await db.query(`update care_tasks set force_backup=true where cover_request_id=$1`, [row.id]);
        await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,'Missed','system','Friend no-show (private record)')`, ['cover_' + row.id, hh]);
      } else if (e.type === 'backup_runner') {
        const n = (await db.query<{ n: string }>(`select coalesce(display_name,'Your friend') as n from users where id=$1`, [e.friendId]))[0]!.n;
        if (hooks.onBackupRunner) await hooks.onBackupRunner(hh, 'cover_' + row.id, n, e.friendId, { reason: e.reason ?? 'cancelled', done: row.doc.doneTasks ?? [] });
      } else if (e.type === 'partial_done') {
        await audit(db, 'friend:' + e.friendId, hh, 'visit.interrupted', { request: row.id, done: e.done, note: 'Interrupted, not Completed; no help counted as finished' });
      } else if (e.type === 'reopen_search') {
        const id = 'ffr_' + uid('x').slice(2, 12);
        const fresh = newRequest(id, rowNow(row)); fresh.exclude = e.exclude; if (row.doc.origin) fresh.origin = row.doc.origin;
        const { req } = reduce(fresh, { type: 'parse_confirmed', taskTime: row.parse!.parsed.time! }, rowNow(row));
        for (const h of req.history) h.ts ??= now().toISOString();
        await db.query(`insert into friend_requests(id, household_id, state, parse, parser, doc, created_by) values ($1,$2,$3,$4,$5,$6,'system')`, [id, hh, req.state, JSON.stringify(row.parse), row.parser, JSON.stringify(req)]);
        await audit(db, 'system', hh, 'request.reopened', { from: row.id, to: id, excluded: e.exclude });
      }
    }
  }

  async function step(hh: string, row: ReqRow, ev: FFEvent) {
    const { req, effects } = reduce(row.doc, ev, rowNow(row));
    await saveReq(row, req);
    await runEffects(hh, row, effects);
    return { req, effects };
  }

  /** Friend reply arriving from WhatsApp (button or free text). Idempotent by message id (PS-123). */
  async function inbound(b: { messageId: string; from: string; type: string; payload?: string; text?: string }) {
    const user = (await db.query<{ id: string }>(`select id from users where phone_e164=$1`, [b.from]))[0];
    if (!user) return { status: 404, body: { error: 'unknown_sender' } };
    const [kind, reqId] = (b.payload ?? '').split(':');
    if (kind === 'ff_invite_accept' && reqId) { await db.query(`update friend_links set status='accepted' where household_id=$1 and friend_user_id=$2 and status='invited'`, [reqId, user.id]); await db.query(`insert into friend_profiles(user_id) values ($1) on conflict do nothing`, [user.id]); return { status: 200, body: { status: 'invite_accepted', note: 'Not findable until they opt in' } }; }
    let row = reqId ? await getReq(reqId) : undefined;
    if (!row) row = (await db.query<ReqRow>(`select * from friend_requests where doc->'recipients' @> $1::jsonb order by updated_at desc limit 1`, [JSON.stringify([{ friendId: user.id }])]))[0];
    if (!row) return { status: 404, body: { error: 'no_open_request' } };
    // PAW-054: one reply at a time per request, so a Yes in the app and on WhatsApp together count once.
    return withLock(row.id, async () => { row = (await getReq(row!.id))!;
    const BTN_LABEL: Record<string, string> = { ff_yes: 'Yes', ff_no: 'No', ff_arrived: 'I’ve arrived', ff_cancel: 'Can’t make it' };
    await db.query(`insert into friend_messages(id, request_id, friend_user_id, household_id, direction, body, at) values ($1,$2,$3,$4,'in',$5,$6)`, [uid('fm'), row.id, user.id, row.household_id, b.type === 'text' ? b.text ?? '' : (BTN_LABEL[kind ?? ''] ?? kind ?? ''), now().toISOString()]);
    if (kind === 'ff_arrived') { await friendArrived(row, user.id); return { status: 200, body: { status: 'arrived' } }; }
    if (kind === 'ff_read') { const doc = { ...row.doc, noteReadBy: [...new Set([...(row.doc.noteReadBy ?? []), user.id])] }; await saveReq(row, doc); await friendSay(row.household_id, row.id, user.id, 'Thank you. You can now reply Yes or No.', 'FF-NOTE-OK'); return { status: 200, body: { status: 'note_read' } }; }
    if (kind === 'ff_cancel') { if (row.state === 'Confirmed' && row.doc.confirmedFriendId === user.id) await step(row.household_id, row, { type: 'friend_cancel' }); return { status: 200, body: { status: row.state } }; }
    // PAW-051 / PAW-061: "late 20", "running late", "emergency" from the confirmed friend, on WhatsApp or SMS.
    if (row.doc.confirmedFriendId === user.id && b.type === 'text') {
      const t = (b.text ?? '').trim().toLowerCase();
      if (/^(emergency|sos|have to leave|must leave|आपात|इमरजेंसी|आणीबाणी)/.test(t)) {
        if (row.state !== 'Confirmed') return { status: 200, body: { status: row.state } };
        // Each part of the message on its own: "done feed, cannot walk" means fed, not walked.
        const WORD: Record<string, RegExp> = { feed: /\b(fed|feed|food|khana)\b/, walk: /\bwalk(ed)?\b/, meds: /\b(medicine|meds|tablet|gave)\b/, water: /\bwater\b/, litter: /\blitter\b/, toilet: /\b(toilet|pad)\b/ };
        const parts = t.split(/[,.;]| but | and /);
        const done = (Object.keys(WORD) as FFTask[]).filter(k => row!.parse?.parsed?.tasks.includes(k) && parts.some(x => WORD[k]!.test(x) && /\b(done|did|fed|gave|finished|walked|already)\b/.test(x) && !/\b(not|cannot|can't|cant|didn't|didnt|no)\b/.test(x)));
        await step(row.household_id, row, { type: 'friend_emergency_leave', done: [...done] }); return { status: 200, body: { status: row.state } };
      }
      const late = t.match(/^(?:running )?late\s*(\d{1,3})?|^(\d{1,3})\s*(?:min|mins|minutes)?\s*late|^(?:देर|उशीर)\s*(\d{1,3})?/);
      if (late) {
        const mins = Number(late[1] ?? late[2] ?? late[3] ?? 15);
        if (row.state === 'Confirmed' && row.doc.friendSignalAt == null && mins >= 1 && mins <= 120) { await step(row.household_id, row, { type: 'friend_late', minutes: mins }); await friendSay(row.household_id, row.id, user.id, `Thanks. The owner has been told you will be about ${mins} min late.`, 'FF-LATE-OK'); }
        return { status: 200, body: { status: row.state, lateMin: row.doc.lateMin ?? null } };
      }
    }
    const reply = kind === 'ff_yes' ? 'yes' : kind === 'ff_no' ? 'no' : /^(yes|haan|ha|ho|हाँ|हो|ok)\b/i.test((b.text ?? '').trim()) && !/\d/.test(b.text ?? '') ? 'yes' : /^(no|nahi|नहीं|नाही|sorry)\b/i.test((b.text ?? '').trim()) ? 'no' : 'propose';
    if (reply === 'yes' && !(row.doc.noteReadBy ?? []).includes(user.id) && (await firstTime(row.household_id, user.id)) && (await db.query<{ n: string | null }>(`select handling_note as n from pets where id=$1`, [row.parse?.parsed?.petId]))[0]?.n) {
      await friendSay(row.household_id, row.id, user.id, 'Before you say yes, please read the handling note above and tick “I have read this”.', 'FF-READ-FIRST', [{ id: `ff_read:${row.id}`, label: 'I have read this' }]);
      return { status: 200, body: { status: 'needs_note' } };
    }
    const { req } = await step(row.household_id, row, { type: 'friend_reply', friendId: user.id, messageId: b.messageId, reply, proposedTime: reply === 'propose' ? parseProposedTime(b.text ?? '') : undefined });
    return { status: 200, body: { status: req.state } };
    });
  }
  async function friendArrived(row: ReqRow, friendUserId: string) {
    if (row.doc.confirmedFriendId !== friendUserId || row.state !== 'Confirmed' || row.doc.friendSignalAt != null) return;
    await step(row.household_id, row, { type: 'friend_arrived' });
    await db.query(`update care_tasks set friend_arrived_at=$2 where id=$1`, ['cover_' + row.id, now().toISOString()]);
    await A.push.push('owner:' + row.household_id, 'Find cover', 'Your friend has arrived.');
  }

  async function tick() {
    const open = await db.query<ReqRow>(`select * from friend_requests where state in ('Sent','Provisional hold','Accepted - pending owner confirmation','Confirmed')`);
    for (const row of open) { const before = JSON.stringify(row.doc); const { req, effects } = reduce(row.doc, { type: 'tick' }, rowNow(row)); if (JSON.stringify(req) !== before || effects.length) { await saveReq(row, req); await runEffects(row.household_id, row, effects); } }
    // Live location deleted 24 h after the visit (retention, §9).
    await db.query(`delete from live_location_sessions where delete_after < $1`, [now().toISOString()]);
  }

  /**
   * PAW-014: one owner action at a time per request. Two taps arriving together would otherwise both read the
   * request before either saved it, and both send the access details.
   */
  const locks = new Map<string, Promise<unknown>>();
  function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const done = next.then(() => {}, () => {}); locks.set(id, done);
    void done.then(() => { if (locks.get(id) === done) locks.delete(id); });
    return next;
  }

  return { hooks, loadFriends, busyPets, pauseState, getReq, saveReq, step, runEffects, inbound, tick, messageFor, friendSay, ownerInfo, fmt, nowMin, rowNow, today, friendArrived, langOf, withLock };
}
export type FriendFinder = ReturnType<typeof makeFriendFinder>;

export function registerFriends(app: Hono<Env>, x: Ctx, ff: FriendFinder) {
  const db = x.d.db; const A = x.d.adapters; const now = () => x.d.clock.now();
  const H = (c: Context<Env>) => c.req.param('hh')!;
  const dm = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  /* ---------- F1: owner profile & privacy (PS-050, PS-054, PS-062) ---------- */
  app.get('/v1/households/:hh/privacy', async (c) => {
    if (!(await x.guard(c, H(c), 'household', 'read'))) return x.deny(c);
    const h = (await db.query<{ society: string; tower: string; loc_share: string }>(`select society, tower, loc_share from households where id=$1`, [H(c)]))[0]!;
    const flag = (await db.query<{ locked: boolean; note: string }>(`select locked, note from feature_flags where key='nearbyMemberFallback'`))[0];
    return c.json({ ...h, friendsSee: ['Your display name', h.loc_share === 'tower' ? 'Society and tower' : 'Society only', 'Pet name, species and size', 'Request details you approve'], hiddenUntilConfirmed: ['Flat number', 'Key and access notes', 'Emergency card', 'When the home is empty', 'Your phone number', 'Exact location, never shown'], nearbyFallback: { available: false, locked: flag?.locked ?? true, reason: 'Switched off until the identity-check process is approved (PS-062).' } });
  });
  app.put('/v1/households/:hh/privacy', async (c) => {
    if (!(await x.guard(c, H(c), 'household', 'update'))) return x.deny(c);
    const b = z.object({ locShare: z.enum(['society', 'tower']) }).parse(await c.req.json());
    await db.query(`update households set loc_share=$2 where id=$1`, [H(c), b.locShare]);
    await audit(db, c.get('userId'), H(c), 'privacy.location', b); return c.json({ ok: true });
  });

  /* ---------- F2 / F3: friends list, invite, profile, block / report (PS-051–053, PS-064, PS-069) ---------- */
  app.get('/v1/households/:hh/friends', async (c) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'read'))) return x.deny(c);
    const fs = await ff.loadFriends(H(c));
    return c.json(fs.filter(f => !f.blocked).map(f => ({ id: f.id, name: f.displayName, invited: !f.inviteAccepted, findable: f.inviteAccepted && f.discoverable && !f.optOutPending, distance: f.inviteAccepted && f.discoverable ? f.distanceLabel : 'Hidden until they opt in', availability: f.paused ? (f.pausedUntil ? `Paused until ${dm(f.pausedUntil)}` : 'Paused') : f.windowsLabel, key: f.key, language: f.language, maxPets: f.capacity })).concat([]).sort((a, b) => Number(a.invited) - Number(b.invited)));
  });
  app.get('/v1/households/:hh/friends/:uid', async (c) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'read'))) return x.deny(c);
    const f = (await ff.loadFriends(H(c))).find(y => y.id === c.req.param('uid'));
    if (!f || f.blocked) return c.json({ error: 'not_found' }, 404);
    if (!f.inviteAccepted || !f.discoverable) return c.json({ id: f.id, name: f.displayName, invited: true, note: 'Not visible until they opt in.' });
    return c.json({ id: f.id, name: f.displayName, distance: f.distanceLabel, language: f.language, capabilities: f.capabilities, availability: f.paused ? (f.pausedUntil ? `Paused until ${dm(f.pausedUntil)}` : 'Paused') : f.windowsLabel, key: f.key, stairsOk: f.stairsOk, maxPets: f.capacity, species: f.species, history: historySummary(f), responseBand: f.responseBand, updated: f.updatedLabel, disclaimer: 'Descriptive only, not a safety rating or a guarantee.' });
  });
  /** Spam/abuse limits (§9): per household, counted from the audit log so they survive restarts. */
  const overLimit = async (hh: string, action: string, max: number, windowMin: number) => ((await db.query<{ n: number }>(`select count(*)::int as n from audit_log where household_id=$1 and action=$2 and at > $3`, [hh, action, new Date(Date.now() - windowMin * 60000).toISOString()]))[0]!.n >= max);
  app.post('/v1/households/:hh/friends/invite', async (c) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'create'))) return x.deny(c);
    if (await overLimit(H(c), 'friend.invited', x.d.limits?.invitesPerDay ?? 20, 24 * 60)) return c.json({ error: 'rate_limited', note: 'Up to 20 friend invites a day.' }, 429);
    const b = z.object({ name: z.string().trim().max(60).refine(isPersonName, NAME_MESSAGE), phone: z.string().regex(/^\+91[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number.'), language: z.enum(LANG_CODES, { error: 'Choose a language from the list.' }) }).parse(await c.req.json());
    let u = (await db.query<{ id: string }>(`select id from users where phone_e164=$1`, [b.phone]))[0];
    if (!u) { u = { id: uid('u') }; await db.query(`insert into users(id, phone_e164, display_name, language) values ($1,$2,$3,$4)`, [u.id, b.phone, b.name, b.language]); }
    await db.query(`insert into friend_links(household_id, friend_user_id, status, display_label) values ($1,$2,'invited',$3) on conflict (household_id, friend_user_id) do nothing`, [H(c), u.id, b.name]);
    const o = await ff.ownerInfo(H(c));
    await ff.friendSay(H(c), null, u.id, `${o.owner.split(' ')[0]} (${o.tower}) ${FRIEND_MSG.invite![msgLang(b.language)]}`, 'FF-INV-1', [{ id: `ff_invite_accept:${H(c)}`, label: 'Set up my profile' }]);
    await audit(db, c.get('userId'), H(c), 'friend.invited', { note: 'invitation is not discoverability consent' });
    return c.json({ id: u.id }, 201);
  });
  const blockReport = async (c: Context<Env>, report: boolean) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'create'))) return x.deny(c);
    const b = z.object({ reason: z.string().max(200).optional(), block: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    const fid = c.req.param('uid');
    if (!report || b.block) await db.query(`update friend_links set status='blocked' where household_id=$1 and friend_user_id=$2`, [H(c), fid]);
    if (report) await db.query(`insert into ops_cases(id, household_id, kind, title, notes) values ($1,$2,'abuse','Friend report',$3)`, [uid('case'), H(c), JSON.stringify([b.reason ?? 'No reason given', 'Act within 24 h; pause the account if there is a safety risk'])]);
    await audit(db, c.get('userId'), H(c), report ? 'friend.reported' : 'friend.blocked', { friend: fid, blocked: !report || !!b.block });
    return c.json({ ok: true });
  };
  app.post('/v1/households/:hh/friends/:uid/block', (c) => blockReport(c, false));
  app.post('/v1/households/:hh/friends/:uid/report', (c) => blockReport(c, true));

  /* ---------- F4: Ask Pawsure (PS-055, PS-056, PS-065, PS-125) ---------- */
  const parseCtx = async (hh: string): Promise<ParseContext> => {
    const pets = await db.query<{ id: string; name: string; species: string; medicines: string | null }>(`select id, name, species, medicines from pets where household_id=$1 order by name`, [hh]);
    const access = (await ff.ownerInfo(hh)).access;
    return { now: ff.nowMin(), pets: pets.map(p => ({ id: p.id, name: p.name, species: p.species, medsInstructions: p.medicines ?? '' })), defaultAccess: access ? 'Key handover' : null, defaultAccessLabel: access ? 'from your profile: ' + access : undefined };
  };
  /** PAW-005: the editability matrix. Editable until the first message goes out; after that, cancel or change time only. */
  const EDITABLE = ['Draft', 'Ready for search', 'Awaiting owner approval'];
  const ACTIVE = ['Sent', 'Provisional hold', 'Accepted - pending owner confirmation', 'Confirmed'];
  /** The pet's written medicine instructions, or null when the profile has none ("None", blank). */
  const realMeds = (m: string | null | undefined) => m && !/^\s*(none|none known|no|nil|-)?\s*$/i.test(m) ? m : null;
  const petMeds = async (petId: string | null | undefined) => realMeds(petId ? (await db.query<{ medicines: string | null }>(`select medicines from pets where id=$1`, [petId]))[0]?.medicines : null);
  /** PAW-033: on a request for several pets, each pet's own instructions, named ("Bruno: …"). */
  const medsFor = async (ids: string[]) => {
    if (ids.length <= 1) return petMeds(ids[0]);
    const rows = (await db.query<{ id: string; name: string; medicines: string | null }>(`select id, name, medicines from pets where id = any($1)`, [ids])).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)).filter(r => realMeds(r.medicines));
    return rows.length ? rows.map(r => `${r.name}: ${r.medicines}`).join(' · ') : null;
  };
  /** PAW-006: what changed in the pet profile since the request was written (only while it can still be edited). */
  const petChanges = async (row: ReqRow) => {
    const p = row.parse?.parsed; if (!p || !EDITABLE.includes(row.state) || !p.tasks.includes('meds') || !p.medsInstructions) return [];
    return (await medsFor(petsOf(p))) !== p.medsInstructions ? ['medicine instructions'] : [];
  };
  /** PAW-007: another request already out to friends for the same pet, day, a task in common, within 30 minutes. */
  const duplicateOf = async (row: ReqRow) => {
    const p = row.parse?.parsed; if (!p?.petId || p.time == null || ACTIVE.includes(row.state)) return null;
    return (await db.query<{ id: string }>(`select id from friend_requests where household_id=$1 and id<>$2 and state = any($3::text[]) and (parse->'parsed'->>'petId' = any($4::text[]) or coalesce(parse->'parsed'->'petIds','[]'::jsonb) ?| $4::text[]) and parse->>'careDate'=$5
      and abs((coalesce(doc->>'taskTime', parse->'parsed'->>'time'))::int - $6) <= 30 and exists (select 1 from jsonb_array_elements_text(parse->'parsed'->'tasks') t where t = any($7::text[])) order by created_at desc limit 1`,
      [row.household_id, row.id, ACTIVE, petsOf(p), row.parse!.careDate, p.time, p.tasks]))[0]?.id ?? null;
  };
  const view = async (row: ReqRow) => {
    const names =Object.fromEntries((await db.query<{ id: string; n: string }>(`select id, coalesce(display_name,'Friend') as n from users where id = any($1)`, [row.doc.recipients.map(r => r.friendId).concat(row.doc.confirmedFriendId ?? [])])).map(r => [r.id, r.n]));
    const p = row.parse;
    const ai = x.d.adapters.llm.connected;
    // v1.1.0 fix #4: no real model is connected, so the label always says rules; the demo switch now names the same thing.
    const parsedBy = row.parser === 'manual' ? (p?.parsed?.sources?.time === 'from the task' ? 'pre-filled from the at-risk task' : 'simple form') : row.parser === 'llm' && ai ? 'AI (structured)' : ai ? 'rules (AI fallback)' : 'rules (no AI connected)';
    // PAW-006: the medicine question always quotes the pet profile as it is now, not as it was when the request was written.
    const medsNow = p?.parsed && p.clarifications?.some(cl => cl.field === 'meds') ? await medsFor(petsOf(p.parsed)) : null;
    const petNm = medsNow != null || p?.clarifications?.some(cl => cl.field === 'meds') ? (await db.query<{ name: string }>(`select name from pets where id = any($1) order by name`, [p?.parsed ? petsOf(p.parsed) : []])).map(r => r.name).join(' and ') || 'the pet' : '';
    const clarifications = (p?.clarifications ?? []).map(cl => cl.field !== 'meds' ? cl : { ...cl, options: cl.options.map(o => o.value !== 'profile' ? o : { ...o, label: medsNow ? `Use ${petNm}’s profile: ${medsNow}` : `${petNm}’s profile has no medicine instructions yet` }) });
    return { id: row.id, state: row.state, text: p?.text, parser: row.parser, parsedBy, aiConnected: ai, fallbackReason: p?.fallbackReason, parsed: p?.parsed, clarifications, blocked: p?.parsed ? searchBlockedReasons(p.parsed, p.clarifications) : ['missing:parse'], correctedFields: row.corrected_fields, taskTime: row.doc.taskTime, mode: row.doc.mode,
      recipients: row.doc.recipients.map(r => ({ ...r, name: names[r.friendId] })), holdFriendId: row.doc.holdFriendId, holdAt: row.doc.holdAt, confirmedFriendId: row.doc.confirmedFriendId, confirmedName: row.doc.confirmedFriendId ? names[row.doc.confirmedFriendId] : null,
      history: row.doc.history.map(h => ({ ...h, note: Object.entries(names).reduce((n, [id, nm]) => n.split(id).join(nm.split(' ')[0]!), h.note) })), coverTaskId: row.doc.confirmedFriendId ? 'cover_' + row.id : null, searchClosesAt: row.doc.taskTime != null ? row.doc.taskTime - 30 : null, exclude: row.doc.exclude, origin: row.doc.origin ?? null, careDate: p?.careDate, searchOpen: row.doc.taskTime == null || ff.rowNow(row) < row.doc.taskTime - 30, noteReadBy: row.doc.noteReadBy ?? [],
      editable: EDITABLE.includes(row.state) && !!p?.parsed, petChanged: await petChanges(row), duplicateOf: await duplicateOf(row), lateMin: row.doc.lateMin ?? null, doneTasks: row.doc.doneTasks ?? null, arrived: row.doc.friendSignalAt != null };
  };
  app.post('/v1/households/:hh/requests', async (c) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'create'))) return x.deny(c);
    if (await overLimit(H(c), 'request.created', x.d.limits?.requestsPerHour ?? 10, 60)) return c.json({ error: 'rate_limited', note: 'Up to 10 cover requests an hour. Call Pawsure support if this is an emergency.' }, 429);
    const b = z.object({ text: z.string().max(500).optional(), manual: z.object({ tasks: z.array(z.enum(['feed', 'walk', 'meds', 'water', 'litter', 'toilet'])).min(1), petId: z.string(), petIds: z.array(z.string()).min(1).max(4).optional(), time: z.number().int().min(0).max(1439), access: z.enum(['Key handover', 'Someone at home', 'Friend has key']) }).optional() }).parse(await c.req.json());
    const hh = H(c), id = 'ffr_' + uid('x').slice(2, 12), ctx = await parseCtx(hh);
    let result: ParseResult | null = null, fallbackReason: string | undefined;
    if (b.manual) {
      const m = b.manual; const ids = [...new Set(m.petIds?.length ? m.petIds : [m.petId])];
      if (ids.some(i => !ctx.pets.some(p => p.id === i))) return c.json({ error: 'unknown_pet', message: 'Choose pets from your own home.' }, 400);
      const meds = m.tasks.includes('meds') ? await medsFor(ids) : null;
      result = { parsed: { tasks: m.tasks as FFTask[], petId: ids[0]!, ...(ids.length > 1 ? { petIds: ids } : {}), time: m.time, durationMin: ((m.tasks.includes('walk') ? 15 : 0) + (m.tasks.includes('feed') ? 10 : 0) + (m.tasks.includes('meds') ? 5 : 0) || 10) + (ids.length - 1) * 5, access: m.access, lift: null, urgency: 'Today', medsInstructions: meds, sources: { time: 'form', access: 'form' } }, clarifications: [], confidence: 1, parser: 'rules' };
    } else if (b.text?.trim()) {
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
      try { const r = await A.llm.parse(b.text, ctx, ac.signal); if (r.confidence < 0.5) fallbackReason = `Low confidence (${Math.round(r.confidence * 100)}%)`; else result = r; }
      catch (e) { fallbackReason = (e as Error).message === 'llm_timeout' ? 'AI timed out after 8 s' : 'AI unavailable'; }
      finally { clearTimeout(timer); }
      await audit(db, 'system', hh, fallbackReason ? 'llm.fallback' : 'llm.parsed', { request: id, reason: fallbackReason, clarifications: result?.clarifications.length });
    } else return c.json({ error: 'text_or_manual_required' }, 400);
    const doc = newRequest(id, ff.nowMin());
    const parse = result ? { ...result, originalParsed: result.parsed, careDate: ff.today(), text: b.text ?? '(simple form)' } : null;
    await db.query(`insert into friend_requests(id, household_id, state, parse, parser, doc, created_by) values ($1,$2,'Draft',$3,$4,$5,$6)`, [id, hh, parse ? JSON.stringify(parse) : JSON.stringify({ text: b.text, careDate: ff.today(), fallbackReason, clarifications: [], parsed: null }), b.manual ? 'manual' : result ? 'llm' : null, JSON.stringify(doc), c.get('userId')]);
    await audit(db, c.get('userId'), hh, 'request.created', { id, manual: !!b.manual });
    const row = (await ff.getReq(id))!;
    return c.json({ ...(await view(row)), needsManualForm: !result, fallbackReason }, 201);
  });
  app.get('/v1/households/:hh/requests', async (c) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'read'))) return x.deny(c);
    const rows = await db.query<ReqRow>(`select * from friend_requests where household_id=$1 order by created_at desc limit 30`, [H(c)]);
    return c.json(await Promise.all(rows.map(view)));
  });
  app.get('/v1/households/:hh/requests/:id', async (c) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'read'))) return x.deny(c);
    const row = await ff.getReq(c.req.param('id'), H(c)); if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(await view(row));
  });
  /** Owner edits chips / answers clarifications. Changes to time, task, medicine or access the AI parsed count toward the correction rate. */
  app.patch('/v1/households/:hh/requests/:id', async (c) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'update'))) return x.deny(c);
    const body = await c.req.json();
    return ff.withLock(c.req.param('id'), async () => {
    const row = await ff.getReq(c.req.param('id'), H(c)); if (!row?.parse?.parsed) return c.json({ error: 'not_found' }, 404);
    if (!EDITABLE.includes(row.state)) return c.json({ error: 'already_sent', message: 'This request has already been sent to friends, so it can’t be edited. Cancel it and ask again, or change the time once a friend has said yes.' }, 409);
    const b = z.object({ fields: z.object({ tasks: z.array(z.enum(['feed', 'walk', 'meds', 'water', 'litter', 'toilet'])).optional(), petId: z.string().optional(), petIds: z.array(z.string()).min(1).max(4).optional(), time: z.number().int().min(0).max(1439).optional(), durationMin: z.number().int().min(5).max(120).optional(), access: z.enum(['Key handover', 'Someone at home', 'Friend has key']).optional(), lift: z.enum(['Lift', 'Stairs needed']).nullable().optional() }).optional(), clarify: z.object({ field: z.enum(['time', 'access', 'meds', 'tasks']), value: z.string() }).optional(), maxBand: z.number().int().min(0).max(3).optional() }).parse(body);
    const p = row.parse; const parsed = { ...p.parsed, ...(b.fields ?? {}) } as ParsedRequest;
    const beforeJson = JSON.stringify({ parsed: p.parsed, clar: p.clarifications, maxBand: p.maxBand });
    // PAW-033: several pets. A single petId edit replaces the list; petIds sets it (first one is the main pet).
    if (b.fields?.petIds) { const ids = [...new Set(b.fields.petIds)]; const own = (await db.query<{ id: string }>(`select id from pets where household_id=$1 and id = any($2)`, [H(c), ids])).length; if (own !== ids.length) return c.json({ error: 'unknown_pet', message: 'Choose pets from your own home.' }, 400); parsed.petId = ids[0]!; if (ids.length > 1) parsed.petIds = ids; else delete parsed.petIds; }
    else if (b.fields?.petId) delete parsed.petIds;
    const petsChanged = petsOf(parsed).join() !== petsOf(p.parsed).join();
    if (petsChanged) parsed.durationMin = Math.max(5, p.parsed.durationMin + (petsOf(parsed).length - petsOf(p.parsed).length) * 5);
    // PAW-015: a different pet means that pet's own written medicine instructions, never the previous pet's.
    if (petsChanged && parsed.tasks.includes('meds')) {
      parsed.medsInstructions = await medsFor(petsOf(parsed));
      p.clarifications = p.clarifications.filter(cl => cl.field !== 'meds');
    }
    if (b.clarify) {
      const { field, value } = b.clarify;
      if (field === 'time') parsed.time = Number(value);
      if (field === 'access') parsed.access = value as ParsedRequest['access'];
      if (field === 'tasks') parsed.tasks = [...new Set([...parsed.tasks, ...value.split('+') as FFTask[]])];
      if (field === 'meds') { if (value === 'remove') parsed.tasks = parsed.tasks.filter(t => t !== 'meds'); else parsed.medsInstructions = await medsFor(petsOf(parsed)); }
      p.clarifications = p.clarifications.filter(cl => cl.field !== field);
    }
    if (b.fields?.time != null) p.clarifications = p.clarifications.filter(cl => cl.field !== 'time');
    if (b.fields?.access) p.clarifications = p.clarifications.filter(cl => cl.field !== 'access');
    if (parsed.tasks.includes('meds') && !parsed.medsInstructions && !p.clarifications.some(cl => cl.field === 'meds')) p.clarifications.push({ field: 'meds', question: 'Which written medicine instructions should the friend follow?', options: [{ value: 'profile', label: 'Use the pet profile instructions' }, { value: 'remove', label: 'Remove the medicine task' }] });
    p.parsed = parsed; if (b.maxBand != null) p.maxBand = b.maxBand;
    // PAW-003: re-selecting what is already chosen is not an edit: no new event, and the request keeps its place.
    if (JSON.stringify({ parsed: p.parsed, clar: p.clarifications, maxBand: p.maxBand }) === beforeJson) return c.json(await view(row));
    if (row.parser === 'llm' && p.originalParsed) row.corrected_fields = [...new Set([...row.corrected_fields, ...correctedCriticalFields(p.originalParsed, parsed)])];
    if (row.state !== 'Draft') { row.doc = { ...row.doc, state: 'Draft', history: [...row.doc.history, { at: ff.nowMin(), state: 'Draft', note: 'Owner edited the request' }] }; }
    await ff.saveReq(row, row.doc);
    await audit(db, c.get('userId'), H(c), 'request.edited', { id: row.id, corrected: row.corrected_fields });
    return c.json(await view(row));
    });
  });

  /* ---------- F5: deterministic search + suggestions (PS-057, PS-058, PS-066; nearby fallback OFF) ---------- */
  app.post('/v1/households/:hh/requests/:id/search', async (c) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'create'))) return x.deny(c);
    const hh = H(c);
    return ff.withLock(c.req.param('id'), async () => {
    const row = await ff.getReq(c.req.param('id'), hh); if (!row?.parse?.parsed) return c.json({ error: 'not_found' }, 404);
    // PAW-006: friends are asked with the pet profile as it is now, not as it was when the request was written.
    if ((await petChanges(row)).length) {
      row.parse.parsed = { ...row.parse.parsed, medsInstructions: await medsFor(petsOf(row.parse.parsed)) };
      if (!row.parse.parsed.medsInstructions && !row.parse.clarifications.some(cl => cl.field === 'meds')) row.parse.clarifications.push({ field: 'meds', question: 'Which written medicine instructions should the friend follow?', options: [{ value: 'profile', label: 'Use the pet profile instructions' }, { value: 'remove', label: 'Remove the medicine task' }] });
      if (row.state !== 'Draft') row.doc = { ...row.doc, state: 'Draft', history: [...row.doc.history, { at: ff.nowMin(), state: 'Draft', note: 'Pet profile changed: medicine instructions updated' }] };
      await ff.saveReq(row, row.doc);
    }
    const blocked = searchBlockedReasons(row.parse.parsed, row.parse.clarifications);
    if (blocked.length) return c.json({ error: 'clarification_needed', blocked }, 409);
    if (row.state === 'Draft') await ff.step(hh, row, { type: 'parse_confirmed', taskTime: row.parse.parsed.time! });
    const m = matchFriends(row.parse.parsed, await ff.loadFriends(hh, forReq(row)), await matchOpts(row));
    if (row.state === 'Ready for search') await ff.step(hh, row, { type: 'suggestions_shown' });
    await audit(db, 'system', hh, 'match.result', { request: row.id, eligible: m.eligible.length, excluded: m.excludedCounts, rule: 'deterministic-v1' });
    const top = await Promise.all(m.top.map(async t => ({ id: t.friend.id, name: t.friend.displayName, distance: t.friend.distanceLabel, language: t.friend.language, reasons: t.reasons, message: (await ff.messageFor(hh, row, t.friend.id)).text })));
    return c.json({ request: await view(row), top, excludedCounts: m.excludedCounts, nearbyFallback: { offered: false, reason: 'Switched off until the identity-check process is approved.' }, laterOptions: 'Verified carers (P2) and day cares (P1) are not available yet.' });
    });
  });
  /** One place for the match rules used by search, approve and confirm (PAW-026, PAW-033, PAW-034, PAW-040). */
  const forReq = (row: ReqRow) => { const p = row.parse!.parsed; const t = row.doc.taskTime ?? p.time ?? 0; return { id: row.id, careDate: row.parse!.careDate, start: t, end: t + (p.durationMin || 15) }; };
  const matchOpts = async (row: ReqRow) => {
    const pets = await db.query<{ size: string | null; fears: string | null; species: string }>(`select size, fears, species from pets where id = any($1)`, [petsOf(row.parse!.parsed)]);
    const t = row.doc.taskTime ?? row.parse!.parsed.time ?? 0;
    return { maxBand: row.parse!.maxBand ?? 3, exclude: row.doc.exclude, largeOrAnxiousPet: pets.some(pet => /large/i.test(pet.size ?? '')), petCount: Math.max(1, pets.length), species: [...new Set(pets.map(pet => pet.species))], minutesUntilStart: t - ff.rowNow(row) };
  };
  /** Nothing leaves before this explicit approval (PS-059). Recipients must be among the current eligible suggestions. */
  app.post('/v1/households/:hh/requests/:id/approve', async (c) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'approve'))) return x.deny(c);
    const b = z.object({ friendIds: z.array(z.string()).min(1).max(3), mode: z.enum(['one', 'all3']), approved: z.literal(true) }).parse(await c.req.json());
    const hh = H(c);
    return ff.withLock(c.req.param('id'), async () => {
    const row = await ff.getReq(c.req.param('id'), hh); if (!row?.parse?.parsed) return c.json({ error: 'not_found' }, 404);
    // PAW-014: the same Send again (double tap, retry) returns the request as it is; nothing is sent twice.
    const sameSend = row.doc.recipients.length === b.friendIds.length && b.friendIds.every(f => row.doc.recipients.some(r => r.friendId === f)) && row.doc.mode === b.mode;
    if (row.state !== 'Awaiting owner approval' && sameSend) return c.json(await view(row));
    // PAW-016: suggestions are only valid for the request they were made for.
    if (row.state !== 'Awaiting owner approval') return row.doc.recipients.length
      ? c.json({ error: 'already_sent', message: 'This request has already been sent.' }, 409)
      : c.json({ error: 'search_first', message: 'The request has changed since the suggestions were made. Search again before sending.' }, 409);
    // PAW-007: never two requests out to friends for the same pet and time.
    const dup = await duplicateOf(row);
    if (dup) return c.json({ error: 'duplicate_active', duplicateOf: dup, message: 'You already have a request out to friends for this pet at about this time. Open it, or cancel it first.' }, 409);
    const eligible = matchFriends(row.parse.parsed, await ff.loadFriends(hh, forReq(row)), await matchOpts(row)).top.map(t => t.friend.id);
    if (b.friendIds.some(f => !eligible.includes(f))) return c.json({ error: 'not_eligible' }, 409);
    try { await ff.step(hh, row, { type: 'owner_approved_send', friendIds: b.friendIds, mode: b.mode }); }
    catch (e) { return c.json({ error: 'too_close', message: (e as Error).message }, 409); }
    await audit(db, c.get('userId'), hh, 'request.approved', { id: row.id, recipients: b.friendIds.length, mode: b.mode });
    return c.json(await view(row));
    });
  });
  const ownerAction = (ev: (b: Record<string, unknown>) => FFEvent, schema: z.ZodTypeAny) => async (c: Context<Env>) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'approve'))) return x.deny(c);
    const b = schema.parse(await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return ff.withLock(c.req.param('id')!, async () => {
      const row = await ff.getReq(c.req.param('id')!, H(c)); if (!row) return c.json({ error: 'not_found' }, 404);
      const before = row.doc.history.length;
      const e0 = ev(b);
      // PAW-034 / PAW-043: two owners can't both book the same friend for overlapping visits beyond what they agreed to.
      if (e0.type === 'owner_confirm' && row.doc.confirmedFriendId !== e0.friendId && row.parse?.parsed) {
        const f = (await ff.loadFriends(H(c), { ...forReq(row), confirmedOnly: true })).find(x => x.id === e0.friendId);
        if (f && f.activeRequests + petsOf(row.parse.parsed).length > f.capacity) return c.json({ error: 'friend_busy', message: `${f.displayName.split(' ')[0]} has just been booked for another visit at that time. Ask someone else.` }, 409);
      }
      try { await ff.step(H(c), row, ev(b)); } catch (e) { return c.json({ error: 'invalid_transition', message: (e as Error).message }, 409); }
      if (row.doc.history.length === before) return c.json(await view(row)); // PAW-014: a repeat changed nothing
      if (ev(b).type === 'owner_change_time') await db.query(`update care_tasks set due_minute=$2 where id=$1`, ['cover_' + row.id, b.time]);
      await audit(db, c.get('userId'), H(c), 'request.' + ev(b).type, { id: row.id });
      return c.json(await view(row));
    });
  };
  app.post('/v1/households/:hh/requests/:id/confirm', ownerAction(b => ({ type: 'owner_confirm', friendId: b.friendId as string }), z.object({ friendId: z.string() })));
  app.post('/v1/households/:hh/requests/:id/cancel', ownerAction(() => ({ type: 'owner_cancel' }), z.object({})));
  app.post('/v1/households/:hh/requests/:id/change-time', ownerAction(b => ({ type: 'owner_change_time', time: b.time as number }), z.object({ time: z.number().int().min(0).max(1439) })));
  app.post('/v1/households/:hh/requests/:id/complete', ownerAction(() => ({ type: 'completed' }), z.object({})));

  /* ---------- F6 / F7: the friend’s side, when a friend signs in (PS-052–054, PS-060, PS-063) ---------- */
  app.get('/v1/me/friend', async (c) => {
    const uidv = c.get('userId');
    const raw = (await db.query<Record<string, unknown>>(`select discoverable, opt_out_requested_at, paused, paused_until::text as paused_until, windows, capabilities, key_mode, stairs_ok, live_location_allowed, nearby_opt_in, max_pets, species, updated_at from friend_profiles where user_id=$1`, [uidv]))[0];
    // PAW-029: what the friend sees is the pause as it is today: a 6-day pause that has ended shows as off.
    const ps = raw ? ff.pauseState(raw) : null;
    const profile = raw ? { ...raw, pause_active: ps!.active, paused_until: ps!.until, resumes_on: ps!.resumesOn } : null;
    const links = await db.query(`select l.household_id, l.status, h.society, h.tower, (select coalesce(u.display_name,'Owner') from memberships m join users u on u.id=m.user_id where m.household_id=l.household_id and m.role='owner' limit 1) as owner from friend_links l join households h on h.id=l.household_id where l.friend_user_id=$1 and l.status in ('invited','accepted')`, [uidv]);
    const reqs = await db.query<ReqRow>(`select * from friend_requests where doc->'recipients' @> $1::jsonb order by updated_at desc limit 10`, [JSON.stringify([{ friendId: uidv }])]);
    const messages = await db.query(`select request_id, direction, body, buttons, at from friend_messages where friend_user_id=$1 order by at, id`, [uidv]);
    const lang = await ff.langOf(uidv);
    return c.json({ profile, links, language: lang, messages, requests: await Promise.all(reqs.map(async r => {
      const me = r.doc.recipients.find(x => x.friendId === uidv)!;
      const grant = (await db.query(`select expires_at from access_grants where request_id=$1 and friend_user_id=$2 and revoked_at is null and expires_at > $3`, [r.id, uidv, now().toISOString()]))[0];
      const ftime = ((await db.query<{ n: number }>(`select help_count as n from friend_links where household_id=$1 and friend_user_id=$2`, [r.household_id, uidv]))[0]?.n ?? 0) === 0;
      const note = ftime ? (await db.query<{ n: string | null }>(`select handling_note as n from pets where id=$1`, [r.parse?.parsed?.petId]))[0]?.n ?? null : null;
      return { id: r.id, householdId: r.household_id, state: r.state, myState: me.state, taskTime: r.doc.taskTime, careDate: r.parse?.careDate, tasks: r.parse?.parsed?.tasks ?? [], lateMin: r.doc.lateMin ?? null, arrived: r.doc.friendSignalAt != null, confirmedForMe: r.doc.confirmedFriendId === uidv, accessActive: !!grant, message: (await ff.messageFor(r.household_id, r, uidv)).text, handlingNote: note, noteRead: (r.doc.noteReadBy ?? []).includes(uidv) };
    })) });
  });
  app.put('/v1/me/friend', async (c) => {
    const b = z.object({ discoverable: z.boolean().optional(), paused: z.boolean().optional(), pausedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), pauseDays: z.number().int().min(1).max(30).optional(), maxPets: z.number().int().min(1).max(4).optional(), species: z.array(z.enum(['Dog', 'Cat', 'Other'])).min(1).optional(),
      windows: z.array(z.tuple([z.number().int().min(0).max(1440), z.number().int().min(0).max(1440)]).refine(([a, w]) => a !== w, 'A free time needs a different start and end.')).max(4).optional(), capabilities: z.object({ feed: z.boolean(), walk: z.boolean(), meds: z.boolean(), large: z.boolean() }).partial().optional(), keyMode: z.enum(['yes', 'handover', 'no']).optional(), stairsOk: z.boolean().optional(), liveLocationAllowed: z.boolean().optional(), nearbyOptIn: z.boolean().optional(), language: z.enum(LANG_CODES, { error: 'Choose a language from the list.' }).optional() }).parse(await c.req.json());
    const uidv = c.get('userId');
    await db.query(`insert into friend_profiles(user_id) values ($1) on conflict do nothing`, [uidv]);
    const sets: string[] = [], vals: unknown[] = [uidv];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
    if (b.discoverable != null) { put('discoverable', b.discoverable); put('opt_out_requested_at', b.discoverable ? null : now().toISOString()); }
    // PAW-029: "Pause for 6 days" is worked out on the server in India time (today counts as day 1), so the phone's
    // clock or time zone can't shorten or stretch it. Turning the pause off ends a timed pause too.
    if (b.pauseDays != null) { put('paused', false); put('paused_until', istDate(new Date(now().getTime() + (b.pauseDays - 1) * 86400000))); }
    else if (b.paused === false) { put('paused', false); put('paused_until', null); }
    else { if (b.paused != null) put('paused', b.paused); if (b.pausedUntil !== undefined) put('paused_until', b.pausedUntil); }
    if (b.maxPets != null) put('max_pets', b.maxPets);
    if (b.species) put('species', JSON.stringify(b.species));
    if (b.windows) put('windows', JSON.stringify(b.windows));
    if (b.capabilities) put('capabilities', JSON.stringify(b.capabilities));
    if (b.keyMode) put('key_mode', b.keyMode);
    if (b.stairsOk != null) put('stairs_ok', b.stairsOk);
    if (b.liveLocationAllowed != null) put('live_location_allowed', b.liveLocationAllowed);
    if (b.nearbyOptIn != null) put('nearby_opt_in', b.nearbyOptIn);
    put('updated_at', now().toISOString());
    await db.query(`update friend_profiles set ${sets.join(',')} where user_id=$1`, vals);
    if (b.language) await db.query(`update users set language=$2 where id=$1`, [uidv, b.language]);
    if (b.discoverable != null) await db.query(`insert into consent_records(id, user_id, kind, version, language, granted) values ($1,$2,'friend_discovery','FD-1.0',$3,$4)`, [uid('cr'), uidv, b.language ?? 'en', b.discoverable]);
    if (b.capabilities) await audit(db, uidv, null, 'friend.capabilities', { ...b.capabilities, note: 'explicit choice, never AI-inferred' });
    await audit(db, uidv, null, 'friend.profile.updated', { fields: Object.keys(b), note: b.discoverable === false ? 'removed from search immediately (target ≤60 s)' : undefined });
    const st = ff.pauseState((await db.query<Record<string, unknown>>(`select paused, paused_until::text as paused_until from friend_profiles where user_id=$1`, [uidv]))[0]!);
    // PAW-028: pausing stops new requests; visits already confirmed stay booked, and the friend is told which.
    const committed = st.active ? (await db.query<{ id: string; household_id: string }>(`select id, household_id from friend_requests where state='Confirmed' and doc->>'confirmedFriendId'=$1 and parse->>'careDate' >= $2`, [uidv, ff.today()])).length : 0;
    return c.json({ ok: true, pauseActive: st.active, pausedUntil: st.until, resumesOn: st.resumesOn, stillConfirmed: committed, removedFromSearch: b.discoverable === false ? 'immediately' : undefined, nearbyNote: b.nearbyOptIn ? 'Saved, but nearby-member matching is switched off until ID checks are approved.' : undefined });
  });
  app.post('/v1/me/friend/links/:hh/accept', async (c) => {
    const r = await db.query(`update friend_links set status='accepted' where household_id=$1 and friend_user_id=$2 and status='invited' returning household_id`, [c.req.param('hh'), c.get('userId')]);
    if (!r.length) return c.json({ error: 'not_found' }, 404);
    await db.query(`insert into friend_profiles(user_id) values ($1) on conflict do nothing`, [c.get('userId')]);
    await audit(db, c.get('userId'), c.req.param('hh'), 'friend.invite.accepted', { note: 'still not findable until they opt in' });
    return c.json({ ok: true });
  });
  const myRequest = async (c: Context<Env>) => { const row = await ff.getReq(c.req.param('id')!); return row && row.doc.recipients.some(r => r.friendId === c.get('userId')) ? row : undefined; };
  app.post('/v1/me/requests/:id/reply', async (c) => {
    const row = await myRequest(c); if (!row) return c.json({ error: 'not_found' }, 404);
    const b = z.object({ reply: z.enum(['yes', 'no', 'propose', 'read']), text: z.string().max(200).optional() }).parse(await c.req.json());
    const u = (await db.query<{ phone_e164: string }>(`select phone_e164 from users where id=$1`, [c.get('userId')]))[0]!;
    const r = await ff.inbound({ messageId: 'app-' + uid('m'), from: u.phone_e164, type: b.reply === 'propose' ? 'text' : 'button', payload: b.reply === 'propose' ? undefined : `ff_${b.reply}:${row.id}`, text: b.text });
    return c.json(r.body, r.status as 200);
  });
  app.post('/v1/me/requests/:id/late', async (c) => {
    const row = await myRequest(c); if (!row || row.doc.confirmedFriendId !== c.get('userId')) return c.json({ error: 'not_found' }, 404);
    const { minutes } = z.object({ minutes: z.number().int().min(5, 'Choose at least 5 minutes.').max(120, 'For more than 2 hours, cancel so the owner can ask someone else.') }).parse(await c.req.json());
    return ff.withLock(row.id, async () => {
      const r = (await ff.getReq(row.id))!;
      try { await ff.step(r.household_id, r, { type: 'friend_late', minutes }); } catch (e) { return c.json({ error: 'invalid_transition', message: r.doc.friendSignalAt != null ? 'You have already checked in.' : 'This visit is no longer active.' }, 409); }
      return c.json({ ok: true, state: r.state, lateMin: r.doc.lateMin });
    });
  });
  /** PAW-056: the friend must leave mid-visit. Recorded as Interrupted with what was done; backups are asked at once. */
  app.post('/v1/me/requests/:id/emergency', async (c) => {
    const row = await myRequest(c); if (!row || row.doc.confirmedFriendId !== c.get('userId')) return c.json({ error: 'not_found' }, 404);
    const { done } = z.object({ done: z.array(z.enum(['feed', 'walk', 'meds', 'water', 'litter', 'toilet'])).max(6).default([]) }).parse(await c.req.json().catch(() => ({})));
    return ff.withLock(row.id, async () => {
      const r = (await ff.getReq(row.id))!;
      const allowed = done.filter(t => r.parse?.parsed?.tasks.includes(t));
      try { await ff.step(r.household_id, r, { type: 'friend_emergency_leave', done: allowed }); } catch { return c.json({ error: 'invalid_transition', message: 'This visit is no longer active.' }, 409); }
      return c.json({ ok: true, state: r.state, done: r.doc.doneTasks ?? [] });
    });
  });
  app.post('/v1/me/requests/:id/:action{arrived|done|cancel}', async (c) => {
    const row0 = await myRequest(c); if (!row0 || row0.doc.confirmedFriendId !== c.get('userId')) return c.json({ error: 'not_found' }, 404);
    const action = c.req.param('action');
    const proof = action === 'done' ? ProofIn.parse(await c.req.json().catch(() => ({}))) : {};
    return ff.withLock(row0.id, async () => {
    const row = (await ff.getReq(row0.id))!;
    // PAW-054 / PAW-062: a repeated or late tap (second Done, Done after an emergency exit or after a replacement took over) changes nothing.
    if (action === 'done' && row.state === 'Completed') return c.json({ ok: true, state: row.state, note: 'Already marked done.' });
    if (row.state !== 'Confirmed') return c.json({ error: 'not_active', state: row.state, message: row.state === 'Interrupted' ? 'This visit was interrupted. The owner’s backups have taken over.' : 'This visit is no longer active.' }, 409);
    if (action === 'arrived') await ff.friendArrived(row, c.get('userId'));
    if (action === 'cancel') await ff.step(row.household_id, row, { type: 'friend_cancel' });
    if (action === 'done') await db.query(`delete from visit_access_checklist where task_id=$1`, ['cover_' + row.id]);
    let result: Awaited<ReturnType<typeof recordProof>> | null = null;
    if (action === 'done') {
      // Proof: a photo of the bowl or pet and/or today's code from the food-box card (graded like WhatsApp proof).
      result = await recordProof(db, { householdId: row.household_id, taskId: 'cover_' + row.id, actor: 'friend:' + c.get('userId'), channel: 'app', proof, now: now(), key: `friend-done:${row.id}` });
      await db.query(`update friend_links set help_count=help_count+1, checked_in_count=checked_in_count+$3 where household_id=$1 and friend_user_id=$2`, [row.household_id, c.get('userId'), result.grade === 'none' ? 0 : 1]);
      await ff.step(row.household_id, row, { type: 'completed' });
      await A.push.push('owner:' + row.household_id, 'Find cover', result.grade === 'strong' ? 'Your friend finished and sent a photo with today’s code.' : result.grade === 'none' ? 'Your friend says they finished, but sent no photo or code.' : 'Your friend finished. The proof is incomplete: open Today to see it.');
    }
    return c.json({ ok: true, state: row.state, ...(result ? { proof: result, message: proofMessage(result) } : {}) });
    });
  });
  /** Access details + emergency card: only for the confirmed friend, only while the grant is active (PS-063, 9.5). */
  app.get('/v1/me/requests/:id/access', async (c) => {
    const row = await myRequest(c); if (!row) return c.json({ error: 'not_found' }, 404);
    const grant = (await db.query(`select 1 from access_grants where request_id=$1 and friend_user_id=$2 and revoked_at is null and expires_at > $3`, [row.id, c.get('userId'), now().toISOString()]))[0];
    await audit(db, c.get('userId'), row.household_id, 'access.viewed', { request: row.id, allowed: !!grant });
    if (!grant) return c.json({ error: 'no_access', note: 'Address, key and emergency details are shared only after the owner confirms you, and only for this visit.' }, 403);
    const o = await ff.ownerInfo(row.household_id); const p = row.parse!.parsed;
    const pet = (await db.query(`select name, species, food, allergies, medicines, fears, vet_name, vet_phone, clinic24_name, clinic24_phone from pets where id=$1`, [p.petId]))[0] as Record<string, string>;
    return c.json({ flat: o.flat, tower: o.tower, access: p.access === 'Someone at home' ? 'Someone will be at home' : o.access, pet: { ...pet, medicines: p.tasks.includes('meds') ? pet.medicines : 'Not part of this visit' }, notice: 'Pawsure is not an emergency or vet service.' });
  });
  app.post('/v1/me/requests/:id/live', async (c) => {
    const row = await myRequest(c); if (!row || row.doc.confirmedFriendId !== c.get('userId') || row.state !== 'Confirmed') return c.json({ error: 'only_during_accepted_visit' }, 409);
    const allowed = (await db.query<{ live_location_allowed: boolean }>(`select live_location_allowed from friend_profiles where user_id=$1`, [c.get('userId')]))[0]?.live_location_allowed;
    if (!allowed) return c.json({ error: 'turned_off_in_your_settings' }, 409);
    const { on } = z.object({ on: z.boolean() }).parse(await c.req.json());
    if (on) await db.query(`insert into live_location_sessions(id, request_id, friend_user_id, delete_after) values ($1,$2,$3,$4)`, [uid('ll'), row.id, c.get('userId'), new Date(now().getTime() + 24 * 3600000).toISOString()]);
    else await db.query(`update live_location_sessions set stopped_at=$3 where request_id=$1 and friend_user_id=$2 and stopped_at is null`, [row.id, c.get('userId'), now().toISOString()]);
    await audit(db, c.get('userId'), row.household_id, 'location.live.' + (on ? 'start' : 'stop'), { request: row.id }); return c.json({ ok: true });
  });

  /* Demo: friend WhatsApp threads for the simulator. */
  app.get('/demo/friend-thread/:uid', async (c) => x.d.demoMode ? c.json(await db.query(`select request_id, direction, body, buttons, at from friend_messages where friend_user_id=$1 order by at, id`, [c.req.param('uid')])) : c.json({ error: 'not_found' }, 404));
  app.post('/demo/llm', async (c) => { if (!x.d.demoMode) return c.json({ error: 'not_found' }, 404); A.llm.mode = z.object({ mode: z.enum(['ok', 'timeout', 'down', 'lowconf']) }).parse(await c.req.json()).mode; return c.json({ mode: A.llm.mode }); });
}
