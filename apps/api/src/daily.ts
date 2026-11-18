/** Phase 2 routes: day flows, routine, helper channel, code cards, look-in, incidents, health, care circle, jobs. */
import type { Hono, Context } from 'hono';
import { z } from 'zod';
import { createHash, randomBytes, randomFillSync, timingSafeEqual } from 'node:crypto';
import { uid, type Db } from '@pawsure/db';
import { applyReturnCheck, checkCode, generateCard, dueSteps, severityOf, healthState, canOpenLookIn, photoSampleRate, COVERED_DAY_RULE, wallet, expiryFor, rightsDue, type LedgerEntry, type CodeCard, type ReturnAnswers, type Severity, type Resource, type Action, type Role } from '@pawsure/domain';
import { isPersonName, NAME_MESSAGE, LANG_CODES, msgLang } from '@pawsure/domain';
import type { Deps } from './app.js';
import { istDate, minutesOnDay, atMinute, istMinutes } from './clock.js';
import { audit, loadDay, ingestSignal, runEscalations, hashImage, materialiseDay } from './care.js';
import { seal, open } from './secrets.js';
import { ProofIn, recordProof, proofMessage } from './proof.js';
import { render, BUTTONS, type Lang } from './templates.js';
import { runRetention, serviceChecks, raiseAlerts, runBackup } from './ops.js';

type Env = { Variables: { userId: string } };
export interface Ctx { cover?: import('./cover.js').CoverService; mon?: import('./ops.js').Monitor; ff?: import('./friends.js').FriendFinder; d: Deps; guard: (c: Context<Env>, hh: string, r: Resource, a: Action) => Promise<Role | null>; deny: (c: Context<Env>) => Response; careDate: (c: Context<Env>) => string }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const TYPE_PROFILE: Record<string, 'standard' | 'medicine' | 'walk'> = { medicine: 'medicine', walk: 'walk' };
const TYPE_MIN: Record<string, number> = { feeding: 5, toilet: 3, medicine: 3, walk: 15, litter: 3, water: 3, other: 5 };

/** Constant-time compare; an unset or empty secret never matches (fail closed). */
export const secretOk = (given: string | undefined, expected: string | undefined) => {
  if (!expected || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function registerDaily(app: Hono<Env>, x: Ctx) {
  // Real vendors must send the shared secret (or, once chosen, their signed header, D-06). Demo mode accepts the simulators.
  const webhookOk = (c: Context<Env>) => x.d.demoMode || secretOk(c.req.header('x-webhook-secret'), process.env.WEBHOOK_SECRET);
  const { db } = x.d; const now = () => x.d.clock.now(); const A = x.d.adapters;
  const upsertDay = (hh: string, date: string, cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return db.query(`insert into day_states(household_id, care_date, ${keys.join(',')}) values ($1,$2,${keys.map((_, i) => '$' + (i + 3)).join(',')})
      on conflict (household_id, care_date) do update set ${keys.map((k, i) => `${k}=$${i + 3}`).join(',')}`, [hh, date, ...keys.map(k => cols[k])]);
  };

  /* ================= Day flows (PS-007, PS-013, PS-014, PS-033, PS-015, PS-016/103, PS-111) ================= */
  app.put('/v1/households/:hh/day', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'task', 'update'))) return x.deny(c);
    const b = z.object({ mode: z.enum(['tracked', 'trusted', 'uncovered', 'friend']).optional(), helperUnavailable: z.boolean().optional(), reason: z.string().max(200).optional() }).parse(await c.req.json());
    const cols: Record<string, unknown> = {};
    if (b.mode) cols.mode = b.mode;
    if (b.helperUnavailable != null) { cols.helper_unavailable = b.helperUnavailable; cols.unavailable_reason = b.reason ?? null; if (b.helperUnavailable) cols.mode = 'uncovered'; }
    await upsertDay(hh, x.careDate(c), cols);
    if (b.helperUnavailable != null && x.cover) await x.cover.helperUnavailable(hh, x.careDate(c), b.helperUnavailable, c.get('userId'));
    await audit(db, c.get('userId'), hh, 'day.updated', { date: x.careDate(c), ...b, note: b.helperUnavailable ? 'original plan preserved' : undefined });
    return c.json({ ok: true });
  });
  app.post('/v1/households/:hh/day/trusted-covered', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'task', 'update'))) return x.deny(c);
    await upsertDay(hh, x.careDate(c), { trusted_covered_at: now().toISOString() });
    await audit(db, c.get('userId'), hh, 'day.trusted_covered', { date: x.careDate(c) });
    return c.json({ ok: true });
  });
  app.post('/v1/households/:hh/day/leaving', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'task', 'update'))) return x.deny(c);
    const b = z.object({ checklist: z.object({ water: z.boolean(), doors: z.boolean(), pads: z.boolean() }).nullable(), returnAt: z.number().int().min(0).max(1439), planB: z.string().max(80).nullable().optional() }).parse(await c.req.json());
    await upsertDay(hh, x.careDate(c), { leaving: JSON.stringify(b.checklist ?? { skipped: true }), left_at: now().toISOString(), return_at: b.returnAt, plan_b: b.planB ?? null });
    await audit(db, c.get('userId'), hh, 'day.leaving', { skipped: !b.checklist, returnAt: b.returnAt });
    return c.json({ ok: true, note: 'Reminder list only, it does not check the home or pet.' });
  });
  app.post('/v1/households/:hh/day/back', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'task', 'update'))) return x.deny(c);
    await upsertDay(hh, x.careDate(c), { back_at: now().toISOString() });
    const day = await loadDay(db, hh, x.careDate(c), now());
    return c.json({ returnCheckNeeded: day.day.returnCheckNeeded });
  });
  app.post('/v1/households/:hh/day/return-check', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'task', 'update'))) return x.deny(c);
    const bit = z.union([z.literal(0), z.literal(1)]);
    const a = z.object({ food: bit, water: bit, pad: bit, pet: bit, damage: bit }).parse(await c.req.json()) as ReturnAnswers;
    const date = x.careDate(c), day = await loadDay(db, hh, date, now());
    const helperIds = new Set((await db.query<{ id: string }>(`select id from memberships where household_id=$1 and role='helper'`, [hh])).map(r => r.id));
    const outcomes = applyReturnCheck(day.tasks.map(t => ({ id: t.id, type: t.type, state: t.ev.state, helperTask: helperIds.has(t.assignee) })), a);
    for (const o of outcomes) {
      if (o.result === 'unchanged') continue;
      const t = day.tasks.find(y => y.id === o.taskId)!;
      if (o.result === 'matched') await db.query(`update care_tasks set return_check=$2 where id=$1`, [t.id, JSON.stringify({ at: day.now, matched: true })]);
      else {
        const caseId = uid('case');
        await db.query(`update care_tasks set return_check=$2, mismatch_case=$3 where id=$1`, [t.id, JSON.stringify({ at: day.now, contradicted: o.what }), caseId]);
        await db.query(`insert into ops_cases(id, household_id, kind, title, notes) values ($1,$2,'dispute',$3,$4)`, [caseId, hh, `Mismatch: ${t.title}`, JSON.stringify([`Return check: ${o.what}. Points held up to 7 days; helper may respond.`])]);
        const helper = (await db.query<{ user_id: string }>(`select user_id from memberships where id=$1`, [t.assignee]))[0];
        if (helper) await db.query(`insert into reward_ledger(id, helper_user_id, household_id, task_id, points, state, reason, month, expires_at) values ($1,$2,$3,$4,5,'held','return_check_mismatch',$5,$6)`, [uid('rw'), helper.user_id, hh, t.id, date.slice(0, 7), new Date(now().getTime() + 7 * 86400000).toISOString()]);
        await helperSay(hh, t.assignee, 'W_DISPUTE', { task: t.title }, t.id, [{ id: 'dispute_explain:' + t.id, label: '🎤 Explain' }]);
      }
    }
    await upsertDay(hh, date, { return_check: JSON.stringify(a) });
    await audit(db, c.get('userId'), hh, 'returncheck.saved', { outcomes: outcomes.filter(o => o.result !== 'unchanged') });
    if (a.pet === 1 || a.damage === 1) return c.json({ outcomes, suggestIncident: true });
    return c.json({ outcomes });
  });

  app.get('/v1/households/:hh/day/timeline', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'timeline', 'read'))) return x.deny(c);
    const date = x.careDate(c), day = await loadDay(db, hh, date, now());
    const m = (t: string) => minutesOnDay(new Date(t), date);
    const ev: { at: number; kind: string; text: string }[] = [];
    for (const t of day.tasks) {
      ev.push({ at: t.due, kind: 'plan', text: `Planned: ${t.title}` });
      t.signals.forEach(s => ev.push({ at: s.eventTime, kind: 'signal', text: `${s.kind === 'photo' ? 'Photo' : s.kind === 'voice' ? 'Voice note' : s.kind === 'ivr' ? 'IVR code' : 'Friend photo'} for ${t.title}${'duplicate' in s && s.duplicate ? ', not counted (reused image)' : ''}${s.receivedTime - s.eventTime > 5 ? `, received ${s.receivedTime - s.eventTime} min late` : ''}` }));
      t.lifecycle.slice(1).forEach(l => ev.push({ at: l.at, kind: l.state === 'Missed' ? 'alert' : 'owner', text: `${t.title} → ${l.state}${l.note ? ' · ' + l.note : ''}` }));
      t.esc?.steps.filter(s => s.fired).forEach(s => ev.push({ at: s.at, kind: 'alert', text: `Escalation: ${s.kind.replace(/_/g, ' ')} (${t.title})` }));
      if (t.escalation.ackAt != null) ev.push({ at: t.escalation.ackAt, kind: 'owner', text: `“I’m on it” for ${t.title}` });
    }
    const vs = await db.query<{ kind: string; event_time: string; registered_number: boolean | null; owner_provided: boolean }>(`select s.* from checkin_signals s join care_visits v on v.id=s.visit_id where v.household_id=$1 and v.care_date=$2`, [hh, date]);
    const VS: Record<string, string> = { call_arrive: 'Arrival missed call', call_exit: 'Exit missed call', gate: 'Gate entry (owner-provided)', code_start: 'Start code photo', code_end: 'End code photo' };
    vs.forEach(s => ev.push({ at: m(s.event_time), kind: 'signal', text: (VS[s.kind] ?? s.kind) + (s.registered_number === false ? ', rejected (unregistered number)' : '') + ((s as { code_ok?: boolean | null }).code_ok === false ? ', code did not match' : '') + ((s as { duplicate?: boolean }).duplicate ? ', not counted (reused image)' : '') }));
    const inc = await db.query<{ severity: string; category: string; reported_at: string }>(`select * from incidents where household_id=$1 and reported_at >= $2 and reported_at < $3`, [hh, atMinute(date, 0).toISOString(), atMinute(date, 1440).toISOString()]);
    inc.forEach(i => ev.push({ at: m(i.reported_at), kind: 'alert', text: `${i.severity} report: ${i.category.replace(/_/g, ' ')}` }));
    if (day.day.leftAt != null) ev.push({ at: day.day.leftAt, kind: 'owner', text: 'You left' });
    if (day.day.backAt != null) ev.push({ at: day.day.backAt, kind: 'owner', text: 'You came back' });
    return c.json(ev.filter(e => e.at <= day.now || e.kind === 'plan').sort((a, b) => a.at - b.at));
  });

  app.get('/v1/households/:hh/day/report', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'timeline', 'read'))) return x.deny(c);
    const date = x.careDate(c), day = await loadDay(db, hh, date, now());
    const earned = day.tasks.reduce((a, t) => a + (t.points.kind === 'earn' ? t.points.points : 0), 0);
    const held = day.tasks.reduce((a, t) => a + (t.points.kind === 'hold' ? t.points.points : 0), 0);
    const health = (await db.query<{ id: string; label: string; next_due: string; pet_id: string }>(`select id, label, next_due::text as next_due, pet_id from health_events where household_id=$1 and acknowledged_at is null order by next_due limit 3`, [hh]));
    const calls = (await db.query<{ n: number }>(`select count(*)::int as n from audit_log where household_id=$1 and action='call.helper' and (detail->>'date')=$2`, [hh, date]))[0]?.n ?? 0;
    return c.json({ date, covered: day.covered, tasks: day.tasks.map(t => ({ id: t.id, title: t.title, petId: t.petId, due: t.due, state: t.ev.state, label: t.ev.label, lifecycle: t.lifecycle.at(-1)?.state })), visits: day.visits, points: { earned, held, rewardsArm: day.tasks.some(t => t.points.kind !== 'none' || t.points.reason !== 'rewards_arm_off') }, callsToHelper: calls, upcomingHealth: health });
  });
  app.post('/v1/households/:hh/day/call-helper', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'alert', 'acknowledge'))) return x.deny(c);
    await audit(db, c.get('userId'), hh, 'call.helper', { date: x.careDate(c) });
    return c.json({ ok: true, note: 'Calls are placed by the phone dialler; Pawsure only logs that you called.' });
  });

  /** Close a day: store PS-111 results with the rule version. Never overwrites a stored result for the same rule version. */
  async function closeDay(hh: string, date: string) {
    const day = await loadDay(db, hh, date, atMinute(date, 1439));
    const owners = new Map<string, string>();
    for (const t of day.tasks.filter(t => t.points.kind === 'earn')) {
      if (!owners.has(t.assignee)) owners.set(t.assignee, (await db.query<{ user_id: string }>(`select user_id from memberships where id=$1`, [t.assignee]))[0]?.user_id ?? '');
      const helperUser = owners.get(t.assignee); if (!helperUser || t.points.kind !== 'earn') continue;
      await db.query(`insert into reward_ledger(id, helper_user_id, household_id, task_id, points, state, reason, month, created_at, expires_at) values ($1,$2,$3,$4,$5,'earned',$6,$7,$8,$9) on conflict do nothing`, [uid('rw'), helperUser, hh, t.id, t.points.points, t.ev.state + ' task', date.slice(0, 7), atMinute(date, 1439).toISOString(), expiryFor(date)]);
    }
    for (const p of day.covered.pets) await db.query(`insert into care_days(household_id, pet_id, care_date, status, rule_version, detail, closed_at) values ($1,$2,$3,$4,$5,$6,now()) on conflict do nothing`, [hh, p.petId, date, p.status, COVERED_DAY_RULE, JSON.stringify(p.why)]);
    return day.covered;
  }
  app.post('/v1/households/:hh/day/close', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'task', 'update'))) return x.deny(c);
    if (!x.d.demoMode) return c.json({ error: 'days_close_automatically_at_midnight' }, 400);
    return c.json(await closeDay(hh, x.careDate(c)));
  });

  /* ================= Routine (PS-010, PS-011) ================= */
  app.get('/v1/households/:hh/routine', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'routine', 'read'))) return x.deny(c);
    return c.json(await db.query(`select r.*, r.effective_from::text as effective_from, m.role as assignee_role from routine_tasks r left join memberships m on m.id=r.assignee_membership_id where r.household_id=$1 and r.superseded_by is null and (r.recurrence <> 'once' or r.effective_from >= $2) order by r.due_minute, r.title`, [hh, istDate(now())]));
  });
  const RoutineIn = z.object({ petId: z.string(), title: z.string({ error: 'Give the task a name.' }).trim().min(1, 'Give the task a name.').max(80, 'Keep the task name under 80 characters.'), type: z.enum(['feeding', 'walk', 'medicine', 'toilet', 'litter', 'water', 'other']), due: z.number().int().min(0).max(1439), minMinutes: z.number().int().min(1).max(60).optional(), assignee: z.enum(['helper', 'owner', 'co_owner']), urgency: z.enum(['CanWait', 'TimeSensitive', 'MustHappen']).optional(), instructions: z.string().max(500).optional(), oneOffToday: z.boolean().optional(), startToday: z.boolean().optional(), enabled: z.boolean().optional() })
    // PAW-008: same rule as the form: a medicine task carries the vet's written instructions.
    .refine(b => b.type !== 'medicine' || !!b.instructions?.trim(), { path: ['instructions'], message: 'Add the vet’s written instructions for a medicine task.' });
  async function writeRoutine(hh: string, userId: string, b: z.infer<typeof RoutineIn>, replaces?: string) {
    const date = istDate(now()); const tomorrow = istDate(new Date(now().getTime() + 86400000));
    const assignee = (await db.query<{ id: string }>(`select id from memberships where household_id=$1 and role=$2 and status in ('active','invited') order by role limit 1`, [hh, b.assignee]))[0]?.id ?? null;
    // startToday: a new home's first routine (sign-up, or Add task on Home) is in today's plan straight away.
    const id = uid('rt'), slot = b.assignee !== 'owner' ? (b.due < 900 ? 'v1' : b.due < 1080 ? 'v2' : 'v3') : null;
    await db.query(`insert into routine_tasks(id, household_id, pet_id, title, task_type, due_minute, min_minutes, recurrence, assignee_membership_id, escalation_profile, instructions, visit_slot, enabled, effective_from, urgency)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [id, hh, b.petId, b.title, b.type, b.due, b.minMinutes ?? TYPE_MIN[b.type], b.oneOffToday ? 'once' : 'daily', assignee, TYPE_PROFILE[b.type] ?? 'standard', b.instructions ?? null, slot, b.enabled ?? true, (b.oneOffToday || b.startToday ? date : tomorrow), b.urgency ?? null]);
    if (replaces) await db.query(`update routine_tasks set superseded_by=$2 where id=$1 and household_id=$3`, [replaces, id, hh]);
    // Added after its time today: it shows as Pending, but raises no alarm and alerts no backup on its first day.
    if (b.startToday && b.due < istMinutes(now())) {
      await materialiseDay(db, hh, date);
      await db.query(`update care_tasks set resolved_at=$2, resolved_note=$3 where routine_task_id=$1 and care_date=$4 and resolved_at is null`, [id, now().toISOString(), 'Added after its time today, so no alert', date]);
    }
    await audit(db, userId, hh, replaces ? 'routine.edited' : 'routine.created', { id, replaces, effectiveFrom: (b.oneOffToday || b.startToday ? date : tomorrow), title: b.title });
    return { id, effectiveFrom: (b.oneOffToday || b.startToday ? date : tomorrow) };
  }
  app.post('/v1/households/:hh/routine', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'routine', 'create'))) return x.deny(c);
    return c.json(await writeRoutine(hh, c.get('userId'), RoutineIn.parse(await c.req.json())), 201);
  });
  app.put('/v1/households/:hh/routine/:id', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'routine', 'update'))) return x.deny(c);
    const old = (await db.query(`select id from routine_tasks where id=$1 and household_id=$2 and superseded_by is null`, [c.req.param('id'), hh]))[0];
    if (!old) return c.json({ error: 'not_found' }, 404);
    return c.json(await writeRoutine(hh, c.get('userId'), RoutineIn.parse(await c.req.json()), c.req.param('id')));
  });

  /* ================= Helper channel (PS-020–029, PS-109, PS-110) ================= */
  async function helperSay(hh: string, membershipId: string, template: Parameters<typeof render>[0], vars: Record<string, string> = {}, taskId?: string, buttons?: { id: string; label: string }[]) {
    const m = (await db.query<{ phone_e164: string; invite_language: string | null; language: string }>(`select u.phone_e164, m.invite_language, u.language from memberships m join users u on u.id=m.user_id where m.id=$1`, [membershipId]))[0];
    if (!m) return;
    const lang = msgLang(m.invite_language ?? m.language);
    const body = render(template, lang, vars);
    await A.whatsapp.sendTemplate(m.phone_e164, template, lang, vars);
    await db.query(`insert into helper_messages(id, household_id, membership_id, direction, template, body, task_id, buttons, at) values ($1,$2,$3,'out',$4,$5,$6,$7,$8)`, [uid('hm'), hh, membershipId, template, body, taskId ?? null, buttons ? JSON.stringify(buttons) : null, now().toISOString()]);
  }
  const btn = (k: keyof typeof BUTTONS, lang: Lang, hh: string) => ({ id: `${k}:${hh}`, label: BUTTONS[k]![lang] });
  const helperLang = async (mid: string): Promise<Lang> => msgLang((await db.query<{ l: string }>(`select coalesce(m.invite_language, u.language) as l from memberships m join users u on u.id=m.user_id where m.id=$1`, [mid]))[0]?.l);
  const consentOf = async (mid: string) => (await db.query<{ granted: boolean; kind: string }>(`select c.granted, c.kind from consent_records c join memberships m on m.user_id=c.user_id and m.household_id=c.household_id where m.id=$1 and c.kind in ('helper_monitoring','helper_withdrawal') order by c.recorded_at desc limit 1`, [mid]))[0];
  async function sendInvite(hh: string, mid: string) {
    const lang = await helperLang(mid);
    const info = (await db.query<{ owner: string; helper: string }>(`select (select u.display_name from memberships o join users u on u.id=o.user_id where o.household_id=$1 and o.role='owner' limit 1) as owner, (select coalesce(m.display_label, u.display_name) from memberships m join users u on u.id=m.user_id where m.id=$2) as helper`, [hh, mid]))[0]!;
    const pets = (await db.query<{ name: string }>(`select name from pets where household_id=$1 order by name`, [hh])).map(p => p.name).join(' & ');
    await helperSay(hh, mid, 'W1_CONSENT', { name: (info.helper ?? '').split(' ')[0] ?? '', owner: (info.owner ?? 'Your employer').split(' ')[0]!, pets: pets || 'the pets' }, undefined,
      [btn('consent_yes', lang, hh), btn('consent_notnow', lang, hh), { id: `lang_mr:${hh}`, label: 'मराठी' }, { id: `lang_hi:${hh}`, label: 'हिन्दी' }, { id: `lang_en:${hh}`, label: 'English' }]);
  }

  /** Owner → "Send reminder" on a task: one WhatsApp nudge to the helper (at most one per task every 15 minutes). */
  app.post('/v1/households/:hh/tasks/:id/remind', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'task', 'update'))) return x.deny(c);
    const day = await loadDay(db, hh, x.careDate(c), now());
    const t = day.tasks.find(y => y.id === c.req.param('id')); if (!t) return c.json({ error: 'not_found' }, 404);
    const hlp = (await db.query<{ id: string; method: string | null; name: string }>(`select m.id, m.method, coalesce(m.display_label, u.display_name) as name from memberships m join users u on u.id=m.user_id where m.household_id=$1 and m.role='helper' and m.status='active' order by (m.id=$2) desc limit 1`, [hh, t.assignee]))[0];
    const cst = hlp ? await consentOf(hlp.id) : null;
    if (!hlp || !cst?.granted || cst.kind === 'helper_withdrawal') return c.json({ error: 'no_helper', message: 'Your helper hasn’t accepted the WhatsApp invite yet, so a reminder can’t be sent.' }, 409);
    const key = `remind:${t.id}:${Math.floor(now().getTime() / 900000)}`;
    const ins = await db.query(`insert into notifications(id, household_id, dedupe_key, recipient, channel, template) values ($1,$2,$3,$4,'whatsapp','W3_PROMPT') on conflict (dedupe_key) do nothing returning id`, [uid('ntf'), hh, key, hlp.id]);
    const first = (hlp.name ?? '').split(' ')[0] || 'your helper';
    if (!ins.length) return c.json({ ok: true, note: `A reminder was already sent to ${first} in the last 15 minutes.` });
    const lang = await helperLang(hlp.id);
    const pet = (await db.query<{ name: string }>(`select name from pets where id=$1`, [t.petId]))[0]?.name ?? '';
    const hhmm = `${((Math.floor(t.due / 60) + 11) % 12) + 1}:${String(t.due % 60).padStart(2, '0')}`;
    await helperSay(hh, hlp.id, 'W3_PROMPT', { pet, task: '⏰ ' + t.title, time: hhmm, how: render(hlp.method === 'voice' ? 'HOW_VOICE' : hlp.method === 'ivr' ? 'HOW_IVR' : 'HOW_PHOTO', lang) }, t.id);
    await audit(db, c.get('userId'), hh, 'task.reminder_sent', { task: t.id, helper: hlp.id });
    return c.json({ ok: true, note: `Reminder sent to ${first} on WhatsApp.` });
  });
  app.get('/v1/households/:hh/helpers', async (c) => {
    const hh = c.req.param('hh'); const role = await x.guard(c, hh, 'helper_consent', 'read'); if (!role) return x.deny(c);
    const rows = await db.query<{ id: string; status: string; method: string | null; paused: boolean; name: string; language: string; invited_at: string }>(`select m.id, m.status, m.method, m.paused, coalesce(m.display_label, u.display_name) as name, coalesce(m.invite_language, u.language) as language, m.invited_at from memberships m join users u on u.id=m.user_id where m.household_id=$1 and m.role='helper'`, [hh]);
    const out = [];
    const mine = role === 'helper' ? (await db.query<{ id: string }>(`select id from memberships where household_id=$1 and user_id=$2 and role='helper'`, [hh, c.get('userId')])).map(m => m.id) : null;
    for (const r of rows) { if (mine && !mine.includes(r.id)) continue; const cst = await consentOf(r.id); out.push({ ...r, consent: !cst ? 'pending' : cst.kind === 'helper_withdrawal' ? 'withdrawn' : cst.granted ? 'yes' : 'notnow' }); }
    return c.json(out);
  });
  app.post('/v1/households/:hh/helpers/invite', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'care_circle', 'create'))) return x.deny(c);
    const b = z.object({ name: z.string().trim().max(60).refine(isPersonName, NAME_MESSAGE), phone: z.string().regex(/^\+91[6-9]\d{9}$/), language: z.enum(LANG_CODES, { error: 'Choose a language from the list.' }) }).parse(await c.req.json());
    let user = (await db.query<{ id: string }>(`select id from users where phone_e164=$1`, [b.phone]))[0];
    if (!user) { user = { id: uid('u') }; await db.query(`insert into users(id, phone_e164, display_name, language) values ($1,$2,$3,$4)`, [user.id, b.phone, b.name, b.language]); }
    const existing = (await db.query<{ id: string }>(`select id from memberships where household_id=$1 and user_id=$2 and role='helper'`, [hh, user.id]))[0];
    const mid = existing?.id ?? uid('m');
    if (!existing) await db.query(`insert into memberships(id, household_id, user_id, role, status, invite_language, display_label) values ($1,$2,$3,'helper','invited',$4,$5)`, [mid, hh, user.id, b.language, b.name]);
    await sendInvite(hh, mid);
    await audit(db, c.get('userId'), hh, 'helper.invited', { membership: mid, language: b.language, note: 'nothing collected until consent' });
    return c.json({ membershipId: mid }, 201);
  });
  app.post('/v1/households/:hh/helpers/:mid/resend', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'care_circle', 'create'))) return x.deny(c);
    await sendInvite(hh, c.req.param('mid')); return c.json({ ok: true });
  });
  app.post('/v1/households/:hh/helpers/:mid/practice', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'care_circle', 'create'))) return x.deny(c);
    await helperSay(hh, c.req.param('mid'), 'W_PRACTICE'); await audit(db, c.get('userId'), hh, 'helper.practice', {}); return c.json({ ok: true, note: 'Practice prompt sent; nothing is recorded as evidence.' });
  });
  /** Helper's WhatsApp thread, for the owner-side simulator in demo mode only (owners never see the helper's chat in production). */
  /* ---------- Proof from the helper's own login (16 Nov): today's tasks and Send proof ---------- */
  app.get('/v1/me/helper/tasks', async (c) => {
    const mems = await db.query<{ id: string; household_id: string; paused: boolean }>(`select id, household_id, paused from memberships where user_id=$1 and role='helper' and status='active'`, [c.get('userId')]);
    const out = [];
    for (const m of mems) {
      const date = istDate(now());
      const tasks = await db.query<{ id: string; title: string; due_minute: number; pet: string }>(`select t.id, t.title, t.due_minute, p.name as pet from care_tasks t join pets p on p.id=t.pet_id where t.household_id=$1 and t.care_date=$2 and t.assignee_membership_id=$3 order by t.due_minute, t.title`, [m.household_id, date, m.id]);
      for (const t of tasks) {
        const ph = await db.query<{ code_result: string }>(`select code_result from evidence_photos where task_id=$1 order by created_at desc limit 1`, [t.id]);
        const sig = (await db.query<{ n: number }>(`select count(*)::int as n from checkin_signals where task_id=$1 and kind in ('photo','voice','ivr')`, [t.id]))[0]!.n;
        out.push({ id: t.id, title: t.title, pet: t.pet, due: t.due_minute, householdId: m.household_id, proofSent: sig > 0, codeResult: ph[0]?.code_result ?? null });
      }
    }
    const cst = mems[0] ? await consentOf(mems[0].id) : null;
    return c.json({ tasks: out, canSend: !!cst?.granted && cst.kind !== 'helper_withdrawal' && !mems[0]?.paused });
  });
  app.post('/v1/me/helper/tasks/:id/proof', async (c) => {
    const proof = ProofIn.parse(await c.req.json().catch(() => ({})));
    const t = (await db.query<{ household_id: string; assignee_membership_id: string | null }>(`select household_id, assignee_membership_id from care_tasks where id=$1`, [c.req.param('id')]))[0];
    const mem = t ? (await db.query<{ id: string; paused: boolean }>(`select id, paused from memberships where id=$1 and user_id=$2 and role='helper' and status='active'`, [t.assignee_membership_id, c.get('userId')]))[0] : undefined;
    if (!t || !mem) return c.json({ error: 'not_found', message: 'This task isn’t yours.' }, 404);
    const cst = await consentOf(mem.id);
    if (!cst?.granted || cst.kind === 'helper_withdrawal' || mem.paused) return c.json({ error: 'no_helper_consent', message: 'Check-ins are stopped. Reply “start” on WhatsApp to begin again.' }, 409);
    if (!proof.photo && !proof.code) return c.json({ error: 'no_proof', message: 'Add a photo or today’s code.' }, 400);
    const r = await recordProof(db, { householdId: t.household_id, taskId: c.req.param('id'), actor: 'helper:' + mem.id, channel: 'app', proof, now: now(), key: `app-proof:${c.req.param('id')}:${mem.id}:${Math.floor(now().getTime() / 60000)}` });
    return c.json({ ok: true, proof: r, message: proofMessage(r) });
  });
  /** The owner and co-owner see the proof photos for a task, with whether the code matched. */
  app.get('/v1/households/:hh/tasks/:id/proof', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'evidence', 'read'))) return x.deny(c);
    const rows = await db.query<{ data_url: string | null; code_result: string; actor: string; channel: string; created_at: string }>(`select data_url, code_result, actor, channel, created_at from evidence_photos where household_id=$1 and task_id=$2 order by created_at`, [hh, c.req.param('id')]);
    const names = async (a: string) => {
      const [kind, id] = a.split(':');
      if (kind === 'helper') return (await db.query<{ n: string }>(`select coalesce(m.display_label, u.display_name, 'Helper') as n from memberships m join users u on u.id=m.user_id where m.id=$1`, [id]))[0]?.n ?? 'Helper';
      if (kind === 'friend') return (await db.query<{ n: string }>(`select coalesce(display_name,'Friend') as n from users where id=$1`, [id]))[0]?.n ?? 'Friend';
      return (await db.query<{ n: string }>(`select name as n from backup_contact where id=$1 union all select name from task_links where id=$1`, [id]))[0]?.n ?? 'Cover';
    };
    return c.json(await Promise.all(rows.map(async r => ({ photo: r.data_url, code: r.code_result, by: await names(r.actor), channel: r.channel, at: r.created_at }))));
  });
  /** Demo only: today's food-box code, so the demo can be tried without the printed card. */
  app.get('/demo/code-today/:hh', async (c) => {
    if (!x.d.demoMode) return c.json({ error: 'not_found' }, 404);
    const card = (await cards(c.req.param('hh'))).find(k => k.active);
    return c.json({ code: card?.codes[Number(istDate(now()).slice(8, 10))] ?? null });
  });

  /** DEMO ONLY: the photo she sent on her (simulated) WhatsApp, stored with the task like any photo evidence,
   *  so the owner sees that same picture on Home and in the review. */
  app.post('/demo/helper-photo/:hh', async (c) => {
    if (!x.d.demoMode) return c.json({ error: 'not_found' }, 404);
    const hh = c.req.param('hh'); const b = z.object({ taskId: z.string(), photo: ProofIn.shape.photo }).parse(await c.req.json());
    const t = (await db.query<{ assignee_membership_id: string | null }>(`select assignee_membership_id from care_tasks where id=$1 and household_id=$2`, [b.taskId, hh]))[0];
    if (!t?.assignee_membership_id) return c.json({ error: 'unknown_task' }, 404);
    const r = await recordProof(db, { householdId: hh, taskId: b.taskId, actor: 'helper:' + t.assignee_membership_id, channel: 'whatsapp', proof: { photo: b.photo ?? null }, now: now(), key: `wa-photo:${b.taskId}:${now().getTime()}` });
    await helperSay(hh, t.assignee_membership_id, 'W_THANKS', {}, b.taskId);
    return c.json({ ok: true, proof: r });
  });
  /** DEMO ONLY: the home's newest helper, so the simulated phone plays whoever the owner invited. */
  app.get('/demo/helper-of/:hh', async (c) => {
    if (!x.d.demoMode) return c.json({ error: 'not_found' }, 404);
    const r = (await db.query<{ mid: string; phone: string; name: string }>(`select m.id as mid, u.phone_e164 as phone, coalesce(m.display_label, u.display_name) as name from memberships m join users u on u.id=m.user_id where m.household_id=$1 and m.role='helper' and m.status in ('invited','active') order by (m.status='active') desc, m.invited_at desc limit 1`, [c.req.param('hh')]))[0];
    return r ? c.json(r) : c.json({ error: 'not_found' }, 404);
  });
  app.get('/demo/helper-thread/:mid', async (c) => {
    if (!x.d.demoMode) return c.json({ error: 'not_found' }, 404);
    return c.json(await db.query(`select direction, template, body, gloss, task_id, buttons, at from helper_messages where membership_id=$1 order by at, id`, [c.req.param('mid')]));
  });

  /* Inbound WhatsApp (BSP webhook): buttons, text, photo, voice. Idempotent; consent-gated; tenant from the template context. */
  app.post('/webhooks/whatsapp', async (c) => {
    if (!webhookOk(c)) return c.json({ error: 'unauthorized_webhook' }, 401);
    const b = z.object({ messageId: z.string(), from: z.string(), type: z.enum(['button', 'text', 'photo', 'voice']), payload: z.string().optional(), text: z.string().max(500).optional(), taskId: z.string().optional(), visitId: z.string().optional(), mediaRef: z.string().optional(), caption: z.string().max(200).optional(), sentAt: z.string().optional() }).parse(await c.req.json());
    const seen = await db.query(`insert into inbound_messages(message_id, channel, payload) values ($1,'whatsapp',$2) on conflict do nothing returning message_id`, ['wa:' + b.messageId, JSON.stringify({ type: b.type })]);
    if (!seen.length) return c.json({ status: 'duplicate_event' });
    const memberships = await db.query<{ id: string; household_id: string; status: string; paused: boolean; method: string | null }>(`select m.id, m.household_id, m.status, m.paused, m.method from memberships m join users u on u.id=m.user_id where u.phone_e164=$1 and m.role='helper' and m.status in ('active','invited')`, [b.from]);
    // v1.4: backups, substitutes and ad-hoc numbers answering a cover request or reminder (PS-128, PS-130, PS-133).
    if (x.cover && !b.payload?.startsWith('ff_') && !b.payload?.startsWith('cover_')) { const cv = await x.cover.personInbound(b); if (cv) return c.json(cv); }
    if (x.ff && (b.payload?.startsWith('ff_') || !memberships.length)) { const r = await x.ff.inbound({ ...b, messageId: b.messageId }); return c.json(r.body, r.status as 200); }
    if (!memberships.length) return c.json({ error: 'unknown_sender' }, 404);
    const hhFromPayload = b.payload?.split(':')[1];
    const taskHh = b.taskId ? (await db.query<{ household_id: string }>(`select household_id from care_tasks where id=$1`, [b.taskId]))[0]?.household_id
      : b.visitId ? (await db.query<{ household_id: string }>(`select household_id from care_visits where id=$1`, [b.visitId]))[0]?.household_id : undefined;
    const mem = memberships.find(m => m.household_id === (hhFromPayload ?? taskHh)) ?? (memberships.length === 1 ? memberships[0] : undefined);
    if (!mem) return c.json({ error: 'ambiguous_household', note: 'Reply to a specific message so we know which home it is for (PS-029).' }, 409);
    const hh = mem.household_id, mid = mem.id, lang = await helperLang(mid);
    const say = async (role: 'in', body: string) => db.query(`insert into helper_messages(id, household_id, membership_id, direction, body, task_id, at) values ($1,$2,$3,$4,$5,$6,$7)`, [uid('hm'), hh, mid, role, body, b.taskId ?? null, now().toISOString()]);
    const recordConsent = (kind: string, granted: boolean, scope?: unknown) => db.query(`insert into consent_records(id, user_id, household_id, kind, version, language, granted, scope) values ($1,(select user_id from memberships where id=$2),$3,$4,'W1-1.0',$5,$6,$7)`, [uid('cr'), mid, hh, kind, lang, granted, scope ? JSON.stringify(scope) : null]);
    const owner = async (title: string, body: string) => A.push.push('owner:' + hh, title, body);

    if (b.type === 'button' || b.type === 'text') {
      const p = (b.payload ?? '').split(':')[0] ?? '';
      const t = (b.text ?? '').trim().toLowerCase();
      await say('in', b.type === 'text' ? b.text ?? '' : p);
      // v1.4: reminder quick replies, "can't come" at any time, substitute name and number, extension replies.
      if (x.cover) { const cv = await x.cover.helperInbound(hh, mid, b); if (cv) return c.json(cv); }
      if (p === 'consent_yes') {
        await recordConsent('helper_monitoring', true, { methods: ['photo', 'voice', 'ivr'], purpose: 'task evidence for this household only' });
        await db.query(`update memberships set status='active', accepted_at=$2 where id=$1`, [mid, now().toISOString()]);
        await helperSay(hh, mid, 'W2_METHOD', {}, undefined, [btn('method_photo', lang, hh), btn('method_voice', lang, hh), btn('method_ivr', lang, hh)]);
        await owner('Helper said Yes', 'They are choosing a check-in method.');
        await audit(db, 'helper:' + mid, hh, 'helper.consent.yes', { language: lang, version: 'W1-1.0' });
      } else if (p === 'consent_notnow') {
        await recordConsent('helper_monitoring', false);
        await helperSay(hh, mid, 'W_NOT_NOW');
        await owner('Helper said “Not now”', 'Nothing will be recorded. You can use Trusted Helper mode or owner-only signals.');
        await audit(db, 'helper:' + mid, hh, 'helper.consent.notnow', {});
      } else if (p.startsWith('lang_')) {
        await db.query(`update memberships set invite_language=$2 where id=$1`, [mid, p.slice(5)]); await sendInvite(hh, mid);
      } else if (p.startsWith('method_')) {
        const method = p.slice(7);
        await db.query(`update memberships set method=$2 where id=$1`, [mid, method]);
        await helperSay(hh, mid, 'W_METHOD_SET', { method: BUTTONS['method_' + method]![lang] });
        await audit(db, 'helper:' + mid, hh, 'helper.method.selected', { method });
      } else if (['change', 'बदलो', 'बदल'].includes(t)) {
        await helperSay(hh, mid, 'W2_METHOD', {}, undefined, [btn('method_photo', lang, hh), btn('method_voice', lang, hh), btn('method_ivr', lang, hh)]);
      } else if (p === 'stop' || ['stop', 'रोको', 'थांबवा'].includes(t)) {
        await recordConsent('helper_withdrawal', false); await db.query(`update memberships set paused=true where id=$1`, [mid]);
        await helperSay(hh, mid, 'W_STOPPED'); await owner('Helper stopped check-ins', 'Nothing new is recorded. Choose Trusted Helper mode or owner-only signals.');
        await audit(db, 'helper:' + mid, hh, 'helper.consent.withdrawn', { note: 'future processing stopped; past records kept per retention' });
      } else if (p === 'start' || ['start', 'शुरू', 'सुरू'].includes(t)) {
        await db.query(`update memberships set paused=false where id=$1`, [mid]); await sendInvite(hh, mid);
      } else if (p.startsWith('problem_')) {
        const category = p.slice(8); const sev: Severity = severityOf(category);
        const id = uid('inc');
        await db.query(`insert into incidents(id, household_id, severity, category, reporter, reported_at) values ($1,$2,$3,$4,$5,$6)`, [id, hh, sev, category, 'helper:' + mid, now().toISOString()]);
        if (sev === 'S1') await db.query(`insert into ops_cases(id, household_id, kind, title, severity) values ($1,$2,'emergency',$3,'S1')`, [uid('case'), hh, `${id} ${category}`]);
        await helperSay(hh, mid, 'W_PROBLEM_ACK', { urgent: sev === 'S3' ? '0' : '1' });
        await audit(db, 'helper:' + mid, hh, 'incident.reported', { id, severity: sev });
        await runIncidents(hh);
      } else if (p === 'support' || t === 'help') {
        await db.query(`insert into ops_cases(id, household_id, kind, title) values ($1,$2,'support','Helper callback')`, [uid('case'), hh]);
        await helperSay(hh, mid, 'W_SUPPORT');
      } else if (['points', 'पॉइंट', 'पॉइंट्स'].includes(t)) {
        const w = await helperWallet(mid, hh);
        await helperSay(hh, mid, 'W_POINTS', { month: String(w.earnedThisMonthByHousehold[hh] ?? 0), available: String(w.available), held: String(w.held), next: String(w.toNextCoupon) });
      } else if (t === 'share' || t === 'share record') {
        const flag = (await db.query<{ default_value: unknown }>(`select default_value from feature_flags where key='helperShareRecord'`))[0]?.default_value;
        if (flag !== true) await helperSay(hh, mid, 'W_SHARE_OFF');
        else {
          const { randomBytes, createHash } = await import('node:crypto');
          const token = randomBytes(18).toString('base64url');
          await db.query(`insert into share_links(id, helper_user_id, token_hash) values ($1,(select user_id from memberships where id=$2),$3)`, [uid('sl'), mid, createHash('sha256').update(token).digest('hex')]);
          await helperSay(hh, mid, 'W_SHARE_LINK', { link: '/r/' + token });
          await audit(db, 'helper:' + mid, hh, 'share_link.created', {});
        }
      } else if (t === 'stop link') {
        await db.query(`update share_links set revoked_at=$2 where helper_user_id=(select user_id from memberships where id=$1) and revoked_at is null`, [mid, now().toISOString()]);
        await helperSay(hh, mid, 'W_SHARE_STOPPED'); await audit(db, 'helper:' + mid, hh, 'share_link.revoked', {});
      } else if (['my data', 'मेरा डेटा', 'माझा डेटा', 'delete my data', 'मेरा डेटा हटाओ', 'माझा डेटा हटवा'].includes(t)) {
        const erase = t.startsWith('delete') || t.endsWith('हटाओ') || t.endsWith('हटवा');
        const id = 'DR-' + uid('x').slice(2, 8).toUpperCase(), due = rightsDue(now().toISOString());
        await db.query(`insert into rights_requests(id, user_id, kind, channel, due_at, legal_due_at, detail) values ($1,(select user_id from memberships where id=$2),$5,'whatsapp',$3,$4,'Asked on WhatsApp')`, [id, mid, due.target, due.legalLimit, erase ? 'erasure' : 'access']);
        // Erasure: stop future processing at once (as “stop” does); deletion itself is reviewed by the privacy lead.
        if (erase) { await recordConsent('helper_withdrawal', false); await db.query(`update memberships set paused=true where id=$1`, [mid]); await owner('Helper asked to delete their data', 'Check-ins are stopped. Choose Trusted Helper mode or owner-only signals.'); }
        await db.query(`insert into ops_cases(id, household_id, kind, title) values ($1,$2,'rights',$3)`, [uid('case'), hh, id + (erase ? ' erasure' : ' access') + ' request (helper)']);
        await helperSay(hh, mid, 'W_MYDATA', { id }); await audit(db, 'helper:' + mid, hh, 'rights.request', { id, channel: 'whatsapp', kind: erase ? 'erasure' : 'access', processingStopped: erase });
      } else if (p === 'dispute_explain') {
        await db.query(`update ops_cases set notes = notes || $2::jsonb where id=(select mismatch_case from care_tasks where id=$1)`, [b.payload?.split(':')[1], JSON.stringify(['Helper responded at ' + now().toISOString()])]);
        await audit(db, 'helper:' + mid, hh, 'dispute.response', {});
      }
      return c.json({ status: 'handled' });
    }

    // photo / voice evidence
    const cst = await consentOf(mid);
    if (!cst || !cst.granted || cst.kind === 'helper_withdrawal' || mem.paused) return c.json({ error: 'no_helper_consent', note: 'Nothing is collected before consent (PS-021)' }, 409);
    if (b.type === 'photo' && b.visitId && !b.taskId) return c.json(await visitCodePhoto(hh, mid, b.visitId, b.caption, b.mediaRef, 'wa:' + b.messageId, b.sentAt ? new Date(b.sentAt) : now(), say));
    if (!b.taskId) return c.json({ error: 'reply_to_a_task_prompt' }, 400);
    const task = (await db.query<{ id: string; assignee_membership_id: string; care_date: string }>(`select id, assignee_membership_id, care_date::text as care_date from care_tasks where id=$1 and household_id=$2`, [b.taskId, hh]))[0];
    if (!task || task.assignee_membership_id !== mid) return c.json({ error: 'unknown_task' }, 404);
    let photoCode: 'today' | 'old' | 'wrong' | 'none' = 'none';
    const typed = b.caption?.match(/\b(\d{4})\b/)?.[1];
    if (b.type === 'photo' && typed) photoCode = checkCode(await cards(hh), Number(task.care_date.slice(8, 10)), typed);
    const r = await ingestSignal(db, { householdId: hh, idempotencyKey: 'wa:' + b.messageId, kind: b.type, taskId: b.taskId, channel: 'whatsapp', photoCode: b.type === 'photo' ? photoCode : undefined, imageHash: b.mediaRef ? hashImage(b.mediaRef) : undefined, namesTask: b.type === 'voice' ? true : undefined, eventTime: b.sentAt ? new Date(b.sentAt) : now(), receivedTime: now(), actor: 'helper:' + mid });
    await say('in', b.type === 'photo' ? `[photo]${b.caption ? ' ' + b.caption.replace(/\d{4}/, '••••') : ''}` : '[voice note]');
    await helperSay(hh, mid, r.duplicateImage ? 'W_REUSED' : photoCode === 'wrong' || photoCode === 'old' ? 'W_WRONG_CODE' : 'W_THANKS', {}, b.taskId);
    return c.json({ ...r, photoCode });
  });

  /* IVR: arrival/exit missed calls and keypad code after a task prompt. */
  app.post('/webhooks/ivr', async (c) => {
    if (!webhookOk(c)) return c.json({ error: 'unauthorized_webhook' }, 401);
    const b = z.object({ callId: z.string(), from: z.string(), event: z.enum(['arrive', 'exit', 'code', 'reminder', 'cant']), visitId: z.string().optional(), taskId: z.string().optional(), digits: z.string().max(8).optional(), at: z.string().optional(), substituteName: z.string().max(60).optional(), substitutePhone: z.string().regex(/^\+91[6-9]\d{9}$/).optional() }).parse(await c.req.json());
    if ((b.event === 'reminder' || b.event === 'cant') && x.cover) {
      // PS-127 basic phone: press 1 / 2 / 3 on the reminder call; press 2 on the missed-call line any time = can't come.
      const seen = await db.query(`insert into inbound_messages(message_id, channel, payload) values ($1,'ivr',$2) on conflict do nothing returning message_id`, ['ivr:' + b.callId + ':' + b.event, JSON.stringify({ digits: b.digits })]);
      if (!seen.length) return c.json({ status: 'duplicate_event' });
      const hlp = (await db.query<{ household_id: string; id: string }>(`select m.household_id, m.id from memberships m join users u on u.id=m.user_id where u.phone_e164=$1 and m.role='helper' and m.status='active'`, [b.from]));
      if (!hlp.length) return c.json({ error: 'unknown_sender' }, 404);
      const mem = hlp.length === 1 ? hlp[0]! : undefined; if (!mem) return c.json({ error: 'ambiguous_household' }, 409);
      return c.json(await x.cover.ivr(mem.household_id, mem.id, b.event, b.digits, b.substituteName && b.substitutePhone ? { name: b.substituteName, phone: b.substitutePhone } : undefined));
    }
    const helper = await db.query<{ household_id: string; id: string; paused: boolean }>(`select m.household_id, m.id, m.paused from memberships m join users u on u.id=m.user_id where u.phone_e164=$1 and m.role='helper' and m.status='active'`, [b.from]);
    const target = b.visitId ? (await db.query<{ household_id: string; care_date: string }>('select household_id, care_date::text as care_date from care_visits where id=$1', [b.visitId]))[0] : b.taskId ? (await db.query<{ household_id: string; care_date: string }>('select household_id, care_date::text as care_date from care_tasks where id=$1', [b.taskId]))[0] : undefined;
    if (!target) return c.json({ error: 'unknown_target' }, 404);
    const mem = helper.find(h => h.household_id === target.household_id);
    if (mem) { const cst = await consentOf(mem.id); if (!cst?.granted || cst.kind === 'helper_withdrawal' || mem.paused) return c.json({ error: 'no_helper_consent' }, 409); }
    // PAW-025: a task's keypad code counts only from the helper the task is assigned to.
    if (mem && b.taskId) { const asg = (await db.query<{ a: string | null }>(`select assignee_membership_id as a from care_tasks where id=$1`, [b.taskId]))[0]?.a; if (asg && asg !== mem.id) return c.json({ error: 'not_your_task' }, 409); }
    let codeOk: boolean | undefined;
    // PAW-021 / PAW-025: a code typed from an unregistered phone never counts, even if it is today's code.
    if (b.event === 'code') codeOk = !!mem && !!b.digits && checkCode(await cards(target.household_id), Number(target.care_date.slice(8, 10)), b.digits) === 'today';
    const r = await ingestSignal(db, { householdId: target.household_id, idempotencyKey: `ivr:${b.callId}:${b.event}`, kind: b.event === 'code' ? 'ivr' : b.event === 'arrive' ? 'call_arrive' : 'call_exit', visitId: b.visitId, taskId: b.taskId, channel: 'ivr', codeOk, registeredNumber: !!mem, eventTime: b.at ? new Date(b.at) : now(), receivedTime: now(), actor: mem ? 'helper:ivr' : 'unregistered' });
    const codeSent = mem && b.visitId && r.status === 'stored' && (b.event === 'arrive' || b.event === 'exit') ? await sendVisitCode(target.household_id, mem.id, b.visitId, b.event === 'arrive' ? 'start' : 'end') : false;
    return c.json({ ...r, registered: !!mem, codeOk, codeSent });
  });

  /* ================= Random start / end codes for a visit (17 Nov 2026) =================
     The arrival and exit calls only prove a call came from her phone, not where she was. Right after each call we send a
     fresh 3-digit code; she writes it on paper and sends a photo of it next to the pet or bowl within 10 minutes. Nobody
     knew the code before the call, so an old or pre-taken photo can't match, and a copied code card doesn't help.
     Only for helpers who check in with photos, on tracked days, once per visit per phase. */
  const randomCode = () => { const n = new Uint32Array(1); randomFillSync(n); return String(100 + (n[0]! % 900)); };
  async function sendVisitCode(hh: string, mid: string, visitId: string, phase: 'start' | 'end'): Promise<boolean> {
    const m = (await db.query<{ method: string | null }>(`select method from memberships where id=$1`, [mid]))[0];
    if (!m || (m.method ?? 'photo') !== 'photo') return false;
    const v = (await db.query<{ care_date: string }>(`select care_date::text as care_date from care_visits where id=$1 and household_id=$2`, [visitId, hh]))[0];
    if (!v) return false;
    const mode = (await db.query<{ mode: string }>(`select mode from day_states where household_id=$1 and care_date=$2`, [hh, v.care_date]))[0]?.mode;
    if (mode === 'trusted') return false;
    const code = randomCode(), col = phase === 'start' ? 'start' : 'end';
    const set = await db.query(`update care_visits set ${col}_code_sealed=$3, ${col}_code_at=$4 where id=$1 and household_id=$2 and ${col}_code_at is null and (helper_membership_id is null or helper_membership_id=$5) returning id`, [visitId, hh, seal(code), now().toISOString(), mid]);
    if (!set.length) return false;
    const pets = (await db.query<{ name: string }>(`select distinct p.name from care_tasks t join pets p on p.id=t.pet_id where t.visit_id=$1 order by p.name`, [visitId])).map(p => p.name).join(' & ');
    await helperSay(hh, mid, phase === 'start' ? 'W_VISIT_CODE_START' : 'W_VISIT_CODE_END', { code, pets: pets || 'the pet' });
    await audit(db, 'system', hh, 'visit.code.sent', { visit: visitId, phase }); // the code itself is never written to the audit log
    return true;
  }
  /** A photo replying to a start / end code. Grades it against the codes sent for that visit (the latest one first). */
  async function visitCodePhoto(hh: string, mid: string, visitId: string, caption: string | undefined, mediaRef: string | undefined, key: string, at: Date, say: (role: 'in', body: string) => Promise<unknown>) {
    const v = (await db.query<{ helper_membership_id: string | null; start_code_sealed: string | null; end_code_sealed: string | null }>(`select helper_membership_id, start_code_sealed, end_code_sealed from care_visits where id=$1 and household_id=$2`, [visitId, hh]))[0];
    if (!v || (v.helper_membership_id && v.helper_membership_id !== mid)) return { error: 'unknown_visit' };
    const start = v.start_code_sealed ? open<string>(v.start_code_sealed) : null, end = v.end_code_sealed ? open<string>(v.end_code_sealed) : null;
    if (!start && !end) return { error: 'no_code_sent' };
    const typed = caption?.match(/\b(\d{3})\b/)?.[1];
    const phase: 'start' | 'end' = typed && typed === end ? 'end' : typed && typed === start ? 'start' : end ? 'end' : 'start';
    const codeOk = !!typed && typed === (phase === 'end' ? end : start);
    const r = await ingestSignal(db, { householdId: hh, idempotencyKey: key, kind: phase === 'start' ? 'code_start' : 'code_end', visitId, channel: 'whatsapp', codeOk, registeredNumber: true, imageHash: mediaRef ? hashImage(mediaRef) : undefined, eventTime: at, receivedTime: now(), actor: 'helper:' + mid });
    await say('in', `[photo]${caption ? ' ' + caption.replace(/\d{3}/, '•••') : ''}`);
    await helperSay(hh, mid, r.duplicateImage ? 'W_REUSED' : codeOk ? 'W_VISIT_CODE_OK' : 'W_VISIT_CODE_WRONG');
    return { ...r, phase, codeOk };
  }

  /* ================= Code cards (PS-024, PS-109). Values never logged or sent in notifications. ================= */
  async function cards(hh: string): Promise<CodeCard[]> {
    const rows = await db.query<{ codes_encrypted: string; active: boolean; month: string; version: number }>(`select * from code_cards where household_id=$1 and month=$2`, [hh, istDate(now()).slice(0, 7)]);
    return rows.map(r => ({ householdId: hh, month: r.month, version: r.version, active: r.active, codes: open<Record<number, string>>(r.codes_encrypted) }));
  }
  async function createCard(hh: string, actor: string, reason?: string) {
    const month = istDate(now()).slice(0, 7), [y, mo] = month.split('-').map(Number), days = new Date(y!, mo!, 0).getDate();
    const prev = await db.query<{ version: number }>(`update code_cards set active=false, rotated_reason=$3 where household_id=$1 and month=$2 and active returning version`, [hh, month, reason ?? 'new card']);
    const version = (await db.query<{ v: number }>(`select coalesce(max(version),0)::int as v from code_cards where household_id=$1 and month=$2`, [hh, month]))[0]!.v + 1;
    const card = generateCard(hh, month, version, days, (n) => randomFillSync(new Uint32Array(n)));
    await db.query(`insert into code_cards(id, household_id, month, version, codes_encrypted) values ($1,$2,$3,$4,$5)`, [uid('cc'), hh, month, version, seal(card.codes)]);
    await audit(db, actor, hh, prev.length ? 'codecard.rotated' : 'codecard.created', { month, version, reason: reason ?? null });
    if (actor === 'system') await A.push.push('owner:' + hh, 'New code card', 'This month’s food-box code card is ready. Print it and put it in the food box.');
    return { month, version, rotated: prev.length > 0 };
  }
  app.post('/v1/households/:hh/code-cards', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'code_card', 'create'))) return x.deny(c);
    const { reason } = z.object({ reason: z.string().max(80).optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await createCard(hh, c.get('userId'), reason), 201);
  });
  app.get('/v1/households/:hh/code-cards/current', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'code_card', 'create'))) return x.deny(c);
    const card = (await cards(hh)).find(k => k.active);
    if (!card) return c.json({ error: 'no_card' }, 404);
    await audit(db, c.get('userId'), hh, 'codecard.viewed', { version: card.version });
    return c.json({ month: card.month, version: card.version, codes: card.codes, today: Number(istDate(now()).slice(8, 10)) });
  });

  /* ================= Look-in link (PS-102): token-scoped, 15 min, logged, address only if authorised ================= */
  async function lookin(token: string) {
    return (await db.query<{ id: string; household_id: string; task_id: string; recipient_membership_id: string; expires_at: string; revoked_at: string | null; status: string; backup_address_authorised: boolean }>(
      `select l.*, m.status, m.backup_address_authorised from lookin_links l join memberships m on m.id=l.recipient_membership_id where l.token_hash=$1`, [sha(token)]))[0];
  }
  app.get('/l/:token', async (c) => {
    const l = await lookin(c.req.param('token'));
    if (!l) return c.json({ error: 'not_found' }, 404);
    const nowMin = now().getTime() / 60000;
    const check = canOpenLookIn({ id: l.id, taskId: l.task_id, recipientId: l.recipient_membership_id, createdAt: 0, expiresAt: new Date(l.expires_at).getTime() / 60000, revoked: !!l.revoked_at, showAddress: l.backup_address_authorised }, l.recipient_membership_id, nowMin, l.status === 'active');
    await db.query(`insert into lookin_opens(link_id, allowed, reason, session_fingerprint) values ($1,$2,$3,$4)`, [l.id, check.ok, check.reason ?? null, sha(c.req.header('user-agent') ?? '').slice(0, 12)]);
    await audit(db, 'lookin:' + l.recipient_membership_id, l.household_id, 'lookin.opened', { link: l.id, allowed: check.ok, reason: check.reason });
    if (!check.ok) return c.json({ error: check.reason }, 410);
    const t = (await db.query<{ title: string; due_minute: number; pet_id: string }>(`select title, due_minute, pet_id from care_tasks where id=$1`, [l.task_id]))[0]!;
    const pet = (await db.query(`select name, species, allergies, medicines, vet_name, vet_phone, clinic24_name, clinic24_phone, notes from pets where id=$1`, [t.pet_id]))[0];
    const hh = (await db.query<{ flat_private: string; tower: string; access_note_private: string }>(`select flat_private, tower, access_note_private from households where id=$1`, [l.household_id]))[0]!;
    return c.json({ task: t, pet, expiresAt: l.expires_at, spareKeyNote: hh.access_note_private, address: l.backup_address_authorised ? `${hh.flat_private}, ${hh.tower}` : null, notice: 'Pawsure is not an emergency service.' });
  });
  app.post('/l/:token/ack', async (c) => {
    const l = await lookin(c.req.param('token'));
    if (!l || l.revoked_at || new Date(l.expires_at) < now() || l.status !== 'active') return c.json({ error: 'expired_or_revoked' }, 410);
    await db.query(`update care_tasks set ack_at=coalesce(ack_at,$2), ack_by=coalesce(ack_by,$3) where id=$1`, [l.task_id, now().toISOString(), 'backup:' + l.recipient_membership_id]);
    await audit(db, 'backup:' + l.recipient_membership_id, l.household_id, 'alert.acknowledged', { task: l.task_id, via: 'lookin' });
    return c.json({ ok: true });
  });

  /* ================= Incidents (PS-036, PS-124) ================= */
  app.get('/v1/households/:hh/incidents', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'incident', 'read'))) return x.deny(c);
    const rows = await db.query<{ id: string; severity: Severity; category: string; reported_at: string; ack_at: string | null; resolved_at: string | null }>(`select * from incidents where household_id=$1 order by reported_at desc limit 20`, [hh]);
    return c.json(rows.map(i => {
      const base = new Date(i.reported_at).getTime() / 60000, nowM = now().getTime() / 60000;
      const inc = { id: i.id, severity: i.severity, category: i.category, reportedAt: 0, ackAt: i.ack_at ? new Date(i.ack_at).getTime() / 60000 - base : undefined, resolvedAt: i.resolved_at ? 1 : undefined };
      const fired = new Set(dueSteps({ ...inc, resolvedAt: undefined }, nowM - base).map(s => s.index));
      const all = dueSteps({ ...inc, ackAt: undefined, resolvedAt: undefined }, 1e9);
      return { ...i, plan: all.map(s => ({ offsetMin: s.step.offset, to: s.step.to, channels: s.step.channels, purpose: s.step.purpose, sent: fired.has(s.index), stopped: !fired.has(s.index) && inc.ackAt != null && inc.ackAt <= s.step.offset && s.step.stopsOnAck })) };
    }));
  });
  app.post('/v1/households/:hh/incidents/:id/ack', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'incident', 'acknowledge'))) return x.deny(c);
    const r = await db.query(`update incidents set ack_at=coalesce(ack_at,$3), ack_by=coalesce(ack_by,$4) where id=$1 and household_id=$2 returning id`, [c.req.param('id'), hh, now().toISOString(), c.get('userId')]);
    if (!r.length) return c.json({ error: 'not_found' }, 404);
    await audit(db, c.get('userId'), hh, 'incident.ack', { id: c.req.param('id') }); return c.json({ ok: true });
  });
  app.post('/v1/households/:hh/incidents/:id/resolve', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'incident', 'update'))) return x.deny(c);
    const { note } = z.object({ note: z.string().trim().min(3, 'A resolution note is required') }).parse(await c.req.json());
    const r = await db.query(`update incidents set resolved_at=$3, resolution_note=$4, ack_at=coalesce(ack_at,$3) where id=$1 and household_id=$2 returning id`, [c.req.param('id'), hh, now().toISOString(), note]);
    if (!r.length) return c.json({ error: 'not_found' }, 404);
    await db.query(`update ops_cases set state='resolved_by_household' where household_id=$1 and title like $2`, [hh, c.req.param('id') + '%']);
    await audit(db, c.get('userId'), hh, 'incident.resolved', { id: c.req.param('id'), note }); return c.json({ ok: true });
  });
  async function runIncidents(hh: string) {
    const open = await db.query<{ id: string; severity: Severity; category: string; reported_at: string; ack_at: string | null }>(`select * from incidents where household_id=$1 and resolved_at is null`, [hh]);
    const sent: string[] = [];
    for (const i of open) {
      const base = new Date(i.reported_at).getTime() / 60000;
      for (const s of dueSteps({ id: i.id, severity: i.severity, category: i.category, reportedAt: 0, ackAt: i.ack_at ? new Date(i.ack_at).getTime() / 60000 - base : undefined }, now().getTime() / 60000 - base)) {
        const key = `inc:${i.id}:${s.index}`;
        const ins = await db.query(`insert into notifications(id, household_id, dedupe_key, recipient, channel, template, payload) values ($1,$2,$3,$4,$5,$6,$7) on conflict (dedupe_key) do nothing returning id`, [uid('ntf'), hh, key, s.step.to, s.step.channels.join('+'), 'INC-' + s.step.purpose, JSON.stringify({ incident: i.id, severity: i.severity })]);
        if (!ins.length) continue;
        sent.push(key);
        if (s.step.channels.includes('call')) await A.voice.call(s.step.to, `${i.severity} ${i.category.replace(/_/g, ' ')}. Press 1 if you are on it.`);
        if (s.step.channels.includes('whatsapp')) await A.whatsapp.sendTemplate(s.step.to, 'INC-' + s.step.purpose, 'en', { category: i.category });
      }
    }
    return sent;
  }

  /* ================= Health calendar (PS-040, PS-041, PS-046) ================= */
  app.get('/v1/households/:hh/health', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'pet', 'read'))) return x.deny(c);
    const today = istDate(now());
    const rows = await db.query<{ id: string; pet_id: string; kind: string; label: string; given_on: string | null; next_due: string | null; source: string; snoozed_until: string | null; acknowledged_at: string | null }>(`select id, pet_id, kind, label, given_on::text as given_on, next_due::text as next_due, source, snoozed_until::text as snoozed_until, acknowledged_at from health_events where household_id=$1 order by next_due nulls last`, [hh]);
    return c.json(rows.map(r => ({ ...r, state: healthState(r.next_due, today, { done: !!r.acknowledged_at, snoozedUntil: r.snoozed_until }) })));
  });
  const HealthIn = z.object({ petId: z.string(), kind: z.enum(['vaccine', 'deworming', 'medication', 'followup', 'checkup']), label: z.string().min(1).max(100), givenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), nextDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), source: z.enum(['Owner-entered', 'Copied from vet card', 'Vet instruction (owner-entered)']) });
  app.post('/v1/households/:hh/health', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'pet', 'update'))) return x.deny(c);
    const b = HealthIn.parse(await c.req.json()); const id = uid('he');
    await db.query(`insert into health_events(id, household_id, pet_id, kind, label, given_on, next_due, source) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, hh, b.petId, b.kind, b.label, b.givenOn ?? null, b.nextDue ?? null, b.source]);
    await audit(db, c.get('userId'), hh, 'health.created', { id }); return c.json({ id }, 201);
  });
  app.post('/v1/households/:hh/health/:id/:action{done|snooze}', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'pet', 'update'))) return x.deny(c);
    const action = c.req.param('action');
    if (action === 'done') await db.query(`update health_events set acknowledged_at=$3 where id=$1 and household_id=$2`, [c.req.param('id'), hh, now().toISOString()]);
    else await db.query(`update health_events set snoozed_until=$3 where id=$1 and household_id=$2`, [c.req.param('id'), hh, istDate(new Date(now().getTime() + 86400000))]);
    await audit(db, c.get('userId'), hh, 'health.' + action, { id: c.req.param('id') }); return c.json({ ok: true });
  });
  async function runHealth(hh: string) {
    const today = istDate(now()); const sent: string[] = [];
    const rows = await db.query<{ id: string; label: string; next_due: string | null; snoozed_until: string | null; acknowledged_at: string | null }>(`select id, label, next_due::text as next_due, snoozed_until::text as snoozed_until, acknowledged_at from health_events where household_id=$1`, [hh]);
    for (const r of rows) {
      const st = healthState(r.next_due, today, { done: !!r.acknowledged_at, snoozedUntil: r.snoozed_until });
      if (!['due_soon', 'due', 'overdue'].includes(st)) continue;
      const key = `health:${r.id}:${st}`;
      const ins = await db.query(`insert into notifications(id, household_id, dedupe_key, recipient, channel, template, payload) values ($1,$2,$3,'owner','push','HEALTH-REMINDER',$4) on conflict (dedupe_key) do nothing returning id`, [uid('ntf'), hh, key, JSON.stringify({ label: r.label, state: st })]);
      if (ins.length) { sent.push(key); await A.push.push('owner:' + hh, 'Health reminder', `${r.label}: ${st.replace('_', ' ')}. Pawsure only reminds, follow your vet’s advice.`); }
    }
    return sent;
  }

  /* ================= Care circle (PS-005): invite, accept, revoke (effective on the next request; links revoked at once) ================= */
  app.get('/v1/households/:hh/circle', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'care_circle', 'read'))) return x.deny(c);
    return c.json(await db.query(`select m.id, m.role, m.status, m.backup_address_authorised, coalesce(m.display_label, u.display_name) as name, m.invited_at, m.accepted_at, m.revoked_at from memberships m join users u on u.id=m.user_id where m.household_id=$1 order by m.role, name`, [hh]));
  });
  app.post('/v1/households/:hh/circle/invite', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'care_circle', 'create'))) return x.deny(c);
    const b = z.object({ name: z.string().trim().max(60).refine(isPersonName, NAME_MESSAGE), phone: z.string().regex(/^\+91[6-9]\d{9}$/), role: z.enum(['co_owner', 'backup', 'family', 'viewer']), addressAuthorised: z.boolean().optional() }).parse(await c.req.json());
    let user = (await db.query<{ id: string }>(`select id from users where phone_e164=$1`, [b.phone]))[0];
    if (!user) { user = { id: uid('u') }; await db.query(`insert into users(id, phone_e164, display_name) values ($1,$2,$3)`, [user.id, b.phone, b.name]); }
    const mid = uid('m');
    await db.query(`insert into memberships(id, household_id, user_id, role, status, display_label, backup_address_authorised) values ($1,$2,$3,$4,'invited',$5,$6) on conflict (household_id, user_id, role) do update set status='invited', revoked_at=null`, [mid, hh, user.id, b.role, b.name, !!b.addressAuthorised]);
    await A.whatsapp.sendTemplate(b.phone, 'CIRCLE-INVITE', 'en', { role: b.role });
    await audit(db, c.get('userId'), hh, 'circle.invited', { role: b.role }); return c.json({ ok: true }, 201);
  });
  app.get('/v1/invitations', async (c) => c.json(await db.query(`select m.id, m.role, h.society from memberships m join households h on h.id=m.household_id where m.user_id=$1 and m.status='invited' and m.role <> 'helper'`, [c.get('userId')])));
  app.post('/v1/invitations/:mid/accept', async (c) => {
    const r = await db.query(`update memberships set status='active', accepted_at=$3 where id=$1 and user_id=$2 and status='invited' and role <> 'helper' returning household_id`, [c.req.param('mid'), c.get('userId'), now().toISOString()]);
    if (!r.length) return c.json({ error: 'not_found' }, 404);
    await audit(db, c.get('userId'), (r[0] as { household_id: string }).household_id, 'circle.accepted', { membership: c.req.param('mid') }); return c.json({ ok: true });
  });
  app.post('/v1/households/:hh/circle/:mid/revoke', async (c) => {
    const hh = c.req.param('hh'); if (!(await x.guard(c, hh, 'care_circle', 'delete'))) return x.deny(c);
    const started = Date.now();
    const r = await db.query<{ role: string }>(`update memberships set status='revoked', revoked_at=$3 where id=$1 and household_id=$2 and role <> 'owner' returning role`, [c.req.param('mid'), hh, now().toISOString()]);
    if (!r.length) return c.json({ error: 'not_found' }, 404);
    const links = await db.query(`update lookin_links set revoked_at=$2 where recipient_membership_id=$1 and revoked_at is null returning id`, [c.req.param('mid'), now().toISOString()]);
    const ms = Date.now() - started;
    await audit(db, c.get('userId'), hh, 'circle.revoked', { membership: c.req.param('mid'), lookinLinksRevoked: links.length, ms });
    return c.json({ ok: true, channels: [{ name: 'App access', ms }, { name: 'WhatsApp alerts', ms }, { name: `Open look-in links (${links.length})`, ms }], targetSeconds: 60 });
  });

  /* ================= Jobs: every minute, idempotent ================= */
  async function runPrompts(hh: string, date: string) {
    const day = await loadDay(db, hh, date, now());
    if (day.day.mode === 'trusted' || day.day.helperUnavailable) return [];
    const sent: string[] = [];
    const helpers = await db.query<{ id: string; method: string | null; paused: boolean }>(`select id, method, paused from memberships where household_id=$1 and role='helper' and status='active'`, [hh]);
    // Random photo check (PS-026, scenario #5): 1 in 5 tasks without a gate app or after a recent mismatch, else 1 in 10.
    // Chosen with a server secret so the helper can't predict it; only for helpers who don't already send photos.
    const recentMismatch = (await db.query(`select 1 from care_tasks where household_id=$1 and mismatch_case is not null and care_date >= $2 limit 1`, [hh, new Date(Date.parse(date) - 14 * 86400000).toISOString().slice(0, 10)])).length > 0;
    const every = Math.round(1 / photoSampleRate({ gateApp: day.day.gateApp, mismatchInLast14Days: recentMismatch }));
    const sampled = (taskId: string) => createHash('sha256').update(x.d.pepper + ':photo:' + taskId).digest().readUInt32BE(0) % every === 0;
    for (const hlp of helpers) {
      const cst = await consentOf(hlp.id); if (!cst?.granted || cst.kind === 'helper_withdrawal' || hlp.paused) continue;
      const lang = await helperLang(hlp.id);
      // v1.4: no prompts for a visit the helper said she can't make, or that someone else now covers (PS-128).
      for (const t of day.tasks.filter(y => y.assignee === hlp.id && day.now >= y.due - 10 && y.ev.state !== 'Cancelled' && !(y.cover && (y.cover.lostBy || (y.cover.personKind && y.cover.personKind !== 'helper'))))) {
        const key = `prompt:${t.id}`;
        const ins = await db.query(`insert into notifications(id, household_id, dedupe_key, recipient, channel, template) values ($1,$2,$3,$4,'whatsapp','W3_PROMPT') on conflict (dedupe_key) do nothing returning id`, [uid('ntf'), hh, key, hlp.id]);
        if (!ins.length) continue;
        const pet = (await db.query<{ name: string }>(`select name from pets where id=$1`, [t.petId]))[0]?.name ?? '';
        const photoCheck = hlp.method !== 'photo' && sampled(t.id);
        const how = render(hlp.method === 'voice' ? 'HOW_VOICE' : hlp.method === 'ivr' ? 'HOW_IVR' : 'HOW_PHOTO', lang) + (photoCheck ? ' ' + render('PHOTO_SAMPLE', lang) : '');
        if (photoCheck) await audit(db, 'system', hh, 'prompt.photo_sample', { task: t.id, every });
        const hhmm = `${((Math.floor(t.due / 60) + 11) % 12) + 1}:${String(t.due % 60).padStart(2, '0')}`;
        await helperSay(hh, hlp.id, 'W3_PROMPT', { pet, task: t.title, time: hhmm, how }, t.id);
        sent.push(key);
      }
    }
    return sent;
  }
  async function helperWallet(mid: string, hh: string) {
    const rows = await db.query<{ points: number; state: string; month: string; created_at: string; expires_at: string | null; household_id: string }>(`select points, state, month, created_at, expires_at, household_id from reward_ledger where helper_user_id=(select user_id from memberships where id=$1)`, [mid]);
    const live = await loadDay(db, hh, istDate(now()), now());
    const today = live.tasks.filter(t => t.assignee === mid && t.points.kind === 'earn').reduce((a, t) => a + (t.points.kind === 'earn' ? t.points.points : 0), 0);
    const w = wallet(rows.map(r => ({ points: r.points, state: r.state as LedgerEntry['state'], month: r.month, createdAt: r.created_at, expiresAt: r.expires_at, householdId: r.household_id })), istDate(now()));
    // Today's points are shown live; they are written to the ledger when the day closes.
    w.earnedThisMonthByHousehold[hh] = (w.earnedThisMonthByHousehold[hh] ?? 0) + today; w.available += today; w.toNextCoupon = 500 - (w.available % 500);
    return w;
  }
  async function weeklyPoints(hh: string, date: string) {
    const d = new Date(date + 'T00:00:00Z'); if (d.getUTCDay() !== 0 || minutesOnDay(now(), date) < 18 * 60) return [];
    const arm = (await db.query<{ rewards_arm: boolean }>(`select rewards_arm from households where id=$1`, [hh]))[0]?.rewards_arm; if (!arm) return [];
    const week = date; const out: string[] = [];
    for (const h of await db.query<{ id: string }>(`select id from memberships where household_id=$1 and role='helper' and status='active' and not paused`, [hh])) {
      const key = `weekly:${h.id}:${week}`;
      if ((await db.query(`select 1 from audit_log where action='rewards.weekly' and detail->>'key'=$1`, [key])).length) continue;
      const since = new Date(d.getTime() - 6 * 86400000).toISOString().slice(0, 10);
      const pts = (await db.query<{ n: number }>(`select coalesce(sum(points),0)::int as n from reward_ledger where household_id=$1 and helper_user_id=(select user_id from memberships where id=$2) and state in ('earned','released') and created_at >= $3`, [hh, h.id, since]))[0]!.n;
      const w = await helperWallet(h.id, hh);
      await helperSay(hh, h.id, 'W_WEEKLY', { week: String(pts), available: String(w.available) });
      await audit(db, 'system', hh, 'rewards.weekly', { key }); out.push(key);
    }
    return out;
  }
  const tick = async () => {
    const t0 = performance.now();
    const hhs = await db.query<{ id: string }>('select id from households');
    const date = istDate(now()); const sent: string[] = [];
    if (x.ff) await x.ff.tick();
    for (const h of hhs) {
      if (!(await cards(h.id)).some(k => k.active)) await createCard(h.id, 'system', 'monthly card');
      if (x.cover) sent.push(...await x.cover.tick(h.id));
      sent.push(...await runPrompts(h.id, date));
      sent.push(...await runEscalations(db, A, h.id, date, now()));
      sent.push(...await runIncidents(h.id));
      sent.push(...await runHealth(h.id));
      sent.push(...await weeklyPoints(h.id, date));
      if (minutesOnDay(now(), date) >= 1439) await closeDay(h.id, date);
    }
    await runRetention(db, now());
    if (minutesOnDay(now(), date) >= 120) await runBackup(db, now()).catch(e => audit(db, 'system', null, 'backup.failed', { error: (e as Error).message }));
    if (x.mon) { x.mon.tickDone(performance.now() - t0); sent.push(...(await raiseAlerts(db, A, await serviceChecks(db, x.mon, now(), x.d.demoMode))).map(k => 'monitor:' + k)); }
    return sent;
  };
  const jobAuth = (c: Context<Env>) => x.d.demoMode || secretOk(c.req.header('x-job-secret'), process.env.JOB_SECRET);
  app.post('/jobs/tick', async (c) => jobAuth(c) ? c.json({ sent: await tick() }) : c.json({ error: 'forbidden' }, 403));
  app.post('/jobs/backup', async (c) => jobAuth(c) ? c.json((await runBackup(db, now(), { force: true })) ?? { skipped: 'Set BACKUP_DIR and BACKUP_KEY (PGlite deployments only)' }) : c.json({ error: 'forbidden' }, 403));
  app.post('/jobs/escalations', async (c) => jobAuth(c) ? c.json({ sent: await tick() }) : c.json({ error: 'forbidden' }, 403));
}
