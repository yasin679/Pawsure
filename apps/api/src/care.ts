/** Daily care service: materialise the day's tasks, ingest signals, evaluate trust, run escalation. */
import { createHash } from 'node:crypto';
import type { Db } from '@pawsure/db';
import { uid } from '@pawsure/db';
import {
  evaluateTask, evaluateVisit, escalationState, coveredDay, pointsFor, COVERED_DAY_RULE, RULES_V1,
  aloneWindow, returnCheckNeeded, defaultUrgency, isUrgency, alertGrace, graceFor, COVER_RULE, COVER_LABEL, type CoverState, type Urgency, type CareTask, type CareVisit, type TaskSignal, type VisitSignal, type LifecycleState, type TaskEvaluation, type EscalationState, type TaskOutcome
} from '@pawsure/domain';
import { minutesOnDay, atMinute } from './clock.js';
import type { Adapters } from './adapters.js';

export const audit = (db: Db, actor: string, household: string | null, action: string, detail: unknown) =>
  db.query('insert into audit_log(actor, household_id, action, detail) values ($1,$2,$3,$4)', [actor, household, action, JSON.stringify(detail ?? null)]);

/** Idempotently create today's care tasks + visits from the active routine. The original plan is never rewritten. */
export async function materialiseDay(db: Db, householdId: string, careDate: string) {
  const routine = await db.query<{ id: string; pet_id: string; title: string; task_type: string; due_minute: number; min_minutes: number; escalation_profile: string; visit_slot: string | null; assignee_membership_id: string | null; urgency: string | null }>(
    `select * from routine_tasks where household_id=$1 and enabled and not owner_task and superseded_by is null and effective_from <= $2`, [householdId, careDate]);
  for (const r of routine) {
    const taskId = `${r.id}_${careDate}`;
    let visitId: string | null = null;
    if (r.visit_slot) {
      visitId = `${householdId}_${careDate}_${r.visit_slot}`;
      await db.query(`insert into care_visits(id, household_id, care_date, slot, helper_membership_id) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`, [visitId, householdId, careDate, r.visit_slot, r.assignee_membership_id]);
    }
    const ins = await db.query(`insert into care_tasks(id, household_id, pet_id, routine_task_id, care_date, title, task_type, due_minute, min_minutes, escalation_profile, visit_id, assignee_membership_id, urgency)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (id) do nothing returning id`, [taskId, householdId, r.pet_id, r.id, careDate, r.title, r.task_type, r.due_minute, r.min_minutes, r.escalation_profile, visitId, r.assignee_membership_id, r.urgency]);
    if (ins.length) await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,'Planned','routine',$3)`, [taskId, householdId, 'From routine ' + r.id]);
  }
}

/**
 * v1.4: every care task has a cover row (who is expected), separate from its evidence. Idempotent; friend cover tasks
 * start as Confirmed by caregiver because the friend said yes and the owner confirmed.
 */
export async function ensureCover(db: Db, householdId: string, careDate: string, now: Date) {
  await db.query(`insert into task_cover(task_id, household_id, state, person_kind, person_id, person_name, original_assignee, rule_version, confirmed_at)
    select t.id, t.household_id,
      case when t.assignee_friend_user_id is not null then 'ConfirmedByCaregiver' else 'Assigned' end,
      case when t.assignee_friend_user_id is not null then 'friend' when m.role='helper' then 'helper' when m.role='co_owner' then 'co_owner' else 'owner' end,
      coalesce(t.assignee_friend_user_id, t.assignee_membership_id),
      coalesce(fu.display_name, m.display_label, mu.display_name, 'You'),
      t.assignee_membership_id, $3, case when t.assignee_friend_user_id is not null then $4::timestamptz end
    from care_tasks t left join memberships m on m.id=t.assignee_membership_id left join users mu on mu.id=m.user_id left join users fu on fu.id=t.assignee_friend_user_id
    where t.household_id=$1 and t.care_date=$2 and not exists (select 1 from task_cover c where c.task_id=t.id)
    on conflict (task_id) do nothing`, [householdId, careDate, COVER_RULE, now.toISOString()]);
}
export interface TaskCoverView { state: CoverState; label: string; personKind: string | null; personId: string | null; personName: string | null; originalAssignee: string | null; reason: string | null; lostBy: string | null; confirmedAt: number | null; jobId: string | null; skipped: boolean; handledPre: boolean }

interface Row { [k: string]: unknown }
export interface DayView {
  careDate: string; now: number;
  tasks: (CareTask & { ev: TaskEvaluation; esc: EscalationState | null; points: ReturnType<typeof pointsFor>; urgency: Urgency; cover: TaskCoverView | null; movedFrom: number | null })[];
  visits: Record<string, ReturnType<typeof evaluateVisit> & { id: string }>;
  covered: ReturnType<typeof coveredDay>;
  trusted: boolean;
  day: { mode: string; helperUnavailable: boolean; unavailableReason: string | null; leaving: unknown; leftAt: number | null; returnAt: number; backAt: number | null; returnCheckDone: boolean; returnCheckNeeded: boolean; gateApp: boolean; alone: ReturnType<typeof aloneWindow> };
}

export async function loadDay(db: Db, householdId: string, careDate: string, now: Date): Promise<DayView> {
  await materialiseDay(db, householdId, careDate);
  await ensureCover(db, householdId, careDate, now);
  const nowMin = minutesOnDay(now, careDate);
  const [tasks, events, signals, visits, pets, hh, mode] = await Promise.all([
    db.query<Row>(`select t.*, coalesce(t.urgency, r.urgency) as urgency_set from care_tasks t left join routine_tasks r on r.id=t.routine_task_id where t.household_id=$1 and t.care_date=$2 order by t.due_minute, t.id`, [householdId, careDate]),
    db.query<Row>(`select * from task_events where household_id=$1 and task_id in (select id from care_tasks where household_id=$1 and care_date=$2) order by id`, [householdId, careDate]),
    db.query<Row>(`select * from checkin_signals where household_id=$1 and (task_id in (select id from care_tasks where care_date=$2 and household_id=$1) or visit_id in (select id from care_visits where care_date=$2 and household_id=$1))`, [householdId, careDate]),
    db.query<Row>(`select * from care_visits where household_id=$1 and care_date=$2`, [householdId, careDate]),
    db.query<Row>(`select id from pets where household_id=$1`, [householdId]),
    db.query<Row>(`select rewards_arm, out_from, out_to, alone_limit_hours, gate_app, hot_day from households where id=$1`, [householdId]),
    db.query<Row>(`select * from day_states where household_id=$1 and care_date=$2`, [householdId, careDate])
  ]);
  const coverRows = await db.query<Row>(`select * from task_cover where household_id=$1 and task_id in (select id from care_tasks where household_id=$1 and care_date=$2)`, [householdId, careDate]);
  const coverOf = new Map(coverRows.map(c => [c.task_id as string, c]));
  const urgencyOf = (t: Row): Urgency => isUrgency(t.urgency_set) ? t.urgency_set : defaultUrgency(t.task_type as CareTask['type'], { hotDay: !!hh[0]?.hot_day });
  const helperIds = new Set((await db.query<{ id: string }>(`select id from memberships where household_id=$1 and role='helper'`, [householdId])).map(r => r.id));
  const ds = mode[0] ?? {};
  const trusted = ds.mode === 'trusted';
  const trustedTap = trusted && !!ds.trusted_covered_at;
  const m = (d: unknown) => minutesOnDay(new Date(d as string), careDate);
  const toTaskSignal = (s: Row): TaskSignal => {
    const base = { id: s.id as string, eventTime: m(s.event_time), receivedTime: m(s.received_time), source: s.channel as string };
    switch (s.kind) {
      case 'photo': return { ...base, kind: 'photo', code: (s.photo_code as 'today') ?? 'none', imageHash: s.image_hash as string, duplicate: !!s.duplicate };
      case 'voice': return { ...base, kind: 'voice', namesTask: !!s.names_task };
      case 'ivr': return { ...base, kind: 'ivr', codeOk: !!s.code_ok, afterPrompt: !!s.after_prompt };
      default: return { ...base, kind: 'friend_photo', imageHash: s.image_hash as string, duplicate: !!s.duplicate };
    }
  };
  const domainTasks: CareTask[] = tasks.map(t => ({
    id: t.id as string, petId: t.pet_id as string, title: t.title as string, type: t.task_type as CareTask['type'], due: t.due_minute as number, minMinutes: t.min_minutes as number,
    visitId: (t.visit_id as string) ?? null, assignee: (t.assignee_membership_id as string) ?? 'owner', profile: t.escalation_profile as CareTask['profile'],
    ...(urgencyOf(t) === 'MustHappen' ? { graceOverride: alertGrace('MustHappen', graceFor({ profile: t.escalation_profile as CareTask['profile'] })) } : {}),
    signals: signals.filter(s => s.task_id === t.id).map(toTaskSignal),
    lifecycle: events.filter(e => e.task_id === t.id).map(e => ({ at: m(e.at), state: e.state as LifecycleState, actor: e.actor as string, note: (e.note as string) ?? undefined })),
    returnCheck: (t.return_check as CareTask['returnCheck']) ?? undefined,
    escalation: { ackAt: t.ack_at ? m(t.ack_at) : undefined, ackBy: (t.ack_by as string) ?? undefined, resolvedAt: t.resolved_at ? m(t.resolved_at) : undefined, resolvedNote: (t.resolved_note as string) ?? undefined, forceBackup: !!t.force_backup, coverHandled: !!coverOf.get(t.id as string)?.handled_pre },
    reassignedToTaskId: (t.reassigned_to_task_id as string) ?? undefined
  }));
  const visitEval: DayView['visits'] = {};
  for (const v of visits) {
    const vt = domainTasks.filter(t => t.visitId === v.id);
    const strong = vt.some(t => t.signals.some(s => s.kind === 'photo' && s.code === 'today' && !s.duplicate));
    const cv: CareVisit = { id: v.id as string, who: (v.helper_membership_id as string) ?? '', signals: signals.filter(s => s.visit_id === v.id).map(s => ({ id: s.id as string, kind: s.kind as VisitSignal['kind'], registeredNumber: s.registered_number as boolean | undefined, ownerProvided: !!s.owner_provided, eventTime: m(s.event_time), receivedTime: m(s.received_time), source: s.channel as string })) };
    visitEval[v.id as string] = { id: v.id as string, ...evaluateVisit(cv, vt, strong, nowMin, RULES_V1) };
  }
  let monthEarned = (await db.query<{ n: number }>(`select coalesce(sum(points),0)::int as n from reward_ledger where household_id=$1 and month=$2 and state in ('earned','released') and (task_id is null or task_id not in (select id from care_tasks where household_id=$1 and care_date=$3))`, [householdId, careDate.slice(0, 7), careDate]))[0]?.n ?? 0;
  const out = domainTasks.map(t => {
    const cv0 = coverOf.get(t.id);
    const isHelper = helperIds.has(t.assignee) && !(cv0 && (cv0.lost_by || (cv0.person_kind && cv0.person_kind !== 'helper')));
    const ev = evaluateTask(t, { now: nowMin, visit: t.visitId ? visitEval[t.visitId] ?? null : null, trustedHelperDay: trusted && isHelper, trustedCovered: trustedTap });
    const esc = escalationState(t, ev, nowMin);
    const points = pointsFor(ev.state, { armOn: !!hh[0]?.rewards_arm, isHelperTask: isHelper, monthEarnedInHousehold: monthEarned });
    if (points.kind === 'earn') monthEarned += points.points;
    const c = coverOf.get(t.id), row = tasks.find(r => r.id === t.id)!;
    const cover: TaskCoverView | null = c ? { state: c.state as CoverState, label: COVER_LABEL[c.state as CoverState], personKind: (c.person_kind as string) ?? null, personId: (c.person_id as string) ?? null, personName: (c.person_name as string) ?? null, originalAssignee: (c.original_assignee as string) ?? null, reason: (c.reason as string) ?? null, lostBy: (c.lost_by as string) ?? null, confirmedAt: c.confirmed_at ? m(c.confirmed_at) : null, jobId: (c.job_id as string) ?? null, skipped: !!c.skipped, handledPre: !!c.handled_pre } : null;
    return { ...t, ev, esc, points, urgency: urgencyOf(row), cover, movedFrom: (row.moved_from_minute as number) ?? null };
  });
  const outcomes: TaskOutcome[] = out.map(t => ({ taskId: t.id, petId: t.petId, ev: t.ev, esc: t.esc, trusted: t.ev.state === 'Trusted', cover: t.cover?.state ?? null, coverSkipped: !!t.cover?.skipped }));
  const covered = coveredDay({ petIds: pets.map(p => p.id as string), outcomes, trustedCoveredTap: trustedTap, dayClosed: nowMin >= 1439 });
  const h0 = hh[0] ?? {};
  const outFrom = ds.left_at ? minutesOnDay(new Date(ds.left_at as string), careDate) : (h0.out_from as number) ?? 540;
  const outTo = (ds.return_at as number) ?? (h0.out_to as number) ?? 1140;
  const visitTimes = ds.helper_unavailable ? out.filter(t => !helperIds.has(t.assignee)).map(t => t.due) : out.filter(t => t.ev.state !== 'Cancelled').map(t => t.due);
  const day = {
    mode: (ds.mode as string) ?? 'tracked', helperUnavailable: !!ds.helper_unavailable, unavailableReason: (ds.unavailable_reason as string) ?? null,
    leaving: ds.leaving ?? null, leftAt: ds.left_at ? outFrom : null, returnAt: outTo, backAt: ds.back_at ? minutesOnDay(new Date(ds.back_at as string), careDate) : null,
    returnCheckDone: !!ds.return_check, returnCheckNeeded: returnCheckNeeded(out.map(t => t.ev.state)), gateApp: !!h0.gate_app,
    alone: aloneWindow(outFrom, outTo, visitTimes, (h0.alone_limit_hours as number) ?? 6)
  };
  return { careDate, now: nowMin, tasks: out, visits: visitEval, covered, trusted, day };
}

/** Ingest a helper/friend/IVR/owner signal. Idempotent by key; duplicate image hashes are stored but never count (PRD 10.5). */
export async function ingestSignal(db: Db, p: {
  householdId: string; idempotencyKey: string; kind: 'photo' | 'voice' | 'ivr' | 'friend_photo' | 'call_arrive' | 'call_exit' | 'gate';
  taskId?: string; visitId?: string; channel: string; eventTime: Date; receivedTime: Date; photoCode?: string; imageHash?: string; namesTask?: boolean; codeOk?: boolean; registeredNumber?: boolean; ownerProvided?: boolean; actor: string;
}): Promise<{ status: 'stored' | 'duplicate_event'; duplicateImage?: boolean }> {
  return db.tx(async (t) => {
    const dupEvent = await t.query('select 1 from checkin_signals where idempotency_key=$1', [p.idempotencyKey]);
    if (dupEvent.length) return { status: 'duplicate_event' as const };
    let duplicateImage = false;
    if (p.imageHash) duplicateImage = (await t.query('select 1 from checkin_signals where household_id=$1 and image_hash=$2', [p.householdId, p.imageHash])).length > 0;
    await t.query(`insert into checkin_signals(id, household_id, task_id, visit_id, kind, channel, photo_code, image_hash, duplicate, names_task, code_ok, after_prompt, registered_number, owner_provided, event_time, received_time, idempotency_key)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [uid('sig'), p.householdId, p.taskId ?? null, p.visitId ?? null, p.kind, p.channel, p.photoCode ?? null, p.imageHash ?? null, duplicateImage, p.namesTask ?? null, p.codeOk ?? null, p.kind === 'ivr' ? true : null, p.registeredNumber ?? null, !!p.ownerProvided, p.eventTime.toISOString(), p.receivedTime.toISOString(), p.idempotencyKey]);
    if (p.taskId && !duplicateImage && ['photo', 'voice', 'ivr', 'friend_photo'].includes(p.kind)) {
      const cur = await t.query<{ state: string }>('select state from task_events where task_id=$1 order by id desc limit 1', [p.taskId]);
      if (['Planned', 'Missed', 'Done reported'].includes(cur[0]?.state ?? '')) await t.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,'Done with evidence',$3,$4)`, [p.taskId, p.householdId, p.actor, p.kind]);
    }
    await audit(t, p.actor, p.householdId, 'signal.' + p.kind, { task: p.taskId, visit: p.visitId, duplicateImage, delayedMinutes: Math.round((p.receivedTime.getTime() - p.eventTime.getTime()) / 60000) });
    return { status: 'stored' as const, duplicateImage };
  });
}

export const hashImage = (bytesOrId: string) => 'sha256:' + createHash('sha256').update(bytesOrId).digest('hex').slice(0, 24);

/** Escalation job: send each due step exactly once (dedupe key), create the backup look-in link at step 2. */
export async function runEscalations(db: Db, adapters: Adapters, householdId: string, careDate: string, now: Date) {
  const day = await loadDay(db, householdId, careDate, now);
  const sent: string[] = [];
  for (const t of day.tasks) {
    if (!t.esc) continue;
    for (const st of t.esc.steps) {
      if (!st.fired) continue;
      const key = `esc:${t.id}:${st.n}`;
      const ins = await db.query(`insert into notifications(id, household_id, dedupe_key, recipient, channel, template, payload) values ($1,$2,$3,$4,$5,$6,$7) on conflict (dedupe_key) do nothing returning id`,
        [uid('ntf'), householdId, key, st.n === 2 ? 'backup' : 'owner', st.n === 2 ? 'whatsapp' : 'push', st.kind, JSON.stringify({ task: t.id, title: t.title, due: t.due, visitOnly: !!t.ev.visitOnly })]);
      if (!ins.length) continue;
      sent.push(key);
      if (st.n === 1) await adapters.push.push('owner', 'Check-in missing', `${t.title}: ${t.ev.visitOnly ? 'visit recorded, no task evidence' : 'no evidence yet'}. Tap “I’m on it”.`);
      if (st.n === 2) {
        const backup = await db.query<{ id: string; phone_e164: string }>(`select m.id, u.phone_e164 from memberships m join users u on u.id=m.user_id where m.household_id=$1 and m.role='backup' and m.status='active' limit 1`, [householdId]);
        if (backup[0]) {
          const token = crypto.randomUUID();
          await db.query(`insert into lookin_links(id, household_id, task_id, recipient_membership_id, token_hash, expires_at) values ($1,$2,$3,$4,$5,$6)`, [uid('lk'), householdId, t.id, backup[0].id, createHash('sha256').update(token).digest('hex'), atMinute(careDate, st.at + 15).toISOString()]);
          await adapters.whatsapp.sendTemplate(backup[0].phone_e164, 'LOOKIN-15', 'en', { task: t.title, link: `/l/${token}` });
        }
      }
      if (st.n === 3) await adapters.push.push('owner', 'Find cover?', `Still no evidence for ${t.title}. Ask your friends?`);
      await audit(db, 'system', householdId, 'escalation.step', { task: t.id, step: st.n, at: st.at, delaySec: Math.max(0, Math.round((now.getTime() - atMinute(careDate, st.at).getTime()) / 1000)) });
    }
  }
  return sent;
}
