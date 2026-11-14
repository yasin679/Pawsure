/**
 * Cover continuity service — PRD v1.4 section 7.7 and 9.6, PS-127 to PS-141.
 * Rules come from @pawsure/domain (state machine, reminder planner, at-risk evaluator, backup runner, Friend Finder gate,
 * urgency, pre-departure check, delay planner). This module persists state, sends messages through the mock adapters
 * (retry + SMS fallback via withFailover) and runs on the minute job. Every step is idempotent.
 */
import { createHash, randomBytes } from 'node:crypto';
import { uid, type Db } from '@pawsure/db';
import {
  COVER_V1, COVER_RULE, COVER_LABEL, coverConfig, coverTransition, CoverError, planReminder, reminderDeadline, nextBackupAction, jobMode,
  friendFinderOpen, friendFinderCutoff, notFoundOptions, circleCallDue, checklistReminderDue, preDepartureCheck, planDelay, splitExtension,
  thinCircle, coverMetrics, newRequest, reduce, isCantCome, parseSubstitute, clock, can,
  type CoverConfig, type CoverState, type CoverEvent, type BackupJob, type BackupContact, type Urgency, type CoverTaskView, type OwnerRoutineTask, type ExtensionReply
} from '@pawsure/domain';
import type { Deps } from './app.js';
import { audit, loadDay, ingestSignal, materialiseDay, ensureCover, type DayView } from './care.js';
import { istDate, minutesOnDay, atMinute } from './clock.js';
import { renderCover, renderReply, REMINDER_BUTTONS, YES_NO, EXT_BUTTONS, DAY_WORD, inScript } from './coverTemplates.js';
import type { Lang } from './templates.js';

type Task = DayView['tasks'][number];
export type JobState = 'await-owner' | 'asking' | 'hold' | 'ff' | 'notfound' | 'adhoc' | 'stopped' | 'covered' | 'owner' | 'moved' | 'skipped' | 'nocover' | 'closed';
export interface JobDoc extends BackupJob {
  id: string; householdId: string; careDate: string; taskIds: string[]; allTaskIds: string[]; reason: string; lostBy: string | null; state: JobState;
  nfAt: number | null; ack: number | null; circleCalled: boolean; circleAsked: boolean; ffSkipped: boolean; reqId: string | null;
  log: { at: number; text: string }[]; covered: { personId: string; at: number; taskIds: string[]; auto?: boolean; via?: string }[];
  part: string | null; coveredAt: number | null; adhoc: { personId: string; at: number } | null; noteRead: string[]; everNotFound: boolean;
}
export interface Person { id: string; kind: 'backup' | 'adhoc' | 'substitute'; name: string; first: string; phone: string; lang: Lang; holdsKey: boolean; meds: boolean; firstTime: boolean; ownerArranged: boolean; relationship: string; userId: string | null }
const ACTIVE: JobState[] = ['await-owner', 'asking', 'hold', 'ff', 'notfound', 'adhoc', 'stopped'];
export const jobActive = (j: JobDoc) => ACTIVE.includes(j.state);
const first = (n: string) => { const p = n.split(' '); return p[0] === 'Mrs' || p[0] === 'Mr' ? p.slice(0, 2).join(' ') : p[0]!; };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const isMed = (t: { type: string }) => t.type === 'medicine';
const KEY_TEXT: Record<string, string> = { helper: 'the helper will hand over the key', named_person: 'collect it from the named person', lockbox: 'use the lockbox (the owner sends the code)', owner_returns: 'the owner will be back to open the door' };

export function makeCover(d: Deps) {
  const { db } = d; const A = d.adapters; const now = () => d.clock.now();
  const today = () => istDate(now());
  const tomorrowOf = (date: string) => istDate(new Date(Date.parse(date + 'T12:00:00+05:30') + 86400000));
  const minOn = (date: string) => minutesOnDay(now(), date);
  const iso = (date: string, m: number) => atMinute(date, m).toISOString();
  const hooks: { onFriendFinder?: (hh: string, reqId: string) => Promise<void> } = {};

  /* ---------------- reads ---------------- */
  const household = async (hh: string) => (await db.query<{ id: string; tower: string | null; flat_private: string | null; standing_backup_approval: boolean; remind_trusted: boolean; hot_day: boolean; cover_config: Partial<CoverConfig> | null; cluster: string | null; out_from: number; out_to: number }>(`select id, tower, flat_private, standing_backup_approval, remind_trusted, hot_day, cover_config, cluster, out_from, out_to from households where id=$1`, [hh]))[0]!;
  const cfgOf = async (hh: string) => coverConfig((await household(hh)).cover_config);
  const ownerOf = async (hh: string) => (await db.query<{ name: string; phone: string; user_id: string }>(`select coalesce(u.display_name,'The owner') as name, u.phone_e164 as phone, u.id as user_id from memberships m join users u on u.id=m.user_id where m.household_id=$1 and m.role='owner' and m.status='active' limit 1`, [hh]))[0] ?? { name: 'The owner', phone: '', user_id: '' };
  const backups = async (hh: string) => db.query<{ id: string; user_id: string | null; name: string; phone_e164: string; language: string; rank: number; relationship: string; holds_key: boolean; can_give_medicine: boolean; owner_arranged: boolean; cared_before: boolean }>(`select * from backup_contact where household_id=$1 and removed_at is null order by rank`, [hh]);
  const contacts = async (hh: string): Promise<BackupContact[]> => (await backups(hh)).map(b => ({ id: b.id, rank: b.rank, holdsKey: b.holds_key, canGiveMedicine: b.can_give_medicine, ownerArranged: b.owner_arranged, firstTime: !b.cared_before }));
  async function person(hh: string, id: string): Promise<Person | null> {
    const b = (await db.query<Record<string, unknown>>(`select * from backup_contact where id=$1 and household_id=$2`, [id, hh]))[0];
    if (b) return { id, kind: 'backup', name: b.name as string, first: first(b.name as string), phone: b.phone_e164 as string, lang: b.language as Lang, holdsKey: !!b.holds_key, meds: !!b.can_give_medicine, firstTime: !b.cared_before, ownerArranged: !!b.owner_arranged, relationship: b.relationship as string, userId: (b.user_id as string) ?? null };
    const l = (await db.query<Record<string, unknown>>(`select * from task_links where id=$1 and household_id=$2`, [id, hh]))[0];
    if (l) return { id, kind: l.kind === 'substitute' ? 'substitute' : 'adhoc', name: l.name as string, first: first(l.name as string), phone: l.phone_e164 as string, lang: (l.language as Lang) ?? 'en', holdsKey: false, meds: l.kind === 'adhoc', firstTime: true, ownerArranged: false, relationship: l.kind === 'substitute' ? 'Named by ' + (l.proposed_by_name ?? 'the helper') : 'Asked by the owner for one task', userId: null };
    return null;
  }
  const canDo = (p: Pick<Person, 'meds'>, t: { type: string }) => !isMed(t) || p.meds;
  const petName = async (petId: string) => (await db.query<{ name: string; handling_note: string | null; medicines: string | null }>(`select name, handling_note, medicines from pets where id=$1`, [petId]))[0] ?? { name: 'your pet', handling_note: null, medicines: null };
  const titles = (ts: { title: string }[]) => ts.map(t => t.title).join(', ');

  /* ---------------- jobs ---------------- */
  const getJob = async (id: string, hh?: string) => (await db.query<{ doc: JobDoc }>(`select doc from cover_jobs where id=$1 ${hh ? 'and household_id=$2' : ''}`, hh ? [id, hh] : [id]))[0]?.doc;
  const saveJob = (j: JobDoc) => db.query(`insert into cover_jobs(id, household_id, care_date, state, doc) values ($1,$2,$3,$4,$5) on conflict (id) do update set state=$4, doc=$5, updated_at=now()`, [j.id, j.householdId, j.careDate, j.state, JSON.stringify(j)]);
  const jobsOn = async (hh: string, dates?: string[]) => (await db.query<{ doc: JobDoc }>(`select doc from cover_jobs where household_id=$1 ${dates ? 'and care_date = any($2)' : ''} order by created_at`, dates ? [hh, dates] : [hh])).map(r => r.doc);
  const log = (j: JobDoc, at: number, text: string) => { j.log.push({ at, text }); };

  /* ---------------- task cover writes (through the pure state machine) ---------------- */
  async function coverRow(taskId: string) { return (await db.query<{ state: CoverState; household_id: string }>(`select state, household_id from task_cover where task_id=$1`, [taskId]))[0]; }
  async function moveCover(t: Pick<Task, 'id' | 'due' | 'urgency'> & { careDate: string }, ev: CoverEvent, actor: string, patch: Record<string, unknown> = {}, note?: string): Promise<CoverState | null> {
    const cur = await coverRow(t.id); if (!cur) return null;
    const cfg = await cfgOf(cur.household_id);
    let next: CoverState;
    try { next = coverTransition(cur.state, ev, { friendFinderOpen: friendFinderOpen(minOn(t.careDate), t.due, cfg), urgency: t.urgency }).state; } catch (e) { if (e instanceof CoverError) return null; throw e; }
    const cols = { state: next, ...patch }; const keys = Object.keys(cols);
    await db.query(`update task_cover set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() where task_id=$1`, [t.id, ...keys.map(k => (cols as Record<string, unknown>)[k])]);
    await db.query(`insert into task_cover_event(task_id, household_id, event, state, reason, actor, note, event_time) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [t.id, cur.household_id, ev, next, (patch.reason as string) ?? null, actor, note ?? null, now().toISOString()]);
    await audit(db, actor, cur.household_id, 'cover.' + ev, { task: t.id, from: cur.state, to: next, note });
    return next;
  }
  const dayTasks = async (hh: string, date: string) => (await loadDay(db, hh, date, now())).tasks.map(t => ({ ...t, careDate: date }));
  const tasksById = async (hh: string, date: string, ids: string[]) => (await dayTasks(hh, date)).filter(t => ids.includes(t.id));
  const done = (t: Task) => ['Confirmed', 'Likely', 'Matched'].includes(t.ev.state);

  /* ---------------- messaging ---------------- */
  const ownerPush = (hh: string, title: string, body: string) => A.push.push('owner:' + hh, title, body);
  async function ownerOnce(hh: string, key: string, title: string, body: string) {
    const ins = await db.query(`insert into notifications(id, household_id, dedupe_key, recipient, channel, template, payload) values ($1,$2,$3,'owner','push',$4,$5) on conflict (dedupe_key) do nothing returning id`, [uid('ntf'), hh, key, title, JSON.stringify({ body })]);
    if (ins.length) await ownerPush(hh, title, body);
    return ins.length > 0;
  }
  async function sayTo(hh: string, p: Person, template: string | null, body: string, gloss: string | null, buttons?: { id: string; label: string }[], jobId?: string | null, vars: Record<string, string> = {}) {
    await A.whatsapp.sendTemplate(p.phone, template ?? 'session_reply', p.lang, vars);
    await db.query(`insert into cover_messages(id, household_id, person_kind, person_id, direction, template, language, body, gloss, buttons, job_id, at) values ($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,$10,$11)`, [uid('cm'), hh, p.kind, p.id, template, p.lang, body, p.lang === 'en' ? null : gloss, buttons ? JSON.stringify(buttons) : null, jobId ?? null, now().toISOString()]);
  }
  const reply = (hh: string, p: Person, key: string, v: Record<string, string> = {}, jobId?: string | null, buttons?: { id: string; label: string }[]) => sayTo(hh, p, null, renderReply(key, p.lang, v), renderReply(key, 'en', v), buttons, jobId);
  async function helperOf(mid: string) { return (await db.query<{ phone: string; lang: Lang; name: string; household_id: string; paused: boolean; status: string }>(`select u.phone_e164 as phone, coalesce(m.invite_language, u.language, 'en') as lang, coalesce(m.display_label, u.display_name, 'Helper') as name, m.household_id, m.paused, m.status from memberships m join users u on u.id=m.user_id where m.id=$1`, [mid]))[0]; }
  async function helperMsg(hh: string, mid: string, template: string | null, body: string, gloss: string | null, buttons?: { id: string; label: string }[], vars: Record<string, string> = {}) {
    const h = await helperOf(mid); if (!h) return;
    await A.whatsapp.sendTemplate(h.phone, template ?? 'session_reply', h.lang, vars);
    await db.query(`insert into helper_messages(id, household_id, membership_id, direction, template, body, gloss, buttons, at) values ($1,$2,$3,'out',$4,$5,$6,$7,$8)`, [uid('hm'), hh, mid, template, body, h.lang === 'en' ? null : gloss, buttons ? JSON.stringify(buttons) : null, now().toISOString()]);
  }
  const helperReply = async (hh: string, mid: string, key: string, v: Record<string, string> = {}) => { const h = await helperOf(mid); if (h) await helperMsg(hh, mid, null, renderReply(key, h.lang, v), renderReply(key, 'en', v)); };
  const helperConsented = async (mid: string) => { const c = (await db.query<{ granted: boolean; kind: string }>(`select c.granted, c.kind from consent_records c join memberships m on m.user_id=c.user_id and m.household_id=c.household_id where m.id=$1 and c.kind in ('helper_monitoring','helper_withdrawal') order by c.recorded_at desc limit 1`, [mid]))[0]; return !!c?.granted && c.kind !== 'helper_withdrawal'; };
  const dayState = async (hh: string, date: string) => (await db.query<{ mode: string; helper_unavailable: boolean; return_at: number | null; left_at: string | null; no_cover_planned: boolean; plan_b: string | null }>(`select * from day_states where household_id=$1 and care_date=$2`, [hh, date]))[0];

  /* ================= PS-127 reminders ================= */
  interface Group { key: string; kind: 'helper' | 'co_owner' | 'backup'; personId: string; tasks: (Task & { careDate: string })[]; first: number; confirmedAt: number | null }
  function groups(ts: (Task & { careDate: string })[]): Group[] {
    const g = new Map<string, Group>();
    for (const t of ts) {
      const c = t.cover; if (!c || t.ev.state === 'Cancelled' || t.reassignedToTaskId) continue;
      const kind = c.personKind; if (kind !== 'helper' && kind !== 'co_owner' && kind !== 'backup') continue;
      if (!['Assigned', 'ConfirmedByCaregiver', 'CoveredByReplacement'].includes(c.state) || c.lostBy) continue;
      const key = (t.visitId ?? t.id) + '|' + c.personId;
      const x = g.get(key) ?? { key, kind, personId: c.personId!, tasks: [], first: Infinity, confirmedAt: null };
      x.tasks.push(t); x.first = Math.min(x.first, t.due); if (c.confirmedAt != null) x.confirmedAt = Math.max(x.confirmedAt ?? -1e9, c.confirmedAt);
      g.set(key, x);
    }
    return [...g.values()];
  }
  async function advisoryFor(hh: string, date: string) {
    const h = await household(hh);
    const a = (await db.query<{ remind_at: string }>(`select remind_at from cluster_advisory where for_date=$1 and (cluster=$2 or cluster='All clusters') and remind_at <= $3 order by remind_at limit 1`, [date, h.cluster ?? '', now().toISOString()]))[0];
    return a ? minutesOnDay(new Date(a.remind_at), date) : null;
  }
  /**
   * Cheap check before rebuilding the day: is any reminder due to be sent, or any sent reminder waiting for a reply?
   * Keeps the minute job light for homes where nothing is happening (load test: 200 homes at the evening peak).
   */
  async function remindersMayBeDue(hh: string, date: string, nowM: number, cfg: CoverConfig, adv: number | null) {
    if (adv != null) return true;
    await materialiseDay(db, hh, date); await ensureCover(db, hh, date, now()); // picks up routine tasks added today (idempotent inserts)
    if ((await db.query(`select 1 from reminder where household_id=$1 and care_date=$2 and reply is null limit 1`, [hh, date])).length) return true;
    const eveningAt = cfg.eveningReminderAt - 1440;
    return (await db.query(`select 1 from task_cover c join care_tasks t on t.id=c.task_id
      where t.household_id=$1 and t.care_date=$2 and c.state in ('Assigned','CoveredByReplacement') and c.lost_by is null
        and ((t.due_minute >= $5 and t.due_minute - $3 <= $4 and $4 < t.due_minute - $6) or (t.due_minute < $5 and $4 >= $7 and $4 < $7 + $8))
        and not exists (select 1 from reminder r where r.household_id=$1 and r.care_date=$2 and r.visit_key = coalesce(t.visit_id, t.id) || '|' || coalesce(c.person_id, ''))
      limit 1`, [hh, date, cfg.reminderLeadMin, nowM, cfg.earlyTaskBefore, cfg.confirmDeadlineMin, eveningAt, cfg.eveningDeadlineMin])).length > 0;
  }
  async function runReminders(hh: string, date: string) {
    const nowM = minOn(date), cfg = await cfgOf(hh), adv = await advisoryFor(hh, date);
    if (!(await remindersMayBeDue(hh, date, nowM, cfg, adv))) return [];
    const h = await household(hh), ds = await dayState(hh, date);
    const sent: string[] = [];
    for (const g of groups(await dayTasks(hh, date))) {
      const existing = (await db.query<{ id: string; reply: string | null; deadline_at: string; sent_at: string }>(`select id, reply, deadline_at, sent_at from reminder where household_id=$1 and care_date=$2 and visit_key=$3`, [hh, date, g.key]))[0];
      if (!existing) {
        if (!g.tasks.some(t => t.cover!.state === 'Assigned' || (g.kind === 'backup' && t.cover!.state === 'CoveredByReplacement'))) continue;
        const reachable = g.kind === 'helper' ? (await helperOf(g.personId))?.status === 'active' && !(await helperOf(g.personId))?.paused && await helperConsented(g.personId) : true;
        const plan = planReminder({ firstDue: g.first, assignee: g.kind, reachable, trustedMode: ds?.mode === 'trusted', remindTrusted: h.remind_trusted, helperUnavailable: g.kind === 'helper' && !!ds?.helper_unavailable, advisoryAt: adv, confirmedAt: g.kind === 'backup' ? g.confirmedAt : null }, cfg);
        // Sent from its time until its reply deadline. A run that wakes up later (the demo clock jumping ahead) sends nothing late.
        if (!plan.send || nowM < plan.at || nowM >= plan.deadline || nowM >= g.first) continue;
        const deadline = g.kind === 'backup' ? g.first : reminderDeadline(plan, nowM, g.first, cfg);
        const id = uid('rem');
        const ins = await db.query(`insert into reminder(id, household_id, care_date, visit_key, recipient_kind, recipient_id, channel, sent_at, deadline_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`, [id, hh, date, g.key, g.kind, g.personId, g.kind === 'co_owner' ? 'app' : 'whatsapp', now().toISOString(), iso(date, deadline)]);
        if (!ins.length) continue;
        await sendReminder(hh, date, id, g, plan.why);
        for (const t of g.tasks) await db.query(`insert into task_cover_event(task_id, household_id, event, state, actor, note, event_time) values ($1,$2,'reminder_sent',$3,'system',$4,$5)`, [t.id, hh, t.cover!.state, `Reminder to ${g.kind} (${plan.why})`, now().toISOString()]);
        sent.push('reminder:' + g.key);
      } else if (!existing.reply && nowM >= minutesOnDay(new Date(existing.deadline_at), date)) {
        await db.query(`update reminder set reply='noreply' where id=$1 and reply is null`, [existing.id]);
        if (g.kind === 'backup') continue; // a replacement who said yes is not put at risk by silence
        const ts = g.tasks.filter(t => t.cover!.state === 'Assigned');
        const who = g.kind === 'helper' ? (await helperOf(g.personId))?.name ?? 'the helper' : 'Rohan';
        if (ts.length) await atRisk(hh, date, ts.map(t => t.id), `No reply from ${first(who)} to the reminder by ${clock(minutesOnDay(new Date(existing.deadline_at), date))}`, null, 'no_reply', g.personId);
        sent.push('noreply:' + g.key);
      }
    }
    return sent;
  }
  async function sendReminder(hh: string, date: string, remId: string, g: Group, why: string) {
    const day = date === today() ? 0 : 1, whatEn = titles(g.tasks), pets = [...new Set(await Promise.all(g.tasks.map(async t => (await petName(t.petId)).name)))].join(' & ');
    if (g.kind === 'helper') {
      const h = (await helperOf(g.personId))!, l = h.lang, v = { name: inScript(l, first(h.name)), day: DAY_WORD[l][day]!, time: clock(g.first).replace(/ (AM|PM)$/, l === 'en' ? ' $1' : ''), pets: inScript(l, pets), tasks: whatEn };
      const btns = REMINDER_BUTTONS[l].map((label, i) => ({ id: `cover_${['yes', 'cant', 'sub'][i]}:${remId}`, label: label + (l === 'en' ? '' : ` (${REMINDER_BUTTONS.en[i]})`) }));
      await helperMsg(hh, g.personId, 'cover_reminder', renderCover('cover_reminder', l, v), renderCover('cover_reminder', 'en', { ...v, name: first(h.name), pets, day: DAY_WORD.en[day]!, time: clock(g.first) }) + ' · Yes, I’ll do it · Can’t make it · Send someone else', btns, v);
    } else if (g.kind === 'co_owner') {
      await ownerPush(hh, 'Reminder for Rohan', `${whatEn} at ${clock(g.first)}: please confirm in the app.`);
      await A.push.push(g.personId, 'Can you do it?', `You’re down for ${whatEn} at ${clock(g.first)} (${DAY_WORD.en[day]}). Yes / Can’t make it.`);
    } else {
      const p = (await person(hh, g.personId))!;
      const v = { name: p.first, day: DAY_WORD[p.lang][day]!, time: clock(g.first), pets, tasks: whatEn };
      await sayTo(hh, p, 'cover_reminder', renderCover('cover_reminder', p.lang, v), renderCover('cover_reminder', 'en', { ...v, day: DAY_WORD.en[day]! }), [{ id: `cr_yes:${remId}`, label: REMINDER_BUTTONS[p.lang][0] }, { id: `cr_cant:${remId}`, label: REMINDER_BUTTONS[p.lang][1] }], null, v);
    }
    await audit(db, 'system', hh, 'cover.reminder.sent', { reminder: remId, to: g.kind, tasks: g.tasks.map(t => t.id), why });
  }
  /** A reply to a reminder: buttons, IVR 1/2/3, the app (co-owner) or free text. Idempotent: only the first reply counts. */
  async function reminderReply(remId: string, kind: 'yes' | 'cant' | 'sub', channel: string, sub?: { name: string; phone: string }) {
    const r = (await db.query<{ id: string; household_id: string; care_date: string; visit_key: string; recipient_kind: string; recipient_id: string; reply: string | null }>(`select id, household_id, care_date::text as care_date, visit_key, recipient_kind, recipient_id, reply from reminder where id=$1`, [remId]))[0];
    if (!r) return { status: 'unknown_reminder' };
    if (r.reply && r.reply !== 'noreply' && !(r.reply === 'substitute' && kind === 'sub' && sub)) return { status: 'already_replied', reply: r.reply };
    const hh = r.household_id, date = r.care_date;
    const ts = (await dayTasks(hh, date)).filter(t => (t.visitId ?? t.id) + '|' + r.recipient_id === r.visit_key && t.cover && t.ev.state !== 'Cancelled' && !t.reassignedToTaskId);
    await db.query(`update reminder set reply=$2, reply_at=$3, reply_channel=$4 where id=$1`, [remId, kind === 'sub' ? 'substitute' : kind, now().toISOString(), channel]);
    if (kind === 'yes') {
      for (const t of ts) {
        const j = t.cover!.jobId ? await getJob(t.cover!.jobId) : null;
        if (j && j.state === 'hold') continue; // someone already offered; the owner is confirming
        const ev: CoverEvent = t.cover!.state === 'Assigned' || t.cover!.state === 'Extended' ? 'caregiver_yes' : 'late_yes';
        if (t.cover!.state === 'CoveredByReplacement' || t.cover!.state === 'ConfirmedByCaregiver') continue;
        await moveCover(t, ev, r.recipient_kind + ':' + r.recipient_id, { confirmed_at: now().toISOString(), lost_by: null, reason: null }, `Replied Yes (${channel}). A Yes is not evidence.`);
        if (j && jobActive(j)) await closeJob(j, minOn(date), 'closed', 'The caregiver confirmed after all');
      }
      if (r.recipient_kind === 'helper') await helperReply(hh, r.recipient_id, 'thanks_yes');
      await ownerOnce(hh, 'remyes:' + remId, 'Confirmed', `${ts.length ? titles(ts) : 'The visit'}: confirmed by the caregiver.`);
      return { status: 'confirmed' };
    }
    if (kind === 'sub') {
      if (!sub) { await helperReply(hh, r.recipient_id, 'who_will_come'); return { status: 'awaiting_name' }; }
      await proposeSubstitute(hh, date, r.recipient_id, r.visit_key, sub.name, sub.phone);
      return { status: 'substitute_proposed' };
    }
    const who = r.recipient_kind === 'helper' ? first((await helperOf(r.recipient_id))?.name ?? 'The helper') : r.recipient_kind === 'backup' ? (await person(hh, r.recipient_id))?.first ?? 'The backup' : 'Rohan';
    await atRisk(hh, date, ts.map(t => t.id), `${who} can’t make it (${channel})`, r.recipient_id, ts.some(t => t.cover!.state === 'CoveredByReplacement') ? 'replacement_cant' : 'caregiver_cant');
    return { status: 'at_risk' };
  }

  /* ================= PS-128 / PS-129 at risk ================= */
  async function atRisk(hh: string, date: string, taskIds: string[], reason: string, lostBy: string | null, ev: CoverEvent, noReplyFrom?: string, opts: { mode?: BackupJob['mode']; part?: string; manualOnly?: boolean } = {}) {
    const nowM = minOn(date);
    const all = await tasksById(hh, date, taskIds);
    const ts = [] as typeof all;
    for (const t of all) {
      if (done(t) || t.ev.state === 'Cancelled' || t.reassignedToTaskId || t.due <= nowM - 30) continue;
      const j = t.cover?.jobId ? await getJob(t.cover.jobId) : null; if (j && jobActive(j)) continue;
      const nx = await moveCover(t, ev, lostBy ? 'caregiver:' + lostBy : 'system', { reason, lost_by: lostBy, handled_pre: true }, reason);
      if (nx) ts.push(t);
    }
    if (!ts.length) return null;
    const firstDue = Math.min(...ts.map(t => t.due)), pet = (await petName(ts[0]!.petId)).name;
    if (lostBy) {
      await audit(db, 'system', hh, 'access.revoked', { person: lostBy, tasks: ts.map(t => t.id), note: 'task access removed; owner told within 30 s' });
      await db.query(`update visit_access_checklist set ticked_at=null where task_id = any($1)`, [ts.map(t => t.id)]);
      if (ev === 'caregiver_cant' && (await helperOf(lostBy))) await helperMsg(hh, lostBy, 'cover_cant_come_ack', renderCover('cover_cant_come_ack', (await helperOf(lostBy))!.lang), renderCover('cover_cant_come_ack', 'en'));
    }
    if (opts.manualOnly) return null;
    const h = await household(hh), cfg = await cfgOf(hh);
    const next = !h.standing_backup_approval ? 'Tap to ask your backups.' : firstDue - nowM > cfg.wideAskAfterMin ? 'Your backups are being asked together (60-minute window).' : 'Your backups are being asked, two at a time.';
    await ownerPush(hh, 'At risk', `${pet} · ${titles(ts)} (${clock(firstDue)}) is at risk: ${reason}. ${next}`);
    return startJob(hh, date, ts.map(t => t.id), reason, lostBy, opts);
  }
  async function startJob(hh: string, date: string, taskIds: string[], reason: string, lostBy: string | null, opts: { mode?: BackupJob['mode']; part?: string; ownerSent?: boolean } = {}) {
    const nowM = minOn(date), ts = await tasksById(hh, date, taskIds), cfg = await cfgOf(hh), h = await household(hh), ds = await dayState(hh, date);
    const firstDue = Math.min(...ts.map(t => t.due)), outTo = ds?.return_at ?? h.out_to, outFrom = h.out_from;
    const j: JobDoc = {
      id: uid('cj'), householdId: hh, careDate: date, taskIds: ts.map(t => t.id), allTaskIds: ts.map(t => t.id), reason, lostBy, state: 'asking',
      mode: opts.mode ?? jobMode(nowM, firstDue, cfg), startedAt: nowM, firstDue, needsAccess: ts.some(t => t.due >= outFrom && t.due < outTo), medicineOnly: ts.every(isMed),
      urgencies: ts.map(t => t.urgency), standingApproval: h.standing_backup_approval, ownerSent: !!opts.ownerSent, asks: [], round: 0, roundAt: null, hold: null,
      excluded: lostBy ? [lostBy] : [], nfAt: null, ack: null, circleCalled: false, circleAsked: false, ffSkipped: false, reqId: null, log: [{ at: nowM, text: 'At risk: ' + reason }],
      covered: [], part: opts.part ?? null, coveredAt: null, adhoc: null, noteRead: [], everNotFound: false
    };
    await db.query(`update task_cover set job_id=$2 where task_id = any($1)`, [j.taskIds, j.id]);
    await runJob(j, nowM); await saveJob(j);
    return j;
  }
  /** Apply domain actions until the runner says wait (PS-130). */
  async function runJob(j: JobDoc, nowM: number) {
    const hh = j.householdId, cfg = await cfgOf(hh);
    for (let guard = 0; guard < 20; guard++) {
      if (!['asking', 'hold', 'await-owner'].includes(j.state)) return;
      const a = nextBackupAction(j, await contacts(hh), nowM, cfg);
      if (a.kind === 'wait') return;
      if (a.kind === 'owner_must_send') { if (j.state !== 'await-owner') { j.state = 'await-owner'; log(j, nowM, '“Ask my backups automatically” is off. Waiting for your one tap.'); } return; }
      if (a.kind === 'ask') {
        const ts = await tasksById(hh, j.careDate, j.taskIds);
        for (const pid of a.personIds) { j.asks.push({ personId: pid, round: a.round, at: nowM, state: 'asked' }); await askPerson(j, pid, ts); }
        j.round = a.round; j.roundAt = nowM; j.state = 'asking'; if (j.mode === 'circle') j.circleRound = a.round;
        const names = (await Promise.all(a.personIds.map(async id => (await person(hh, id))?.first ?? id))).join(' and ');
        log(j, nowM, `Asked ${names} (${j.mode === 'circle' ? 'whole care circle at once, 10 min' : j.mode === 'wide' ? 'together, 60-minute window' : `pair ${a.round}, 10 min${j.needsAccess ? ', key holders first' : ''}`})`);
        for (const t of ts) await moveCover(t, 'backups_asked', 'system', {}, 'Asking ' + names);
        continue;
      }
      if (a.kind === 'close_round') { for (const x of j.asks) if (a.personIds.includes(x.personId) && x.state === 'asked') { x.state = 'noreply'; const p = await person(hh, x.personId); if (p) await reply(hh, p, 'closed', {}, j.id); } log(j, nowM, 'No yes from ' + (await Promise.all(a.personIds.map(async id => (await person(hh, id))?.first ?? id))).join(' and ') + ` in ${j.mode === 'wide' ? cfg.wideWindowMin : cfg.pairWindowMin} min`); continue; }
      if (a.kind === 'hold_remind') { j.hold!.reminded = true; await ownerPush(hh, 'Confirm cover', `${(await person(hh, a.personId))?.first} is waiting for you to confirm (hold ends in ${cfg.holdMin - cfg.holdReminderMin} min).`); continue; }
      if (a.kind === 'auto_confirm') { await confirm(j, a.personId, nowM, true); continue; }
      if (a.kind === 'release_hold') { await releaseHold(j, nowM); continue; }
      if (a.kind === 'exhausted') { await afterBackups(j, nowM, a.friendFinder); return; }
    }
  }
  async function askPerson(j: JobDoc, pid: string, ts: Task[]) {
    const hh = j.householdId, p = await person(hh, pid); if (!p) return;
    const mine = ts.filter(t => canDo(p, t)), pet = await petName(mine[0]?.petId ?? ts[0]!.petId), o = await ownerOf(hh), h = await household(hh), day = j.careDate === today() ? 0 : 1;
    const v = { name: p.first, owner: first(o.name), tower: h.tower ?? '', day: DAY_WORD[p.lang][day]!, time: clock(j.firstDue), pet: pet.name, tasks: titles(mine), note: p.firstTime ? (pet.handling_note ?? '') : '' };
    const btns = [{ id: `cb_yes:${j.id}`, label: YES_NO[p.lang][0] }, { id: `cb_no:${j.id}`, label: YES_NO[p.lang][1] }, ...(p.firstTime && pet.handling_note ? [{ id: `cb_read:${j.id}`, label: YES_NO[p.lang][2] }] : [])];
    await sayTo(hh, p, 'cover_backup_request', renderCover('cover_backup_request', p.lang, v), renderCover('cover_backup_request', 'en', { ...v, day: DAY_WORD.en[day]! }), btns, j.id, v);
    await audit(db, j.standingApproval && !j.ownerSent ? 'system (standing approval)' : 'owner', hh, 'cover.ask.sent', { job: j.id, to: p.kind, person: pid, approval: j.standingApproval && !j.ownerSent ? 'standing' : 'owner_tap' });
  }
  async function afterBackups(j: JobDoc, nowM: number, ffOpen: boolean) {
    const hh = j.householdId, ts = await tasksById(hh, j.careDate, j.taskIds);
    if (ffOpen && !j.circleAsked) {
      j.state = 'ff'; log(j, nowM, `No backup said yes. Friend Finder is open until ${clock(friendFinderCutoff(j.firstDue))} and needs your approval.`);
      for (const t of ts) await moveCover(t, 'backups_exhausted', 'system', {}, 'No backup said yes');
      await ownerOnce(hh, 'ff:' + j.id, 'Find a friend?', `No backup can do ${titles(ts)}. Friend Finder is open until ${clock(friendFinderCutoff(j.firstDue))}.`);
      return;
    }
    if (!ffOpen) { j.ffSkipped = true; log(j, nowM, `Friend Finder skipped: too close to the task (the search closes 30 min before, at ${clock(friendFinderCutoff(j.firstDue))})`); }
    await notFound(j, nowM);
  }
  /** PS-133: message + automated call with the task, who was asked, last fed or watered, and the options. */
  async function notFound(j: JobDoc, nowM: number) {
    const hh = j.householdId, ts = await tasksById(hh, j.careDate, j.taskIds);
    j.state = 'notfound'; j.everNotFound = true; if (j.nfAt == null) j.nfAt = nowM;
    for (const t of ts) { if (t.cover?.state === 'CoverNotFound') continue; const ev: CoverEvent = t.cover?.state === 'FriendFinder' ? 'friend_finder_ended' : 'backups_exhausted'; await moveCover(t, ev, 'system', {}, 'Cover not found'); if ((await coverRow(t.id))?.state !== 'CoverNotFound') await moveCover(t, 'backups_exhausted', 'system'); }
    const asked = [...new Set(await Promise.all(j.asks.map(async a => (await person(hh, a.personId))?.first ?? a.personId)))].join(', ') || 'nobody yet';
    const last = await lastCare(hh, j.careDate, ts[0]!.petId), pet = (await petName(ts[0]!.petId)).name, o = await ownerOf(hh), canMove = !ts.some(t => t.urgency === 'MustHappen');
    log(j, nowM, 'Cover not found. You were sent a message and an automated call with the options.');
    const v = { pet, tasks: titles(ts), time: clock(j.firstDue), asked, last, move: canMove ? '1' : '0' };
    if (await ownerOnce(hh, 'nf:' + j.id, 'Cover not found', renderCover('cover_not_found_owner', 'en', v))) {
      if (o.phone) await A.voice.call(o.phone, renderCover('cover_not_found_owner', 'en', v) + ' Press 1 for I’ll handle it.');
      await audit(db, 'system', hh, 'cover.not_found', { job: j.id, asked, call: true });
    }
  }
  async function lastCare(hh: string, date: string, petId: string) {
    const ts = (await dayTasks(hh, date)).filter(t => t.petId === petId && done(t));
    const at = (re: RegExp) => { const xs = ts.filter(t => re.test(t.title + ' ' + t.type)).map(t => t.signals.length ? Math.max(...t.signals.map(s => s.eventTime)) : t.returnCheck?.at ?? null).filter((x): x is number => x != null); return xs.length ? Math.max(...xs) : null; };
    const f = at(/feed|lunch|dinner|food|breakfast|litter/i), w = at(/water/i);
    return `Last fed: ${f != null ? clock(f) + ' (from evidence)' : 'no evidence today'} · last water: ${w != null ? clock(w) + ' (from evidence)' : 'no evidence today'}`;
  }
  async function closeJob(j: JobDoc, nowM: number, state: JobState, note: string) {
    for (const a of j.asks) if (['asked', 'waiting', 'yes'].includes(a.state)) { a.state = 'closed'; const p = await person(j.householdId, a.personId); if (p) await reply(j.householdId, p, 'closed', {}, j.id); }
    if (j.adhoc) await db.query(`update task_links set revoked_at=$2 where id=$1 and approved_at is null and revoked_at is null`, [j.adhoc.personId, now().toISOString()]);
    j.state = state; j.hold = null; if (j.ack == null) j.ack = nowM; log(j, nowM, note);
    await saveJob(j);
  }

  /* ================= replies from backups and ad-hoc numbers ================= */
  async function coverReply(jobId: string, pid: string, kind: 'yes' | 'no' | 'read', channel: string) {
    const j = await getJob(jobId); if (!j) return { status: 'unknown_job' };
    const hh = j.householdId, p = await person(hh, pid); if (!p) return { status: 'unknown_person' };
    const nowM = minOn(j.careDate), pet = (await petName((await tasksById(hh, j.careDate, j.allTaskIds))[0]!.petId));
    await db.query(`insert into cover_messages(id, household_id, person_kind, person_id, direction, body, job_id, at) values ($1,$2,$3,$4,'in',$5,$6,$7)`, [uid('cm'), hh, p.kind, p.id, kind === 'read' ? 'I have read this' : kind === 'yes' ? 'Yes' : 'No', j.id, now().toISOString()]);
    if (kind === 'read') { if (!j.noteRead.includes(pid)) j.noteRead.push(pid); log(j, nowM, `${p.first} read the handling note`); await saveJob(j); await reply(hh, p, 'note_ok', {}, j.id); return { status: 'note_read' }; }
    const a = [...j.asks].reverse().find(x => x.personId === pid);
    if (!a || a.state !== 'asked' || !['asking', 'hold', 'adhoc'].includes(j.state)) { await reply(hh, p, 'already', {}, j.id); return { status: 'late' }; }
    if (kind === 'yes' && p.firstTime && pet.handling_note && !j.noteRead.includes(pid)) { await reply(hh, p, 'read_first', { pet: pet.name }, j.id); return { status: 'needs_note' }; }
    const o = first((await ownerOf(hh)).name);
    if (kind === 'no') {
      a.state = 'no'; await reply(hh, p, 'no_problem', {}, j.id); log(j, nowM, `${p.first} said no`);
      if (j.state === 'adhoc') { j.state = 'notfound'; } else await runJob(j, nowM);
      await saveJob(j); return { status: 'no' };
    }
    if (j.hold) { a.state = 'waiting'; await reply(hh, p, 'someone_first', { owner: o }, j.id); log(j, nowM, `${p.first} also said yes (waiting, no double cover)`); await saveJob(j); return { status: 'waiting' }; }
    a.state = 'yes'; j.hold = { personId: pid, at: nowM, reminded: false, preApproved: p.kind === 'backup' }; j.state = 'hold';
    if (p.kind === 'adhoc') await db.query(`update task_links set accepted_at=$2, note_read_at=coalesce(note_read_at,$2) where id=$1`, [pid, now().toISOString()]);
    await reply(hh, p, 'hold_wait', { owner: o }, j.id);
    const ts = await tasksById(hh, j.careDate, j.taskIds), must = j.urgencies.includes('MustHappen') && p.kind === 'backup';
    log(j, nowM, `${p.first} said yes. 10-minute hold for your confirmation${must ? ` (confirmed automatically at ${clock(nowM + 10)}: must-happen task, pre-approved backup)` : ''}`);
    await ownerPush(hh, 'Someone can cover', `${p.first} can cover ${titles(ts.filter(t => canDo(p, t)))}. Confirm to share gate and key details.`);
    await saveJob(j); return { status: 'hold' };
  }
  async function confirm(j: JobDoc, pid: string, nowM: number, auto: boolean) {
    const hh = j.householdId, p = (await person(hh, pid))!, ts = await tasksById(hh, j.careDate, j.taskIds);
    const mine = ts.filter(t => canDo(p, t)), rest = ts.filter(t => !canDo(p, t)), h = await household(hh), o = await ownerOf(hh), pet = await petName(mine[0]!.petId), day = j.careDate === today() ? 0 : 1;
    for (const t of mine) {
      await moveCover(t, 'replacement_confirmed', auto ? 'system (standing approval)' : 'owner', { person_kind: p.kind, person_id: p.id, person_name: p.name, confirmed_at: now().toISOString(), lost_by: null }, `${p.first} replaces the caregiver${auto ? ' · confirmed automatically (must-happen task, pre-approved backup, no answer in the 10-minute hold)' : ' · you confirmed'}${p.ownerArranged ? ' · owner-arranged, not verified by Pawsure' : ''}`);
      if (p.firstTime) await db.query(`insert into visit_access_checklist(task_id, household_id, person_name, key_plan, key_note) values ($1,$2,$3,$4,$5) on conflict (task_id) do update set person_name=$3, gate_approved=false, key_plan=$4, key_note=$5, ticked_at=null, reminded_at=null`, [t.id, hh, p.name, p.holdsKey ? 'named_person' : null, p.holdsKey ? `${p.first} holds a key` : null]);
    }
    const instructions = (await db.query<{ instructions: string | null }>(`select r.instructions from care_tasks t left join routine_tasks r on r.id=t.routine_task_id where t.id = any($1)`, [mine.map(t => t.id)])).map(r => r.instructions).filter(Boolean).join(' ');
    const v = { day: DAY_WORD[p.lang][day]!, time: clock(Math.min(...mine.map(t => t.due))), tasks: titles(mine), flat: h.flat_private ?? '', tower: h.tower ?? '', gate: `${first(o.name)} will approve you in the gate app before you arrive.`, key: p.holdsKey ? 'you already hold a key.' : `${first(o.name)} will tell you the key plan.`, pet: pet.name, instructions: instructions || 'See the task.', note: pet.handling_note ?? '' };
    if (p.kind === 'adhoc') await db.query(`update task_links set approved_at=$2, expires_at=$3 where id=$1`, [p.id, now().toISOString(), iso(j.careDate, j.firstDue + 120)]);
    else await sayTo(hh, p, 'cover_gate_key_note', renderCover('cover_gate_key_note', p.lang, v), renderCover('cover_gate_key_note', 'en', { ...v, day: DAY_WORD.en[day]! }), [{ id: `cb_done:${j.id}`, label: '📷 Done' }, { id: `cb_cant:${j.id}`, label: 'Can’t make it' }], j.id, v);
    await audit(db, auto ? 'system (standing approval)' : 'owner', hh, 'access.disclosed', { job: j.id, to: p.kind, person: p.id, fields: ['flat', 'tower', 'gate_note', 'key_note', 'pet_care', 'handling_note'] });
    const a = j.asks.find(x => x.personId === pid && ['yes', 'asked'].includes(x.state)); if (a) a.state = 'confirmed';
    j.covered.push({ personId: pid, at: nowM, taskIds: mine.map(t => t.id), auto }); j.hold = null; j.coveredAt = nowM;
    await ownerPush(hh, 'Covered', `${p.first} is covering ${titles(mine)}${auto ? ' (confirmed automatically)' : ''}.${p.firstTime ? ' Finish the gate and key checklist on Today.' : ''}`);
    if (rest.length) {
      j.taskIds = rest.map(t => t.id); j.medicineOnly = rest.every(isMed); j.urgencies = rest.map(t => t.urgency);
      for (const x of j.asks) if (['asked', 'waiting'].includes(x.state)) { x.state = 'closed'; const q = await person(hh, x.personId); if (q) await reply(hh, q, 'closed', {}, j.id); }
      log(j, nowM, `${p.first} covers ${titles(mine)}. Still looking for: ${titles(rest)} (medicine only goes to people you marked for it)`);
      j.state = 'asking'; j.roundAt = nowM; await runJob(j, nowM);
    } else { await closeJob(j, nowM, 'covered', `${p.first} confirmed${auto ? ' automatically' : ' by you'}`); }
    await db.query(`update backup_contact set cared_before=true where id=$1`, [pid]).catch(() => undefined);
  }
  async function releaseHold(j: JobDoc, nowM: number) {
    const hh = j.householdId, pid = j.hold!.personId, p = await person(hh, pid), a = j.asks.find(x => x.personId === pid && x.state === 'yes'); if (a) a.state = 'released';
    if (p) await reply(hh, p, 'released', { owner: first((await ownerOf(hh)).name) }, j.id);
    log(j, nowM, `Hold released: ${p?.first ?? pid} was not confirmed within 10 minutes`); j.hold = null; j.state = j.adhoc ? 'notfound' : 'asking';
    const w = j.asks.find(x => x.state === 'waiting');
    if (w) { w.state = 'yes'; j.hold = { personId: w.personId, at: nowM, reminded: false, preApproved: (await person(hh, w.personId))?.kind === 'backup' }; j.state = 'hold'; log(j, nowM, `${(await person(hh, w.personId))?.first} is next: hold started`); }
  }

  /* ================= PS-128 substitute ================= */
  async function proposeSubstitute(hh: string, date: string, mid: string, visitKey: string, name: string, phone: string) {
    const ts = (await dayTasks(hh, date)).filter(t => (t.visitId ?? t.id) + '|' + mid === visitKey && t.cover && ['Assigned', 'ConfirmedByCaregiver'].includes(t.cover.state) && !done(t));
    if (!ts.length) return null;
    const cfg = await cfgOf(hh), firstDue = Math.min(...ts.map(t => t.due)), id = uid('tl'), helper = await helperOf(mid);
    await db.query(`insert into task_links(id, household_id, kind, name, phone_e164, language, task_ids, proposed_by, token_hash, expires_at) values ($1,$2,'substitute',$3,$4,$5,$6,$7,$8,$9)`, [id, hh, name, phone, helper?.lang ?? 'en', ts.map(t => t.id), mid, sha(randomBytes(16).toString('hex')), iso(date, firstDue - cfg.substituteDeadlineMin)]);
    for (const t of ts) await moveCover(t, 'substitute_named', 'helper:' + mid, { reason: `${first(helper?.name ?? 'The helper')} wants to send ${name}` }, 'Nothing about the home is shared until the owner approves');
    await helperReply(hh, mid, 'sub_asked', { name: first(name) });
    await ownerPush(hh, 'Approve a substitute?', `${first(helper?.name ?? 'Your helper')} can’t make the ${clock(firstDue)} visit and wants to send ${name}. Approve or decline. Nothing is shared with ${first(name)} yet.`);
    await audit(db, 'helper:' + mid, hh, 'cover.substitute.proposed', { link: id, name, note: 'no home details shared' });
    return id;
  }
  async function decideSubstitute(hh: string, linkId: string, ok: boolean | null, actor: string) {
    const l = (await db.query<{ id: string; task_ids: string[]; name: string; proposed_by: string; approved_at: string | null; declined_at: string | null }>(`select * from task_links where id=$1 and household_id=$2 and kind='substitute'`, [linkId, hh]))[0];
    if (!l || l.approved_at || l.declined_at) return { error: 'not_pending' };
    const date = (await db.query<{ d: string }>(`select care_date::text as d from care_tasks where id=$1`, [l.task_ids[0]]))[0]!.d;
    const ts = (await tasksById(hh, date, l.task_ids)).filter(t => t.cover?.state === 'SubstituteProposed'), helper = await helperOf(l.proposed_by), by = first(helper?.name ?? 'The helper');
    if (!ok) {
      await db.query(`update task_links set declined_at=$2, revoked_at=$2 where id=$1`, [l.id, now().toISOString()]);
      for (const t of ts) await moveCover(t, ok === false ? 'substitute_declined' : 'substitute_timeout', actor, { lost_by: l.proposed_by });
      await helperReply(hh, l.proposed_by, 'sub_declined', { name: l.name });
      const reason = `${ok === false ? 'You declined ' + l.name : l.name + ' was not approved in time'}; ${by} can’t make it`;
      await ownerPush(hh, 'At risk', `${titles(ts)}: ${reason}. Asking your backups.`);
      return { job: ts.length ? (await startJob(hh, date, ts.map(t => t.id), reason, l.proposed_by)).id : null };
    }
    const sub = (await person(hh, l.id))!, mine = ts.filter(t => canDo(sub, t)), rest = ts.filter(t => !canDo(sub, t));
    const token = randomBytes(18).toString('base64url'), lastDue = Math.max(...ts.map(t => t.due));
    await db.query(`update task_links set approved_at=$2, token_hash=$3, expires_at=$4, task_ids=$5 where id=$1`, [l.id, now().toISOString(), sha(token), iso(date, lastDue + 120), mine.map(t => t.id)]);
    for (const t of mine) { await moveCover(t, 'substitute_approved', actor, { person_kind: 'substitute', person_id: l.id, person_name: l.name, confirmed_at: now().toISOString(), lost_by: null, handled_pre: true }, `${l.name} (named by ${by}) · you approved · one-time task link sent`); await db.query(`insert into visit_access_checklist(task_id, household_id, person_name) values ($1,$2,$3) on conflict (task_id) do nothing`, [t.id, hh, l.name]); }
    const o = first((await ownerOf(hh)).name), v = { name: first(l.name), by, day: DAY_WORD[sub.lang][date === today() ? 0 : 1]!, time: clock(Math.min(...mine.map(t => t.due))), owner: o, tasks: titles(mine), link: `/t/${token}` };
    await sayTo(hh, sub, 'cover_substitute_link', renderCover('cover_substitute_link', sub.lang, v), renderCover('cover_substitute_link', 'en', { ...v, day: DAY_WORD.en[date === today() ? 0 : 1]! }), [{ id: `link:${token}`, label: 'Open the task link' }], null, v);
    await helperReply(hh, l.proposed_by, 'sub_approved', { name: l.name });
    await audit(db, actor, hh, 'cover.substitute.approved', { link: l.id, tasks: mine.map(t => t.id), note: 'one-time task link; minimum details after acceptance' });
    if (rest.length) { for (const t of rest) await moveCover(t, 'substitute_declined', 'system', { lost_by: l.proposed_by }); await startJob(hh, date, rest.map(t => t.id), `${by} can’t make it; ${first(l.name)} does not give medicine`, l.proposed_by); }
    return { ok: true, token: d.demoMode ? token : undefined };
  }

  /* ================= owner actions (PS-133) ================= */
  async function ownerAction(hh: string, jobId: string, action: 'start' | 'confirm' | 'stop' | 'handle' | 'circle' | 'skip' | 'move' | 'someone', b: { personId?: string; time?: number; name?: string; phone?: string }, actor: string) {
    const j = await getJob(jobId, hh); if (!j) return { status: 404, body: { error: 'not_found' } };
    const nowM = minOn(j.careDate), ts = await tasksById(hh, j.careDate, j.taskIds), cfg = await cfgOf(hh);
    const opts = notFoundOptions(j.urgencies, { now: nowM, firstDue: j.firstDue, notFoundAt: j.nfAt, acknowledged: j.ack != null, circleAsked: j.circleAsked, circleCalled: j.circleCalled }, cfg);
    const bad = (m: string) => ({ status: 409, body: { error: 'not_allowed', message: m } });
    if (!jobActive(j)) return bad('This is already sorted.');
    if (action === 'start') { if (j.state !== 'await-owner') return bad('Already asking.'); j.ownerSent = true; j.state = 'asking'; await audit(db, actor, hh, 'cover.ask.approved', { job: j.id, note: 'one tap; no standing approval' }); await runJob(j, nowM); }
    if (action === 'confirm') { if (!j.hold || j.hold.personId !== b.personId) return bad('Nobody is waiting for confirmation.'); await confirm(j, b.personId!, nowM, false); }
    if (action === 'stop') { if (j.state !== 'asking' && j.state !== 'hold') return bad('The backup list is not running.'); for (const a of j.asks) if (a.state === 'asked') { a.state = 'closed'; const p = await person(hh, a.personId); if (p) await reply(hh, p, 'closed', {}, j.id); } j.state = 'stopped'; j.hold = null; j.ack = nowM; log(j, nowM, 'You stopped the backup list'); for (const t of ts) await moveCover(t, 'owner_stopped', actor); }
    if (action === 'handle') { for (const t of ts) await moveCover(t, 'owner_handles', actor, { person_kind: 'owner', person_name: 'You' }, 'You tapped “I’ll handle it”. Reminders stopped; evidence or your return check closes the task.'); await closeJob(j, nowM, 'owner', 'You are handling it'); await audit(db, actor, hh, 'cover.owner.handle', { job: j.id }); return { status: 200, body: await jobView(j) }; }
    if (action === 'circle') { if (!opts.askCircle) return bad('Your whole circle was already asked.'); j.circleAsked = true; j.mode = 'circle'; j.ownerSent = true; j.ack = nowM; j.state = 'asking'; j.circleRound = null; j.round = j.round; for (const t of ts) await moveCover(t, 'ask_circle', actor); log(j, nowM, 'You asked your whole care circle at once'); await runJob(j, nowM); }
    if (action === 'skip') { if (!opts.skip) return bad(j.urgencies.includes('MustHappen') ? 'A must-happen task can’t be skipped.' : 'Only a task that can wait may be skipped. You can move it.'); for (const t of ts) { await moveCover(t, 'owner_skips', actor, { skipped: true }, 'You skipped it. Not counted as covered.'); await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,'Skipped with reason',$3,$4)`, [t.id, hh, actor, 'Cover not found; skipped by owner']); await db.query(`update care_tasks set ack_at=coalesce(ack_at,$2), resolved_at=$2, resolved_note='Skipped by owner after cover not found' where id=$1`, [t.id, now().toISOString()]); } await closeJob(j, nowM, 'skipped', 'You skipped it'); return { status: 200, body: await jobView(j) }; }
    if (action === 'move') { if (!opts.move) return bad('A must-happen task can’t be moved.'); if (b.time == null || b.time <= nowM) return bad('Choose a later time.'); for (const t of ts) { const nt = b.time + (t.due - j.firstDue); await db.query(`update care_tasks set moved_from_minute=coalesce(moved_from_minute,due_minute), due_minute=$2 where id=$1`, [t.id, nt]); await moveCover({ ...t, due: nt }, 'owner_moves', actor, { person_kind: 'owner', person_name: 'You' }, `Moved ${clock(t.due)} → ${clock(nt)}. You’ll do it then.`); } await closeJob(j, nowM, 'moved', `You moved it to ${clock(b.time)}`); return { status: 200, body: { ...(await jobView(j)), warning: opts.moveWarning ? 'Time-sensitive: your pet waits longer than planned.' : undefined } }; }
    if (action === 'someone') {
      const name = (b.name ?? '').trim(), phone = (b.phone ?? '').replace(/\s/g, '');
      if (!name || !/^\+91[6-9]\d{9}$/.test(phone)) return { status: 400, body: { error: 'invalid_input', message: 'Enter a name and an Indian mobile number.' } };
      const id = uid('tl'), token = randomBytes(18).toString('base64url');
      await db.query(`insert into task_links(id, household_id, kind, name, phone_e164, task_ids, job_id, token_hash, expires_at) values ($1,$2,'adhoc',$3,$4,$5,$6,$7,$8)`, [id, hh, name, phone, j.taskIds, j.id, sha(token), new Date(now().getTime() + cfg.adhocLinkMin * 60000).toISOString()]);
      j.state = 'adhoc'; j.adhoc = { personId: id, at: nowM }; j.ack = nowM; j.ownerSent = true; j.asks.push({ personId: id, round: ++j.round, at: nowM, state: 'asked' });
      const p = (await person(hh, id))!, pet = await petName(ts[0]!.petId), o = first((await ownerOf(hh)).name), h = await household(hh), day = j.careDate === today() ? 0 : 1;
      const v = { name: p.first, owner: o, tower: h.tower ?? '', pet: pet.name, day: DAY_WORD.en[day]!, time: clock(j.firstDue), tasks: titles(ts), link: `/t/${token}` };
      await sayTo(hh, p, 'cover_adhoc_link', renderCover('cover_adhoc_link', 'en', v), null, [{ id: `link:${token}`, label: 'Open the task link' }], j.id, v);
      for (const t of ts) await moveCover(t, 'ask_someone', actor);
      log(j, nowM, `You asked ${name} (one-time 15-minute task link; details only after they accept and you approve)`);
      await audit(db, actor, hh, 'cover.ask.someone', { job: j.id, link: id, note: 'no address shared' });
      await saveJob(j); return { status: 200, body: { ...(await jobView(j)), linkToken: d.demoMode ? token : undefined } };
    }
    await saveJob(j);
    return { status: 200, body: await jobView(j) };
  }
  /** Owner opens Friend Finder for a job: a pre-filled request (still needs search + approval). */
  async function friendFinderFor(hh: string, jobId: string, actor: string) {
    const j = await getJob(jobId, hh); if (!j || !jobActive(j)) return { status: 404, body: { error: 'not_found' } };
    const nowM = minOn(j.careDate);
    if (!friendFinderOpen(nowM, j.firstDue, await cfgOf(hh))) return { status: 409, body: { error: 'too_close', message: 'Too close to the task for Friend Finder. Your backups are being asked instead.' } };
    if (j.reqId) return { status: 200, body: { requestId: j.reqId } };
    const ts = await tasksById(hh, j.careDate, j.taskIds), pet = await petName(ts[0]!.petId);
    const KIND: Record<string, string> = { feeding: 'feed', litter: 'litter', walk: 'walk', medicine: 'meds', toilet: 'toilet', water: 'water', other: 'feed' };
    const tasks = [...new Set(ts.map(t => KIND[t.type] ?? 'feed'))];
    const parsed = { tasks, petId: ts[0]!.petId, time: j.firstDue, durationMin: Math.min(60, ts.reduce((a, t) => a + Math.max(5, t.minMinutes), 0)), access: 'Key handover', lift: null, urgency: 'Today', medsInstructions: tasks.includes('meds') ? pet.medicines : null, sources: { time: 'from the task', access: 'from your profile' } };
    const id = 'ffr_' + uid('x').slice(2, 12), originText = 'Started because ' + j.reason.charAt(0).toLowerCase() + j.reason.slice(1);
    const doc0 = { ...newRequest(id, nowM), ...(j.mode === 'wide' ? { windowMin: 60 } : {}), origin: { jobId: j.id, text: originText } };
    const { req } = reduce(doc0, { type: 'parse_confirmed', taskTime: j.firstDue }, nowM);
    const parse = { parsed, clarifications: [], confidence: 1, parser: 'rules', originalParsed: parsed, careDate: j.careDate, text: `${titles(ts)} at ${clock(j.firstDue)} (${originText})` };
    await db.query(`insert into friend_requests(id, household_id, state, parse, parser, doc, created_by) values ($1,$2,$3,$4,'manual',$5,$6)`, [id, hh, req.state, JSON.stringify(parse), JSON.stringify(req), actor]);
    j.reqId = id; if (j.ack == null) j.ack = nowM; if (j.state !== 'asking') j.state = 'ff';
    for (const t of ts) await moveCover(t, 'friend_finder_started', actor);
    log(j, nowM, `You opened Friend Finder (${id})`); await saveJob(j);
    await audit(db, actor, hh, 'request.created', { id, origin: j.id });
    return { status: 200, body: { requestId: id } };
  }
  /** Friend Finder confirmed a friend for a job (create_cover_task effect). */
  async function coveredByFriend(hh: string, reqId: string, origin: { jobId: string }, coverTaskId: string, friendName: string) {
    const j = await getJob(origin.jobId, hh); if (!j) return;
    const nowM = minOn(j.careDate), ts = await tasksById(hh, j.careDate, j.taskIds);
    for (const t of ts) { await moveCover(t, 'replacement_confirmed', 'owner', { person_kind: 'friend', person_name: friendName, confirmed_at: now().toISOString(), lost_by: null }, `${first(friendName)} (friend) covers it via ${reqId} · you confirmed`); await db.query(`update care_tasks set reassigned_to_task_id=$2 where id=$1 and reassigned_to_task_id is null`, [t.id, coverTaskId]); await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,'Reassigned','owner',$3)`, [t.id, hh, `To ${friendName} via ${reqId} (original plan kept)`]); }
    j.covered.push({ personId: 'friend', at: nowM, taskIds: j.taskIds, via: reqId }); j.coveredAt = nowM;
    await closeJob(j, nowM, 'covered', `${first(friendName)} (friend) confirmed via ${reqId}`);
  }
  /** PS-131: a confirmed friend cancelled after the search cutoff → the backup list, not a new search. */
  async function friendCancelledAfterCutoff(hh: string, coverTaskId: string, friendName: string, friendUserId: string, why?: { reason: 'cancelled' | 'emergency'; done: string[] }) {
    const t = (await db.query<{ care_date: string }>(`select care_date::text as care_date from care_tasks where id=$1`, [coverTaskId]))[0]; if (!t) return null;
    const emergency = why?.reason === 'emergency', partly = emergency && why!.done.length > 0;
    // PAW-060: an emergency exit after some of the work is Partly done (what was finished is named), never Done.
    await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,$3,'system',$4)`, [coverTaskId, hh, partly ? 'Partly done' : 'Missed', emergency ? `${friendName} had an emergency and left${partly ? ' after: ' + why!.done.join(', ') : ''}; backups asked` : `${friendName} cancelled after the cutoff; backups asked`]).catch(() => undefined);
    const job = await atRisk(hh, t.care_date, [coverTaskId], emergency ? `${first(friendName)} had an emergency and left` : `${first(friendName)} cancelled`, friendUserId, 'friend_cancelled', undefined, { mode: 'pairs' });
    if (job) { job.ffSkipped = true; job.log.splice(1, 0, { at: job.log[0]!.at, text: `Friend Finder not started: too close to the task (search closed at ${clock(friendFinderCutoff(job.firstDue))})` }); await saveJob(job); }
    return job;
  }

  /* ================= helper inbound (PS-127 / PS-128) ================= */
  async function helperInbound(hh: string, mid: string, b: { type: string; payload?: string; text?: string }) {
    const [p, arg, extra] = (b.payload ?? '').split(':');
    if (p === 'cover_yes' || p === 'cover_cant' || p === 'cover_sub') return reminderReply(arg!, p === 'cover_yes' ? 'yes' : p === 'cover_cant' ? 'cant' : 'sub', 'WhatsApp');
    if (p === 'cover_ext') return extensionReply(hh, arg!, extra === 'yes' ? { kind: 'yes' } : extra === 'cant' ? { kind: 'cannot' } : { kind: 'only_until', until: Number(extra) }, 'WhatsApp');
    const text = (b.text ?? '').trim();
    if (!text) return null;
    const pending = (await db.query<{ id: string }>(`select r.id from reminder r where r.household_id=$1 and r.recipient_id=$2 and r.reply='substitute' and not exists (select 1 from task_links l where l.proposed_by=$2 and l.kind='substitute' and l.created_at >= r.reply_at) order by r.reply_at desc limit 1`, [hh, mid]))[0];
    const sub = parseSubstitute(text);
    if (pending && sub) return reminderReply(pending.id, 'sub', 'WhatsApp', sub);
    if (isCantCome(text)) return helperCantCome(hh, mid, 'WhatsApp');
    return null;
  }
  /** "can't come" at any time: the next visit that still lies ahead for this helper. */
  async function helperCantCome(hh: string, mid: string, channel: string) {
    for (const date of [today(), tomorrowOf(today())]) {
      const nowM = minOn(date);
      const g = groups(await dayTasks(hh, date)).filter(x => x.kind === 'helper' && x.personId === mid && x.first > nowM - 30 && x.tasks.some(t => !done(t))).sort((a, b2) => a.first - b2.first)[0];
      if (!g) continue;
      await db.query(`insert into reminder(id, household_id, care_date, visit_key, recipient_kind, recipient_id, channel, sent_at, deadline_at, reply, reply_at, reply_channel) values ($1,$2,$3,$4,'helper',$5,'whatsapp',$6,$6,'cant',$6,$7) on conflict (household_id, care_date, visit_key) do update set reply='cant', reply_at=$6, reply_channel=$7`, [uid('rem'), hh, date, g.key, mid, now().toISOString(), channel]);
      const name = first((await helperOf(mid))?.name ?? 'The helper');
      const job = await atRisk(hh, date, g.tasks.map(t => t.id), `${name} says she can’t come (${channel}, ${clock(nowM)})`, mid, 'caregiver_cant');
      return { status: job ? 'at_risk' : 'nothing_to_do' };
    }
    await helperReply(hh, mid, 'no_visits');
    return { status: 'no_visits' };
  }
  /** IVR reminder menu (press 1 / 2 / 3) and "press 2 any time" on the missed-call line. */
  async function ivr(hh: string, mid: string, event: 'reminder' | 'cant', digits?: string, sub?: { name: string; phone: string }) {
    if (event === 'cant') return helperCantCome(hh, mid, 'IVR 2');
    const rem = (await db.query<{ id: string }>(`select id from reminder where household_id=$1 and recipient_id=$2 and (reply is null or reply='noreply') order by sent_at desc limit 1`, [hh, mid]))[0];
    if (!rem) return { status: 'no_open_reminder' };
    return reminderReply(rem.id, digits === '1' ? 'yes' : digits === '2' ? 'cant' : 'sub', 'IVR ' + digits, digits === '3' ? sub : undefined);
  }

  /* ================= backups / ad-hoc inbound ================= */
  async function personInbound(b: { messageId: string; from: string; type: string; payload?: string; text?: string; mediaRef?: string; caption?: string }) {
    const [p, arg] = (b.payload ?? '').split(':');
    const contactsByPhone = await db.query<{ id: string; household_id: string }>(`select id, household_id from backup_contact where phone_e164=$1 and removed_at is null union all select id, household_id from task_links where phone_e164=$1 and revoked_at is null`, [b.from]);
    if (!contactsByPhone.length) return null;
    if (p === 'cr_yes' || p === 'cr_cant') return reminderReply(arg!, p === 'cr_yes' ? 'yes' : 'cant', 'WhatsApp');
    let jobId = p && p.startsWith('cb_') ? arg : undefined, pid: string | undefined;
    const jobs = (await db.query<{ doc: JobDoc }>(`select doc from cover_jobs where household_id = any($1) order by updated_at desc`, [[...new Set(contactsByPhone.map(c => c.household_id))]])).map(r => r.doc);
    const mineIds = contactsByPhone.map(c => c.id);
    if (!jobId) { const open = jobs.find(j => j.asks.some(a => mineIds.includes(a.personId) && a.state === 'asked')) ?? jobs.find(j => j.covered.some(c => mineIds.includes(c.personId))); jobId = open?.id; }
    const j = jobs.find(x => x.id === jobId); if (!j) return null;
    pid = mineIds.find(id => j.asks.some(a => a.personId === id) || j.covered.some(c => c.personId === id)); if (!pid) return null;
    if (p === 'cb_yes' || p === 'cb_no' || p === 'cb_read') return coverReply(j.id, pid, p === 'cb_yes' ? 'yes' : p === 'cb_no' ? 'no' : 'read', 'WhatsApp');
    if (p === 'cb_done' || b.type === 'photo') return replacementDone(j.householdId, pid, b.messageId);
    if (p === 'cb_cant' || (b.type === 'text' && isCantCome(b.text ?? ''))) return replacementCant(j.householdId, pid);
    const t = (b.text ?? '').trim();
    if (/^(yes|haan|ha|ho|हाँ|हो|ok|sure)\b/i.test(t) && !/\d/.test(t)) return coverReply(j.id, pid, 'yes', 'WhatsApp');
    if (/^(no|nahi|नहीं|नाही|sorry)\b/i.test(t)) return coverReply(j.id, pid, 'no', 'WhatsApp');
    if (/read|पढ़ लिया|वाचले/i.test(t)) return coverReply(j.id, pid, 'read', 'WhatsApp');
    const per = await person(j.householdId, pid); if (per) await reply(j.householdId, per, 'not_understood', {}, j.id);
    return { status: 'not_understood' };
  }
  async function replacementTasks(hh: string, pid: string) {
    const out: (Task & { careDate: string })[] = [];
    for (const date of [today(), tomorrowOf(today())]) out.push(...(await dayTasks(hh, date)).filter(t => t.cover?.personId === pid && t.cover.state === 'CoveredByReplacement' && !done(t) && t.ev.state !== 'Cancelled'));
    return out;
  }
  async function replacementDone(hh: string, pid: string, messageId: string) {
    const ts = await replacementTasks(hh, pid); if (!ts.length) return { status: 'nothing_to_do' };
    for (const t of ts) await ingestSignal(db, { householdId: hh, idempotencyKey: `cover-done:${messageId}:${t.id}`, kind: 'friend_photo', taskId: t.id, channel: 'whatsapp', eventTime: now(), receivedTime: now(), actor: 'cover:' + pid });
    const p = await person(hh, pid); if (p) await reply(hh, p, 'done_thanks');
    await db.query(`update backup_contact set cared_before=true where id=$1`, [pid]);
    await ownerPush(hh, 'Done', `${p?.first ?? 'Your cover'} finished ${titles(ts)}. One photo shows the task as Likely.`);
    return { status: 'stored' };
  }
  async function replacementCant(hh: string, pid: string) {
    const ts = await replacementTasks(hh, pid); if (!ts.length) return { status: 'nothing_to_do' };
    const p = await person(hh, pid); if (p) await reply(hh, p, 'removed');
    await db.query(`update task_links set revoked_at=$2 where id=$1`, [pid, now().toISOString()]);
    await db.query(`delete from visit_access_checklist where task_id = any($1)`, [ts.map(t => t.id)]);
    await db.query(`update task_cover set job_id=null where task_id = any($1)`, [ts.map(t => t.id)]);
    const byDate = new Map<string, string[]>(); ts.forEach(t => byDate.set(t.careDate, [...(byDate.get(t.careDate) ?? []), t.id]));
    for (const [date, ids] of byDate) await atRisk(hh, date, ids, `${p?.first ?? 'Your cover'} can’t make it after all`, pid, 'replacement_cant');
    return { status: 'at_risk' };
  }

  /* ================= one-time task links (/t/:token) ================= */
  async function linkByToken(token: string) { return (await db.query<{ id: string; household_id: string; kind: string; name: string; task_ids: string[]; job_id: string | null; expires_at: string; accepted_at: string | null; note_read_at: string | null; approved_at: string | null; revoked_at: string | null; opened_at: string | null }>(`select * from task_links where token_hash=$1`, [sha(token)]))[0]; }
  async function linkView(token: string) {
    const l = await linkByToken(token); if (!l) return { status: 404, body: { error: 'not_found' } };
    const valid = !l.revoked_at && new Date(l.expires_at) > now();
    await audit(db, 'link:' + l.id, l.household_id, 'tasklink.opened', { valid });
    if (!valid) return { status: 410, body: { error: 'expired', note: 'This link has expired or was switched off. It works for one task only.' } };
    await db.query(`update task_links set opened_at=coalesce(opened_at,$2) where id=$1`, [l.id, now().toISOString()]);
    const date = (await db.query<{ d: string }>(`select care_date::text as d from care_tasks where id=$1`, [l.task_ids[0]]))[0]!.d;
    const ts = await tasksById(l.household_id, date, l.task_ids), pet = await petName(ts[0]!.petId), h = await household(l.household_id), o = await ownerOf(l.household_id);
    const role = l.kind === 'substitute' ? 'substitute' : 'adhoc_visitor';
    const ctx = { sameHousehold: true, taskLinkValid: true, forThisTask: true, accepted: !!l.accepted_at, ownerApproved: !!l.approved_at };
    const details = can(role, 'access_details', 'read', ctx);
    const checklist = details ? (await db.query<{ gate_approved: boolean; key_plan: string | null; key_note: string | null }>(`select gate_approved, key_plan, key_note from visit_access_checklist where task_id = any($1) limit 1`, [l.task_ids]))[0] : null;
    return { status: 200, body: {
      kind: l.kind, name: l.name, owner: first(o.name), tower: h.tower, pet: pet.name, handlingNote: pet.handling_note, tasks: ts.map(t => ({ id: t.id, title: t.title, due: t.due, time: clock(t.due), state: t.ev.state, label: t.ev.label })),
      accepted: !!l.accepted_at, approved: !!l.approved_at, expiresAt: l.expires_at, canAccept: !l.accepted_at && (l.kind === 'substitute' ? !!l.approved_at : true),
      details: details ? { flat: h.flat_private, tower: h.tower, gate: checklist?.gate_approved ? 'Approved at the society gate' : `${first(o.name)} will approve you in the gate app`, key: checklist?.key_plan ? (checklist.key_note || KEY_TEXT[checklist.key_plan]) : 'The owner will tell you the key plan', instructions: (await db.query<{ i: string | null }>(`select r.instructions as i from care_tasks t left join routine_tasks r on r.id=t.routine_task_id where t.id = any($1)`, [l.task_ids])).map(x => x.i).filter(Boolean).join(' ') } : null,
      notice: details ? 'For this task only. The link stops working after the visit.' : 'Address, gate and key details are shared only after you accept and the owner approves.'
    } };
  }
  async function linkAction(token: string, action: 'accept' | 'decline' | 'done' | 'cant', noteRead?: boolean) {
    const l = await linkByToken(token); if (!l || l.revoked_at || new Date(l.expires_at) <= now()) return { status: 410, body: { error: 'expired' } };
    if (action === 'accept') {
      const pet = await petName((await db.query<{ pet_id: string }>(`select pet_id from care_tasks where id=$1`, [l.task_ids[0]]))[0]!.pet_id);
      if (pet.handling_note && !noteRead) return { status: 409, body: { error: 'read_handling_note', note: 'Please read the handling note and tick “I have read this” first.' } };
      if (l.kind === 'substitute') { if (!l.approved_at) return { status: 409, body: { error: 'not_approved_yet' } }; await db.query(`update task_links set accepted_at=$2, note_read_at=$2 where id=$1`, [l.id, now().toISOString()]); return { status: 200, body: { ok: true } }; }
      if (!l.job_id) return { status: 409, body: { error: 'no_job' } };
      const j = await getJob(l.job_id); if (j && !j.noteRead.includes(l.id)) { j.noteRead.push(l.id); await saveJob(j); }
      return { status: 200, body: await coverReply(l.job_id, l.id, 'yes', 'task link') };
    }
    if (action === 'decline') { if (l.job_id) return { status: 200, body: await coverReply(l.job_id, l.id, 'no', 'task link') }; await db.query(`update task_links set revoked_at=$2 where id=$1`, [l.id, now().toISOString()]); return { status: 200, body: { ok: true } }; }
    if (!l.approved_at || !l.accepted_at) return { status: 403, body: { error: 'not_confirmed' } };
    if (action === 'done') return { status: 200, body: await replacementDone(l.household_id, l.id, 'link-' + l.id + '-' + now().getTime()) };
    return { status: 200, body: await replacementCant(l.household_id, l.id) };
  }

  /* ================= PS-134 pre-departure, plan B, leave anyway ================= */
  async function taskViews(hh: string, date: string): Promise<(CoverTaskView & { jobId: string | null })[]> {
    const ds = await dayState(hh, date);
    return Promise.all((await dayTasks(hh, date)).filter(t => t.cover).map(async t => ({ id: t.id, title: t.title, petName: (await petName(t.petId)).name, due: t.due, cover: t.cover!.state, urgency: t.urgency, done: done(t), cancelled: t.ev.state === 'Cancelled' || !!t.reassignedToTaskId, helperUnavailable: !!ds?.helper_unavailable && t.cover!.personKind === 'helper' && t.cover!.state === 'Assigned', jobId: t.cover!.jobId })));
  }
  async function preDeparture(hh: string, date: string) { const cfg = await cfgOf(hh); return preDepartureCheck(await taskViews(hh, date), minOn(date), cfg); }
  async function preDepartureOption(hh: string, date: string, option: string, actor: string, b: { petId?: string }) {
    const nowM = minOn(date), check = await preDeparture(hh, date), ts = await tasksById(hh, date, check.unconfirmed.map(t => t.id));
    const closeJobsOf = async (list: Task[], note: string) => { for (const t of list) { const j = t.cover?.jobId ? await getJob(t.cover.jobId) : null; if (j && jobActive(j)) await closeJob(j, nowM, 'owner', note); } };
    if (option === 'leave_later') return { ok: true, note: 'Nothing changed.' };
    if (option === 'do_it_before_leaving') {
      await closeJobsOf(ts, 'You did it before leaving');
      for (const t of ts) { await db.query(`update care_tasks set return_check=$2 where id=$1`, [t.id, JSON.stringify({ at: nowM, matched: true })]); await moveCover(t, 'owner_handles', actor, { person_kind: 'owner', person_name: 'You' }, 'You did it before leaving (fed early, extra water). Medicine early only if your vet allows.'); }
      await audit(db, actor, hh, 'cover.predeparture', { option, tasks: ts.map(t => t.id) }); return { ok: true };
    }
    if (option === 'take_the_pet') {
      const pid = b.petId ?? ts[0]?.petId; const mine = (await dayTasks(hh, date)).filter(t => t.petId === pid && t.due > nowM && t.ev.state !== 'Cancelled');
      await closeJobsOf(mine, 'The pet is with you today');
      for (const t of mine) await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,'Cancelled by owner',$3,'Pet is with the owner today')`, [t.id, hh, actor]);
      await audit(db, actor, hh, 'cover.predeparture', { option, pet: pid }); return { ok: true };
    }
    if (option === 'own_paid_provider') {
      const v = (await backups(hh)).find(x => x.owner_arranged); if (!v) return { error: 'no_provider', note: 'Add your own walker or sitter in Me → Backups first.' };
      const mine = ts.filter(t => !isMed(t) || v.can_give_medicine); await closeJobsOf(mine, 'You used your own paid provider');
      for (const t of mine) { if (t.cover!.state === 'Assigned') await moveCover(t, 'marked_unavailable', actor); await moveCover(t, 'replacement_confirmed', actor, { person_kind: 'backup', person_id: v.id, person_name: v.name, confirmed_at: now().toISOString(), lost_by: null, handled_pre: true }, `${v.name} · owner-arranged, not verified by Pawsure`); }
      await audit(db, actor, hh, 'cover.predeparture', { option, provider: v.id, note: 'owner-arranged, not verified by Pawsure' });
      return { ok: true, notCovered: ts.filter(t => !mine.includes(t)).map(t => t.title) };
    }
    if (option === 'ask_circle_now') {
      const free = ts.filter(t => !(t.cover?.jobId)); if (!free.length) return { ok: true, note: 'Already asking.' };
      for (const t of free) if (t.cover!.state === 'Assigned') await moveCover(t, 'marked_unavailable', actor, { reason: 'You marked the helper unavailable today', lost_by: t.cover!.personId, handled_pre: true });
      const j = await startJob(hh, date, free.map(t => t.id), free[0]!.cover!.reason ?? 'Nobody is confirmed', free[0]!.cover!.lostBy ?? null, { ownerSent: true });
      return { ok: true, jobId: j.id, wide: j.mode === 'wide' };
    }
    if (option === 'leave_anyway') {
      await closeJobsOf(ts, 'You left anyway: no cover planned');
      for (const t of ts) await moveCover(t, 'leave_anyway', actor, { handled_pre: true }, 'You left with nobody confirmed. The task is still tracked; the day is not covered unless it is done with evidence or matched by your return check.');
      await db.query(`insert into day_states(household_id, care_date, no_cover_planned) values ($1,$2,true) on conflict (household_id, care_date) do update set no_cover_planned=true`, [hh, date]);
      await audit(db, actor, hh, 'cover.no_cover_planned', { tasks: ts.map(t => t.id) });
      return { ok: true, noCoverPlanned: true };
    }
    return { error: 'unknown_option' };
  }
  /** Owner marked the helper unavailable (PS-014): her tasks go At risk; the owner decides how to ask (no automatic asks). */
  async function helperUnavailable(hh: string, date: string, unavailable: boolean, actor: string) {
    const ts = (await dayTasks(hh, date)).filter(t => t.cover?.personKind === 'helper' && !done(t) && t.due > minOn(date) - 30);
    for (const t of ts) {
      if (unavailable && ['Assigned', 'ConfirmedByCaregiver'].includes(t.cover!.state)) await moveCover(t, 'marked_unavailable', actor, { reason: 'You marked the helper unavailable today', lost_by: t.cover!.personId, handled_pre: true });
      if (!unavailable && t.cover!.state === 'AtRisk' && !t.cover!.jobId) await moveCover(t, 'restored', actor, { reason: null, lost_by: null });
    }
  }

  /* ================= PS-136 I'm delayed ================= */
  async function delay(hh: string, date: string, newReturn: number, actor: string) {
    const ds = await dayState(hh, date), h = await household(hh), oldReturn = ds?.return_at ?? h.out_to;
    const owner = await db.query<{ id: string; pet_id: string; title: string; task_type: string; due_minute: number; min_minutes: number; urgency: string | null; escalation_profile: string }>(`select * from routine_tasks where household_id=$1 and owner_task and enabled and superseded_by is null`, [hh]);
    const have = (await db.query<{ routine_task_id: string }>(`select routine_task_id from care_tasks where household_id=$1 and care_date=$2`, [hh, date])).map(r => r.routine_task_id);
    const visitTimes = (await dayTasks(hh, date)).filter(t => t.ev.state !== 'Cancelled').map(t => t.due);
    const helperOk = !!(await db.query(`select 1 from memberships where household_id=$1 and role='helper' and status='active' and not paused`, [hh])).length && ds?.mode !== 'trusted' && !ds?.helper_unavailable;
    const plan = planDelay({ oldReturn, newReturn, outFrom: h.out_from, ownerTasks: owner.map(r => ({ id: r.id, title: r.title, type: r.task_type as OwnerRoutineTask['type'], due: r.due_minute, minMinutes: r.min_minutes, urgency: (r.urgency as Urgency) ?? 'TimeSensitive' })), alreadyPlanned: have, visitTimes, aloneLimitHours: (await db.query<{ a: number }>(`select alone_limit_hours as a from households where id=$1`, [hh]))[0]!.a, hasCurrentCaregiver: helperOk });
    const ownerM = (await db.query<{ id: string }>(`select id from memberships where household_id=$1 and role='owner' limit 1`, [hh]))[0]?.id;
    const created: string[] = [];
    for (const r of plan.added) {
      const row = owner.find(o => o.id === r.id)!, id = `${r.id}_${date}`;
      await db.query(`insert into care_tasks(id, household_id, pet_id, routine_task_id, care_date, title, task_type, due_minute, min_minutes, escalation_profile, assignee_membership_id, urgency) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (id) do nothing`, [id, hh, row.pet_id, r.id, date, r.title, r.type, r.due, r.minMinutes, row.escalation_profile, ownerM, r.urgency]);
      await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,'Planned',$3,$4)`, [id, hh, actor, `Added by “I’m delayed” (return ${clock(oldReturn)} → ${clock(newReturn)})`]);
      await db.query(`insert into task_cover(task_id, household_id, state, person_kind, person_name, original_assignee, reason, rule_version, handled_pre) values ($1,$2,'Extended','owner','You',$3,$4,$5,true) on conflict (task_id) do nothing`, [id, hh, ownerM, 'Added because you’re delayed', COVER_RULE]);
      created.push(id);
    }
    const ext = uid('dx');
    await db.query(`insert into delay_extension(id, household_id, care_date, old_return, new_return, created_tasks, result) values ($1,$2,$3,$4,$5,$6,$7)`, [ext, hh, date, oldReturn, newReturn, created, plan.planOnly ? 'Nothing new is due. Plan and return time updated only.' : null]);
    await db.query(`insert into day_states(household_id, care_date, return_at) values ($1,$2,$3) on conflict (household_id, care_date) do update set return_at=$3`, [hh, date, newReturn]);
    await audit(db, actor, hh, 'return.extended', { from: oldReturn, to: newReturn, added: created });
    return { id: ext, ...plan, createdTaskIds: created, aloneWarning: plan.alone.exceeds };
  }
  async function askExtension(hh: string, extId: string, actor: string) {
    const x = (await db.query<{ id: string; care_date: string; created_tasks: string[]; new_return: number; old_return: number; asked: unknown }>(`select id, care_date::text as care_date, created_tasks, new_return, old_return, asked from delay_extension where id=$1 and household_id=$2`, [extId, hh]))[0];
    if (!x || x.asked) return { error: 'already_asked' };
    const ts = await tasksById(hh, x.care_date, x.created_tasks), ds = await dayState(hh, x.care_date);
    const mid = (await db.query<{ id: string }>(`select id from memberships where household_id=$1 and role='helper' and status='active' and not paused limit 1`, [hh]))[0]?.id;
    if (!mid || ds?.mode === 'trusted' || ds?.helper_unavailable || !(await helperConsented(mid))) {
      await db.query(`update delay_extension set asked=$2, result=$3 where id=$1`, [extId, JSON.stringify({ who: null, at: minOn(x.care_date) }), 'No current caregiver to ask. Asking your backups.']);
      for (const t of ts) await moveCover(t, 'caregiver_cant', actor, { reason: 'You’re delayed and nobody is caring' });
      const j = await startJob(hh, x.care_date, ts.map(t => t.id), `You’re delayed until ${clock(x.new_return)}`, null, { part: extId });
      return { asked: 'backups', jobId: j.id };
    }
    const h = (await helperOf(mid))!, until = Math.min(x.new_return - 60, x.old_return + 60), list = ts.map(t => `${clock(t.due)} ${t.title}`).join(', '), o = first((await ownerOf(hh)).name);
    const btns = EXT_BUTTONS[h.lang](clock(until)).map((label, i) => ({ id: `cover_ext:${extId}:${['yes', String(until), 'cant'][i]}`, label: label + (h.lang === 'en' ? '' : ` (${EXT_BUTTONS.en(clock(until))[i]})`) }));
    await helperMsg(hh, mid, 'cover_extension_request', renderCover('cover_extension_request', h.lang, { owner: o, until: clock(x.new_return), tasks: list }), renderCover('cover_extension_request', 'en', { owner: o, until: clock(x.new_return), tasks: list }) + ' · Yes / Only until … / Can’t', btns, { owner: o, until: clock(x.new_return), tasks: list });
    await db.query(`update delay_extension set asked=$2 where id=$1`, [extId, JSON.stringify({ who: mid, at: minOn(x.care_date), reply: null })]);
    return { asked: 'helper' };
  }
  async function extensionReply(hh: string, extId: string, r: ExtensionReply, channel: string) {
    const x = (await db.query<{ id: string; care_date: string; created_tasks: string[]; new_return: number; asked: { who: string | null; at: number; reply: string | null } | null }>(`select id, care_date::text as care_date, created_tasks, new_return, asked from delay_extension where id=$1 and household_id=$2`, [extId, hh]))[0];
    if (!x?.asked || x.asked.reply) return { status: 'already_replied' };
    const ts = await tasksById(hh, x.care_date, x.created_tasks), sp = splitExtension(ts.map(t => ({ id: t.id, title: t.title, type: t.type, due: t.due, minMinutes: t.minMinutes, urgency: t.urgency })), r);
    const mid = x.asked.who!, name = first((await helperOf(mid))?.name ?? 'The helper');
    for (const s of sp.caregiver) { const t = ts.find(y => y.id === s.id)!; await db.query(`update care_tasks set assignee_membership_id=$2 where id=$1`, [t.id, mid]); await moveCover(t, 'caregiver_yes', 'helper:' + mid, { person_kind: 'helper', person_id: mid, person_name: name, confirmed_at: now().toISOString() }, `${name} said ${r.kind === 'yes' ? 'Yes' : 'Only until ' + (r.kind === 'only_until' ? clock(r.until) : '')} to the extension (${channel})`); }
    const result = r.kind === 'yes' ? `${name} covers all of the extra time.` : r.kind === 'only_until' ? `${name} covers until ${clock(r.until)}${sp.caregiver.length ? ' (' + titles(sp.caregiver) + ')' : ''}. A request was started for the rest only: ${titles(sp.uncovered)}.` : r.kind === 'no_reply' ? `${name} didn’t reply in 10 minutes. Asking your backups for the extra tasks only.` : `${name} can’t. A request was started for the extra tasks only.`;
    await db.query(`update delay_extension set asked=$2, result=$3 where id=$1`, [extId, JSON.stringify({ ...x.asked, reply: r.kind, until: r.kind === 'only_until' ? r.until : null }), result]);
    await ownerPush(hh, 'I’m delayed', result);
    if (r.kind !== 'no_reply' && (await helperOf(mid))) await helperReply(hh, mid, 'thanks_yes');
    if (sp.uncovered.length) {
      const why = `You’re delayed until ${clock(x.new_return)}${r.kind === 'only_until' ? ` and ${name} can stay only until ${clock(r.until)}` : r.kind === 'no_reply' ? ` and ${name} hasn’t replied` : ` and ${name} can’t stay`}`;
      for (const s of sp.uncovered) await moveCover(ts.find(y => y.id === s.id)!, r.kind === 'no_reply' ? 'no_reply' : 'caregiver_cant', 'system', { reason: why, handled_pre: true });
      await startJob(hh, x.care_date, sp.uncovered.map(t => t.id), why, null, { part: extId });
    }
    return { status: 'ok', result };
  }

  /* ================= PS-137 checklist ================= */
  async function tickChecklist(hh: string, taskId: string, b: { gateApproved?: boolean; keyPlan?: string | null; keyNote?: string | null }, actor: string) {
    const c = (await db.query<{ task_id: string; gate_approved: boolean; key_plan: string | null }>(`select * from visit_access_checklist where task_id=$1 and household_id=$2`, [taskId, hh]))[0];
    if (!c) return { error: 'not_found' };
    await db.query(`update visit_access_checklist set gate_approved=coalesce($2,gate_approved), key_plan=coalesce($3,key_plan), key_note=coalesce($4,key_note), ticked_at=$5 where task_id=$1`, [taskId, b.gateApproved ?? null, b.keyPlan ?? null, b.keyNote ?? null, now().toISOString()]);
    const cov = (await db.query<{ person_kind: string; person_id: string }>(`select person_kind, person_id from task_cover where task_id=$1`, [taskId]))[0], o = first((await ownerOf(hh)).name);
    const p = cov?.person_id && cov.person_kind !== 'friend' ? await person(hh, cov.person_id) : null;
    const keyText = b.keyPlan ? (b.keyNote || KEY_TEXT[b.keyPlan]!) : null;
    if (p && p.kind !== 'adhoc' && p.kind !== 'substitute') { if (b.gateApproved && !c.gate_approved) await reply(hh, p, 'gate_ok', { owner: o }); if (keyText) await reply(hh, p, 'key_plan', { key: keyText }); }
    if (cov?.person_kind === 'friend') { const fr = (await db.query<{ assignee_friend_user_id: string }>(`select assignee_friend_user_id from care_tasks where id=$1`, [taskId]))[0]?.assignee_friend_user_id; if (fr) { if (b.gateApproved && !c.gate_approved) await db.query(`insert into friend_messages(id, friend_user_id, household_id, direction, body, at) values ($1,$2,$3,'out',$4,$5)`, [uid('fm'), fr, hh, renderReply('gate_ok', 'en', { owner: o }), now().toISOString()]); if (keyText) await db.query(`insert into friend_messages(id, friend_user_id, household_id, direction, body, at) values ($1,$2,$3,'out',$4,$5)`, [uid('fm'), fr, hh, 'Key: ' + keyText, now().toISOString()]); } }
    await audit(db, actor, hh, 'cover.checklist', { task: taskId, gate: b.gateApproved, keyPlan: b.keyPlan, note: 'owner action in the gate app; no gate-app integration' });
    return { ok: true };
  }

  /* ================= the minute job ================= */
  async function tick(hh: string) {
    const sent: string[] = [], date = today(), nowToday = minOn(date);
    const dates = [date]; if (nowToday >= COVER_V1.advisoryNotBefore - 60) dates.push(tomorrowOf(date));
    for (const dt of dates) sent.push(...await runReminders(hh, dt));
    const cfg = await cfgOf(hh);
    for (const j of await jobsOn(hh, dates)) {
      if (!jobActive(j)) continue;
      const nowM = minOn(j.careDate), before = JSON.stringify(j);
      if (j.state === 'asking' || j.state === 'hold') await runJob(j, nowM);
      if (j.state === 'ff') {
        const r = j.reqId ? (await db.query<{ state: string }>(`select state from friend_requests where id=$1`, [j.reqId]))[0] : null;
        if (r && ['Expired', 'Declined', 'Cancelled'].includes(r.state)) { log(j, nowM, `Friend Finder (${j.reqId}) ended without a yes`); if (!friendFinderOpen(nowM, j.firstDue, cfg)) j.ffSkipped = true; j.reqId = null; await notFound(j, nowM); }
        else if (!r && !friendFinderOpen(nowM, j.firstDue, cfg)) { log(j, nowM, `Friend Finder window closed at ${clock(friendFinderCutoff(j.firstDue, cfg))}`); j.ffSkipped = true; await notFound(j, nowM); }
      }
      if (j.state === 'adhoc' && j.adhoc && nowM >= j.adhoc.at + cfg.adhocLinkMin) { const a = j.asks.find(x => x.personId === j.adhoc!.personId && x.state === 'asked'); if (a) { a.state = 'expired'; log(j, nowM, 'The one-time link expired after 15 min with no reply'); await db.query(`update task_links set revoked_at=$2 where id=$1`, [a.personId, now().toISOString()]); j.state = 'notfound'; } }
      if (j.state === 'notfound' && circleCallDue({ urgencies: j.urgencies, notFoundAt: j.nfAt, acknowledged: j.ack != null, circleCalled: j.circleCalled, now: nowM }, cfg)) {
        j.circleCalled = true; log(j, nowM, 'No acknowledgement in 15 min for a must-happen task: all care-circle members were called');
        const ts = await tasksById(hh, j.careDate, j.taskIds), script = `Nobody is confirmed for ${titles(ts)} (${clock(j.firstDue)}, must happen) and the owner has not responded. Press 1 if you can help. Pawsure is not an emergency service.`;
        for (const m of await db.query<{ phone: string }>(`select u.phone_e164 as phone from memberships m join users u on u.id=m.user_id where m.household_id=$1 and m.status='active' and m.role in ('owner','co_owner','backup','family')`, [hh])) await A.voice.call(m.phone, script);
        for (const b of await backups(hh)) if (!b.user_id) await A.voice.call(b.phone_e164, script);
        await audit(db, 'system', hh, 'cover.circle.called', { job: j.id, note: 'must-happen; owner unacknowledged for 15 min' }); sent.push('circle:' + j.id);
      }
      if (JSON.stringify(j) !== before) await saveJob(j);
    }
    // substitutes not approved in time (D-45)
    for (const l of await db.query<{ id: string }>(`select id from task_links where household_id=$1 and kind='substitute' and approved_at is null and declined_at is null and revoked_at is null and expires_at <= $2`, [hh, now().toISOString()])) await decideSubstitute(hh, l.id, null, 'system');
    // PS-137 checklist reminder at task − 15
    for (const dt of dates) for (const t of ((await db.query(`select 1 from visit_access_checklist c join care_tasks t on t.id=c.task_id where c.household_id=$1 and t.care_date=$2 and c.reminded_at is null limit 1`, [hh, dt])).length ? await dayTasks(hh, dt) : [])) {
      const c = (await db.query<{ gate_approved: boolean; key_plan: string | null; reminded_at: string | null; person_name: string }>(`select * from visit_access_checklist where task_id=$1`, [t.id]))[0];
      if (!c || !t.cover || !['CoveredByReplacement', 'ConfirmedByCaregiver'].includes(t.cover.state) || t.reassignedToTaskId) continue;
      if (checklistReminderDue({ gateApproved: c.gate_approved, keyPlan: c.key_plan as never, reminded: !!c.reminded_at }, t.due, minOn(dt), cfg)) {
        await db.query(`update visit_access_checklist set reminded_at=$2 where task_id=$1`, [t.id, now().toISOString()]);
        await ownerPush(hh, 'Gate and key', `${first(c.person_name)} arrives at ${clock(t.due)}. Still to do: ${[!c.gate_approved ? 'approve them in your gate app' : '', !c.key_plan ? 'choose the key plan' : ''].filter(Boolean).join(' and ')}.`);
        await db.query(`insert into task_cover_event(task_id, household_id, event, state, actor, note, event_time) values ($1,$2,'checklist_reminder',$3,'system','Gate and key checklist not finished (15 min before)',$4)`, [t.id, hh, t.cover.state, now().toISOString()]);
        sent.push('checklist:' + t.id);
      }
    }
    // PS-136 caregiver did not answer the extension in 10 minutes
    for (const x of await db.query<{ id: string; care_date: string; asked: { who: string | null; at: number; reply: string | null } }>(`select id, care_date::text as care_date, asked from delay_extension where household_id=$1 and asked is not null`, [hh]))
      if (x.asked.who && !x.asked.reply && minOn(x.care_date) >= x.asked.at + cfg.extensionReplyMin) await extensionReply(hh, x.id, { kind: 'no_reply' }, 'timeout');
    // PS-135 weekly thin-circle check and advisories for this household's cluster
    const h = await household(hh), week = `${date.slice(0, 4)}-w${Math.ceil((Date.parse(date) - Date.parse(date.slice(0, 4) + '-01-01')) / 604800000)}`;
    if (thinCircle((await contacts(hh)), cfg).thin && await ownerOnce(hh, `thin:${hh}:${week}`, 'Your circle is thin', 'Fewer than 2 people on your backup list hold a key. If your helper can’t come, there may be nobody who can get in. Open Me → Backups.')) sent.push('thin:' + hh);
    for (const a of await db.query<{ id: string; reason: string; for_date: string }>(`select id, reason, for_date::text as for_date from cluster_advisory where (cluster=$1 or cluster='All clusters') and sent_at <= $2`, [h.cluster ?? '', now().toISOString()]))
      if (await ownerOnce(hh, `adv:${a.id}:${hh}`, 'Many helpers may not come tomorrow', renderCover('cluster_advisory', 'en', { reason: a.reason }))) sent.push('advisory:' + a.id);
    return sent;
  }

  /* ================= views ================= */
  async function jobView(j: JobDoc) {
    const hh = j.householdId, cfg = await cfgOf(hh), nowM = minOn(j.careDate), ts = await tasksById(hh, j.careDate, j.allTaskIds);
    const people = await Promise.all([...new Set(j.asks.map(a => a.personId))].map(async id => [id, await person(hh, id)] as const));
    const P = Object.fromEntries(people);
    const asks = j.asks.map(a => ({ ...a, name: P[a.personId]?.name ?? a.personId, holdsKey: !!P[a.personId]?.holdsKey, ownerArranged: !!P[a.personId]?.ownerArranged, firstTime: !!P[a.personId]?.firstTime, until: a.state === 'asked' ? (j.adhoc?.personId === a.personId ? a.at + cfg.adhocLinkMin : (j.roundAt ?? a.at) + (j.mode === 'wide' ? cfg.wideWindowMin : cfg.pairWindowMin)) : null }));
    const opts = notFoundOptions(j.urgencies, { now: nowM, firstDue: j.firstDue, notFoundAt: j.nfAt, acknowledged: j.ack != null, circleAsked: j.circleAsked, circleCalled: j.circleCalled }, cfg);
    let next = '';
    if (j.state === 'await-owner') next = 'Nothing is sent until you tap. “Ask my backups automatically” is off.';
    else if (j.state === 'hold' && j.hold) next = `Hold ends at ${clock(j.hold.at + cfg.holdMin)}${j.urgencies.includes('MustHappen') && j.hold.preApproved ? `, then ${P[j.hold.personId]?.first ?? ''} is confirmed automatically (must-happen task)` : ', then the hold is released'}.`;
    else if (j.state === 'asking') { const end = (j.roundAt ?? nowM) + (j.mode === 'wide' ? cfg.wideWindowMin : cfg.pairWindowMin), more = nextBackupAction({ ...j, asks: j.asks.map(a => a.state === 'asked' ? { ...a, state: 'noreply' as const } : a), round: j.round }, await contacts(hh), end, cfg); next = more.kind === 'ask' ? `At ${clock(end)} the next ${j.mode === 'pairs' ? 'two backups are' : 'people are'} asked.` : friendFinderOpen(end, j.firstDue, cfg) ? `At ${clock(end)} Friend Finder, with your approval (open until ${clock(friendFinderCutoff(j.firstDue, cfg))}).` : `At ${clock(end)} you get the cover-not-found options. Too close to the task for Friend Finder.`; }
    else if (j.state === 'ff') next = `Friend Finder is open until ${clock(friendFinderCutoff(j.firstDue, cfg))}. It sends nothing until you approve.`;
    else if (j.state === 'adhoc' && j.adhoc) next = `Waiting for ${P[j.adhoc.personId]?.first ?? ''}. The one-time link works until ${clock(j.adhoc.at + cfg.adhocLinkMin)}.`;
    else if (j.state === 'stopped') next = 'You stopped the list. Choose the next step.';
    else if (j.state === 'notfound') next = opts.circleCallAt != null ? `Calling your care circle at ${clock(opts.circleCallAt)} if you don’t respond.` : 'Choose what to do.';
    const pet = ts[0] ? (await petName(ts[0].petId)).name : '';
    return {
      id: j.id, careDate: j.careDate, tomorrow: j.careDate !== today(), state: j.state, active: jobActive(j), reason: j.reason, firstDue: j.firstDue, time: clock(j.firstDue), pet, mode: j.mode,
      tasks: ts.map(t => ({ id: t.id, title: t.title, due: t.due, urgency: t.urgency, open: j.taskIds.includes(t.id), cover: t.cover?.state })), asks, hold: j.hold ? { ...j.hold, name: P[j.hold.personId]?.name } : null,
      log: j.log, next, ffSkipped: j.ffSkipped, friendFinderOpen: friendFinderOpen(nowM, j.firstDue, cfg), friendFinderCutoff: friendFinderCutoff(j.firstDue, cfg), requestId: j.reqId,
      options: { ...opts, ffOpen: opts.friendFinder && !j.reqId }, lastCare: ts[0] ? await lastCare(hh, j.careDate, ts[0].petId) : '', notFoundAt: j.nfAt, circleCalled: j.circleCalled, covered: j.covered, part: j.part
    };
  }
  /** Cover line for a task card (shown under the evidence line). */
  function coverLine(t: Task, jobs: JobDoc[], rems: { visit_key: string; sent_at: string; reply: string | null }[], date: string) {
    const c = t.cover; if (!c || t.ev.state === 'Cancelled' || t.reassignedToTaskId) return null;
    const who = c.personKind === 'owner' ? 'You' : first(c.personName ?? '');
    const j = c.jobId ? jobs.find(x => x.id === c.jobId) : undefined, rem = rems.find(r => r.visit_key === (t.visitId ?? t.id) + '|' + c.personId);
    const at = (iso2: string | null | undefined) => iso2 ? clock(minutesOnDay(new Date(iso2), date)) : '';
    switch (c.state) {
      case 'Assigned': return { tone: 'plain', text: rem ? `${who} · reminder sent ${at(rem.sent_at)}, waiting for a reply` : c.personKind === 'owner' ? 'You · when you’re home' : `${who} · assigned` };
      case 'ConfirmedByCaregiver': return { tone: 'ok', text: `${who} · confirmed${c.confirmedAt != null ? ' at ' + clock(c.confirmedAt) : ''}` };
      case 'CoveredByReplacement': return { tone: 'ok', text: `${who} · replacement confirmed${c.confirmedAt != null ? ' at ' + clock(c.confirmedAt) : ''}` };
      case 'AtRisk': return { tone: 'risk', text: `At risk · ${c.reason ?? 'nobody confirmed'}${j?.state === 'await-owner' ? ' · waiting for your tap' : j?.state === 'stopped' ? ' · you stopped the backup list' : !j ? ' · choose what to do' : ''}` };
      case 'AskingBackups': { const cur = j ? j.asks.filter(a => a.state === 'asked').length : 0; return { tone: 'risk', text: `At risk · ${c.reason ?? ''}${j?.hold ? ' · someone said yes, confirm now' : cur ? ` · asking ${cur} ${cur === 1 ? 'person' : 'people'}` : ''}` }; }
      case 'FriendFinder': return { tone: 'risk', text: `At risk · ${c.reason ?? ''} · Friend Finder open until ${clock(friendFinderCutoff(j?.firstDue ?? t.due))}` };
      case 'SubstituteProposed': return { tone: 'risk', text: `Substitute proposed · needs your approval` };
      case 'CoverNotFound': return { tone: 'none', text: c.skipped ? 'Cover not found · you skipped it' : 'Cover not found · choose what to do' };
      case 'OwnerHandling': return { tone: 'plain', text: 'You’re handling it' };
      case 'NoCoverPlanned': return { tone: 'none', text: 'No cover planned' };
      case 'Extended': return { tone: 'risk', text: 'Extended · added because you’re delayed' };
    }
  }
  async function overview(hh: string, date: string) {
    const dates = [date, tomorrowOf(date)], jobs = await jobsOn(hh, dates);
    const rems = await db.query<{ id: string; visit_key: string; care_date: string; recipient_kind: string; sent_at: string; deadline_at: string; reply: string | null; reply_at: string | null }>(`select id, visit_key, care_date::text as care_date, recipient_kind, sent_at, deadline_at, reply, reply_at from reminder where household_id=$1 and care_date = any($2) order by sent_at`, [hh, dates]);
    const lines: Record<string, { tone: string; text: string } | null> = {};
    const tomorrowTasks = (await db.query(`select 1 from task_cover c join care_tasks t on t.id=c.task_id where t.household_id=$1 and t.care_date=$2 and (c.state <> 'Assigned' or exists (select 1 from reminder r where r.household_id=$1 and r.care_date=$2))`, [hh, dates[1]])).length ? await dayTasks(hh, dates[1]!) : [];
    for (const t of await dayTasks(hh, date)) lines[t.id] = coverLine(t, jobs, rems.filter(r => r.care_date === date), date);
    for (const t of tomorrowTasks) lines[t.id] = coverLine(t, jobs, rems.filter(r => r.care_date === dates[1]), dates[1]!);
    const subs = await db.query<{ id: string; name: string; phone_e164: string; task_ids: string[]; proposed_by: string; expires_at: string }>(`select id, name, phone_e164, task_ids, proposed_by, expires_at from task_links where household_id=$1 and kind='substitute' and approved_at is null and declined_at is null and revoked_at is null`, [hh]);
    const h = await household(hh), ds = await dayState(hh, date), bk = await backups(hh);
    const checklists = await db.query<{ task_id: string; person_name: string; gate_approved: boolean; key_plan: string | null; key_note: string | null; reminded_at: string | null }>(`select c.* from visit_access_checklist c join care_tasks t on t.id=c.task_id join task_cover tc on tc.task_id=t.id where c.household_id=$1 and t.care_date = any($2) and tc.state in ('CoveredByReplacement','ConfirmedByCaregiver') and t.reassigned_to_task_id is null`, [hh, dates]);
    const exts = await db.query(`select id, old_return, new_return, created_tasks, asked, result, created_at from delay_extension where household_id=$1 and care_date=$2 order by created_at`, [hh, date]);
    return {
      lines, jobs: await Promise.all(jobs.map(jobView)), reminders: rems,
      tomorrow: tomorrowTasks.map(t => ({ id: t.id, title: t.title, due: t.due, petId: t.petId, cover: t.cover, line: lines[t.id], ev: t.ev })),
      substitutes: await Promise.all(subs.map(async s => { const date2 = (await db.query<{ d: string }>(`select care_date::text as d from care_tasks where id=$1`, [s.task_ids[0]]))[0]!.d; const ts = await tasksById(hh, date2, s.task_ids); return { id: s.id, name: s.name, phone: s.phone_e164, by: first((await helperOf(s.proposed_by))?.name ?? 'Your helper'), tasks: ts.map(t => t.title), time: clock(Math.min(...ts.map(t => t.due))), decideBy: clock(minutesOnDay(new Date(s.expires_at), date2)) }; })),
      checklists: checklists.map(c => ({ taskId: c.task_id, person: c.person_name, gateApproved: c.gate_approved, keyPlan: c.key_plan, keyNote: c.key_note, reminded: !!c.reminded_at })),
      extensions: exts, preDeparture: await preDeparture(hh, date), noCoverPlanned: !!ds?.no_cover_planned, planB: ds?.plan_b ?? null,
      settings: { standingApproval: h.standing_backup_approval, remindTrusted: h.remind_trusted, hotDay: h.hot_day }, thin: thinCircle(bk.map(b => ({ holdsKey: b.holds_key }))),
      keyPlans: [['helper', 'With the helper'], ...bk.filter(b => b.holds_key).map(b => ['named_person:' + b.name, `With ${b.name} (holds a key)`]), ['lockbox', 'Lockbox'], ['owner_returns', 'I’ll be back to open the door']]
    };
  }
  async function metrics(hhs?: string[]) {
    const where = hhs ? 'where household_id = any($1)' : '';
    const rems = await db.query<{ reply: string | null; reply_at: string | null; deadline_at: string; care_date: string }>(`select reply, reply_at, deadline_at, care_date::text as care_date from reminder ${where}`, hhs ? [hhs] : []);
    const jobs = (await db.query<{ doc: JobDoc }>(`select doc from cover_jobs ${where}`, hhs ? [hhs] : [])).map(r => r.doc);
    const days = await db.query<{ n: number; nc: number }>(`select count(*)::int as n, count(*) filter (where no_cover_planned)::int as nc from day_states ${where}`, hhs ? [hhs] : []);
    const deep = await db.query<{ n: number; d: number }>(`select count(*)::int as n, count(*) filter (where k >= 2)::int as d from (select h.id, (select count(*) from backup_contact b where b.household_id=h.id and b.holds_key and b.removed_at is null) as k from households h ${hhs ? 'where h.id = any($1)' : ''}) x`, hhs ? [hhs] : []);
    return coverMetrics({
      reminders: rems.map(r => ({ reply: r.reply, replyAt: r.reply_at ? minutesOnDay(new Date(r.reply_at), r.care_date) : null, deadline: minutesOnDay(new Date(r.deadline_at), r.care_date) })),
      jobs: jobs.map(j => ({ startedAt: j.startedAt, firstDue: j.firstDue, outcome: j.state === 'covered' ? 'covered' : ['owner', 'moved'].includes(j.state) ? 'owner' : j.state === 'nocover' ? 'no_cover' : j.everNotFound || j.state === 'notfound' ? 'not_found' : 'open', resolvedAt: j.coveredAt ?? (['owner', 'moved'].includes(j.state) ? j.ack : null), everNotFound: j.everNotFound })),
      noCoverPlannedDays: days[0]?.nc ?? 0, petDays: days[0]?.n ?? 0, householdsWithTwoKeys: deep[0]?.d ?? 0, newHouseholds: deep[0]?.n ?? 0
    });
  }

  return { hooks, tick, overview, jobView, getJob, ownerAction, friendFinderFor, coveredByFriend, friendCancelledAfterCutoff, decideSubstitute, helperInbound, helperCantCome, ivr, personInbound, reminderReply, linkView, linkAction, preDeparture, preDepartureOption, helperUnavailable, delay, askExtension, extensionReply, tickChecklist, metrics, backups, person, household, ownerOf };
}
export type CoverService = ReturnType<typeof makeCover>;
