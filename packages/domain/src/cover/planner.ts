/** Reminder planner (PS-127), at-risk evaluator (PS-129), backup runner (PS-130), pre-departure check (PS-134), delay planner (PS-136). */
import type { Minutes, TaskType } from '../types.js';
import { aloneWindow } from '../daily.js';
import { COVER_V1, friendFinderOpen, type CoverConfig, type Urgency } from './config.js';
import type { CoverState } from './stateMachine.js';

/* ---------------- PS-127 reminder planner ---------------- */
export type AssigneeKind = 'helper' | 'co_owner' | 'friend' | 'backup' | 'substitute' | 'owner';
export interface ReminderInput {
  /** First task of the visit, in minutes from today's IST midnight (tomorrow's tasks are ≥ 1440). */
  firstDue: Minutes;
  assignee: AssigneeKind;
  /** Helper consent given and check-ins not paused or withdrawn. */
  reachable: boolean;
  trustedMode?: boolean; remindTrusted?: boolean; helperUnavailable?: boolean;
  /** A cluster advisory for this care day sends the reminder the evening before (PS-135). The caller passes it only for the advised day. */
  advisoryAt?: Minutes | null;
  /** When the person last said yes (replacement or friend). A yes inside the reminder window is not asked again. */
  confirmedAt?: Minutes | null;
}
export interface ReminderPlan { send: boolean; at: Minutes; deadline: Minutes; evening: boolean; why: string }

export function planReminder(i: ReminderInput, c: CoverConfig = COVER_V1): ReminderPlan {
  const dayStart = Math.floor(i.firstDue / 1440) * 1440, early = i.firstDue - dayStart < c.earlyTaskBefore;
  let at = early ? dayStart - 1440 + c.eveningReminderAt : i.firstDue - c.reminderLeadMin, evening = early;
  if (i.advisoryAt != null && i.advisoryAt < at) { at = i.advisoryAt; evening = true; }
  const deadline = evening ? at + c.eveningDeadlineMin : i.firstDue - c.confirmDeadlineMin;
  const no = (why: string): ReminderPlan => ({ send: false, at, deadline, evening, why });
  if (i.assignee === 'owner') return no('owner does this task');
  if (!i.reachable) return no('no consented channel');
  if (i.helperUnavailable) return no('helper marked unavailable today');
  if (i.assignee === 'helper' && i.trustedMode && !i.remindTrusted) return no('Trusted Helper mode: reminder is off unless the owner turns it on');
  if (i.confirmedAt != null && i.confirmedAt >= at) return no('already confirmed inside the reminder window');
  return { send: true, at, deadline, evening, why: evening ? (i.advisoryAt != null && at === i.advisoryAt ? 'cluster advisory' : 'task before 10:00: evening before') : '90 minutes before the visit' };
}
/** A reminder sent late (for example to a co-owner assigned an hour before) still gets a fair reply window, never past the task. */
export const reminderDeadline = (plan: ReminderPlan, sentAt: Minutes, firstDue: Minutes, c: CoverConfig = COVER_V1) => Math.max(plan.deadline, Math.min(firstDue, sentAt + 15));

/* ---------------- PS-129 at-risk evaluator ---------------- */
export type ReminderReply = 'yes' | 'cant' | 'substitute' | null;
export type AtRiskReason = 'cant_make_it' | 'cant_come' | 'friend_cancelled' | 'no_reply';
/** At risk when the caregiver says no, a friend cancels, or nobody has confirmed at the deadline (inclusive: exactly at task − 45). */
export function atRiskReason(i: { reply: ReminderReply; saidCantCome?: boolean; friendCancelled?: boolean; reminderSent: boolean; deadline: Minutes; now: Minutes }): AtRiskReason | null {
  if (i.friendCancelled) return 'friend_cancelled';
  if (i.saidCantCome) return 'cant_come';
  if (i.reply === 'cant') return 'cant_make_it';
  if (i.reply === 'yes' || i.reply === 'substitute') return null;
  return i.reminderSent && i.now >= i.deadline ? 'no_reply' : null;
}
export const AT_RISK_TEXT: Record<AtRiskReason, string> = { cant_make_it: 'can’t make it', cant_come: 'said they can’t come', friend_cancelled: 'cancelled', no_reply: 'no reply to the reminder' };

/* ---------------- PS-130 backup runner ---------------- */
export interface BackupContact { id: string; rank: number; holdsKey: boolean; canGiveMedicine: boolean; ownerArranged: boolean; firstTime: boolean }
export type AskState = 'asked' | 'yes' | 'no' | 'noreply' | 'waiting' | 'released' | 'confirmed' | 'closed' | 'expired';
export interface BackupAsk { personId: string; round: number; at: Minutes; state: AskState }
export interface BackupJob {
  mode: 'pairs' | 'wide' | 'circle';
  startedAt: Minutes; firstDue: Minutes;
  /** At least one remaining task needs someone to get in (the owner is out at task time). */
  needsAccess: boolean;
  /** Every remaining task is medicine: only people marked for medicine are asked. */
  medicineOnly: boolean;
  urgencies: Urgency[];
  standingApproval: boolean;
  /** The owner tapped "Ask my backups" for this job (stands in for standing approval). */
  ownerSent: boolean;
  asks: BackupAsk[];
  round: number; roundAt: Minutes | null;
  hold: { personId: string; at: Minutes; reminded: boolean; preApproved: boolean } | null;
  excluded: string[];
  /** Round in which the whole circle was asked (set once the owner taps "Ask my whole care circle" and the ask went out). */
  circleRound?: number | null;
}
export type BackupAction =
  | { kind: 'owner_must_send'; candidates: string[] }
  | { kind: 'ask'; personIds: string[]; windowMin: number; round: number }
  | { kind: 'wait'; until: Minutes }
  | { kind: 'close_round'; personIds: string[] }
  | { kind: 'hold_remind'; personId: string }
  | { kind: 'auto_confirm'; personId: string }
  | { kind: 'release_hold'; personId: string }
  | { kind: 'exhausted'; friendFinder: boolean };

/** Ranked list, capped at 5, key holders first when access is needed, medicine-only tasks to people marked for medicine. */
export function orderBackups(list: BackupContact[], o: { needsAccess: boolean; medicineOnly: boolean; excluded?: string[]; saidNo?: string[] }, c: CoverConfig = COVER_V1): BackupContact[] {
  let out = [...list].sort((a, b) => a.rank - b.rank).slice(0, c.maxBackups).filter(b => !(o.excluded ?? []).includes(b.id) && !(o.saidNo ?? []).includes(b.id));
  if (o.medicineOnly) out = out.filter(b => b.canGiveMedicine);
  if (o.needsAccess) out = [...out.filter(b => b.holdsKey), ...out.filter(b => !b.holdsKey)];
  return out;
}
export const jobMode = (startedAt: Minutes, firstDue: Minutes, c: CoverConfig = COVER_V1): 'pairs' | 'wide' => firstDue - startedAt > c.wideAskAfterMin ? 'wide' : 'pairs';
export const roundWindow = (mode: BackupJob['mode'], c: CoverConfig = COVER_V1) => mode === 'wide' ? c.wideWindowMin : c.pairWindowMin;

/**
 * The single next action for a backup job. The caller applies it, persists the result and calls again
 * until it gets `wait` (idempotent: the same inputs always give the same action).
 */
export function nextBackupAction(job: BackupJob, list: BackupContact[], now: Minutes, c: CoverConfig = COVER_V1): BackupAction {
  if (job.hold) {
    const h = job.hold, must = job.urgencies.includes('MustHappen');
    if (now >= h.at + c.holdMin) return must && h.preApproved ? { kind: 'auto_confirm', personId: h.personId } : { kind: 'release_hold', personId: h.personId };
    if (!h.reminded && now >= h.at + c.holdReminderMin) return { kind: 'hold_remind', personId: h.personId };
    return { kind: 'wait', until: h.reminded ? h.at + c.holdMin : h.at + c.holdReminderMin };
  }
  const asked = job.asks.map(a => a.personId), saidNo = job.asks.filter(a => a.state === 'no').map(a => a.personId);
  const pool = orderBackups(list, { needsAccess: job.needsAccess, medicineOnly: job.medicineOnly, excluded: job.excluded, saidNo: job.mode === 'circle' ? saidNo : asked }, c);
  const exhausted = (): BackupAction => ({ kind: 'exhausted', friendFinder: friendFinderOpen(now, job.firstDue, c) });
  if (!job.standingApproval && !job.ownerSent) return pool.length ? { kind: 'owner_must_send', candidates: pool.map(b => b.id) } : exhausted();
  const current = job.asks.filter(a => a.round === job.round), open = current.filter(a => a.state === 'asked');
  const win = roundWindow(job.mode, c);
  if (job.round > 0 && open.length) {
    if (job.roundAt != null && now >= job.roundAt + win) return { kind: 'close_round', personIds: open.map(a => a.personId) };
    return { kind: 'wait', until: (job.roundAt ?? now) + win };
  }
  const circleDone = job.mode === 'circle' && job.circleRound != null;
  const batch = circleDone ? [] : pool.slice(0, job.mode === 'pairs' ? c.pairSize : pool.length);
  return batch.length ? { kind: 'ask', personIds: batch.map(b => b.id), windowMin: win, round: job.round + 1 } : exhausted();
}

/** PS-135: a circle is thin when fewer than two people on the backup list hold a key. */
export const thinCircle = (list: Pick<BackupContact, 'holdsKey'>[], c: CoverConfig = COVER_V1) => { const keys = list.filter(b => b.holdsKey).length; return { keyHolders: keys, thin: keys < c.thinCircleKeyHolders }; };
/** PS-137: anyone new to this household gets the gate and key checklist. */
export interface AccessChecklist { gateApproved: boolean; keyPlan: 'helper' | 'named_person' | 'lockbox' | 'owner_returns' | null; reminded: boolean }
export const KEY_PLANS = ['helper', 'named_person', 'lockbox', 'owner_returns'] as const;
export const checklistDone = (k: AccessChecklist) => k.gateApproved && k.keyPlan != null;
export const checklistReminderDue = (k: AccessChecklist | null, taskDue: Minutes, now: Minutes, c: CoverConfig = COVER_V1) => !!k && !checklistDone(k) && !k.reminded && now >= taskDue - c.checklistReminderMin && now < taskDue + 60;

/* ---------------- PS-134 pre-departure check ---------------- */
export interface CoverTaskView { id: string; title: string; petName: string; due: Minutes; cover: CoverState; urgency: Urgency; done: boolean; cancelled: boolean; helperUnavailable?: boolean }
export const PRE_DEPARTURE_OPTIONS = ['do_it_before_leaving', 'leave_later', 'take_the_pet', 'own_paid_provider', 'ask_circle_now', 'leave_anyway'] as const;
export type PreDepartureOption = typeof PRE_DEPARTURE_OPTIONS[number];
/** Tasks today with nobody confirmed. A task merely Assigned (reminder not due yet) does not warn, unless the helper is marked unavailable. */
export function preDepartureCheck(tasks: CoverTaskView[], now: Minutes, c: CoverConfig = COVER_V1) {
  const open: CoverState[] = ['AtRisk', 'AskingBackups', 'SubstituteProposed', 'FriendFinder', 'CoverNotFound', 'Extended'];
  const unconfirmed = tasks.filter(t => t.due > now && t.due < 1440 && !t.done && !t.cancelled && (open.includes(t.cover) || (t.cover === 'Assigned' && !!t.helperUnavailable)));
  const first = unconfirmed.length ? Math.min(...unconfirmed.map(t => t.due)) : null;
  return {
    warn: unconfirmed.length > 0, unconfirmed,
    messages: unconfirmed.map(t => `Nobody has accepted ${t.petName}’s ${clock(t.due)} ${t.title.toLowerCase()} yet.`),
    options: [...PRE_DEPARTURE_OPTIONS] as PreDepartureOption[],
    wideAsk: first != null && first - now > c.wideAskAfterMin, wideWindowMin: c.wideWindowMin,
    medicine: unconfirmed.some(t => t.urgency === 'MustHappen')
  };
}
export const clock = (m: Minutes) => { const d = ((m % 1440) + 1440) % 1440, h = Math.floor(d / 60); return `${((h + 11) % 12) + 1}:${String(d % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

/* ---------------- PS-136 delay planner ---------------- */
export interface OwnerRoutineTask { id: string; title: string; type: TaskType; due: Minutes; minMinutes: number; urgency: Urgency }
export interface DelayPlan {
  oldReturn: Minutes; newReturn: Minutes;
  /** Tasks the owner normally does that now fall while they are out. */
  added: OwnerRoutineTask[];
  alone: ReturnType<typeof aloneWindow>;
  medicine: OwnerRoutineTask[];
  /** Nothing new is due: only the plan and return time change, nobody is asked. */
  planOnly: boolean;
  ask: { first: 'current_caregiver' | 'backups'; replies: ['yes', 'only_until', 'cannot'] };
}
export function planDelay(i: { oldReturn: Minutes; newReturn: Minutes; outFrom: Minutes; ownerTasks: OwnerRoutineTask[]; alreadyPlanned: string[]; visitTimes: Minutes[]; aloneLimitHours: number; hasCurrentCaregiver: boolean }): DelayPlan {
  if (i.newReturn <= i.oldReturn) throw new RangeError('The new return time must be later than the current one.');
  const added = i.ownerTasks.filter(t => t.due >= i.oldReturn && t.due < i.newReturn && !i.alreadyPlanned.includes(t.id)).sort((a, b) => a.due - b.due);
  return {
    oldReturn: i.oldReturn, newReturn: i.newReturn, added,
    alone: aloneWindow(i.outFrom, i.newReturn, [...i.visitTimes, ...added.map(t => t.due)], i.aloneLimitHours),
    medicine: added.filter(t => t.type === 'medicine' || t.urgency === 'MustHappen'), planOnly: added.length === 0,
    ask: { first: i.hasCurrentCaregiver ? 'current_caregiver' : 'backups', replies: ['yes', 'only_until', 'cannot'] }
  };
}
export type ExtensionReply = { kind: 'yes' } | { kind: 'only_until'; until: Minutes } | { kind: 'cannot' } | { kind: 'no_reply' };
/** Which added tasks the current caregiver takes; the rest become a request for that part only. A task counts if it can finish by `until`. */
export function splitExtension(added: OwnerRoutineTask[], reply: ExtensionReply): { caregiver: OwnerRoutineTask[]; uncovered: OwnerRoutineTask[] } {
  const caregiver = reply.kind === 'yes' ? added : reply.kind === 'only_until' ? added.filter(t => t.due + t.minMinutes <= reply.until) : [];
  return { caregiver, uncovered: added.filter(t => !caregiver.includes(t)) };
}

/* ---------------- 16.3 metrics ---------------- */
export interface CoverMetricInput { reminders: { reply: string | null; replyAt: Minutes | null; deadline: Minutes }[]; jobs: { startedAt: Minutes; firstDue: Minutes; outcome: 'covered' | 'owner' | 'not_found' | 'open' | 'no_cover'; resolvedAt: Minutes | null; everNotFound: boolean }[]; noCoverPlannedDays: number; petDays: number; householdsWithTwoKeys: number; newHouseholds: number }
const rate = (n: number, d: number) => d ? n / d : null;
export function coverMetrics(i: CoverMetricInput) {
  const replied = i.reminders.filter(r => (r.reply === 'yes' || r.reply === 'cant' || r.reply === 'substitute') && r.replyAt != null && r.replyAt <= r.deadline).length;
  const rescued = i.jobs.filter(j => (j.outcome === 'covered' || j.outcome === 'owner') && j.resolvedAt != null && j.resolvedAt <= j.firstDue);
  const ttc = i.jobs.filter(j => j.outcome === 'covered' && j.resolvedAt != null).map(j => j.resolvedAt! - j.startedAt).sort((a, b) => a - b);
  const notFound = rate(i.jobs.filter(j => j.everNotFound).length, i.jobs.length);
  return {
    preTaskConfirmationRate: rate(replied, i.reminders.length), atRiskRescueRate: rate(rescued.length, i.jobs.length), coverNotFoundRate: notFound,
    coverNotFoundReview: notFound != null && notFound > 0.10,
    timeToCoverMedian: ttc.length ? ttc[Math.floor((ttc.length - 1) / 2)]! : null,
    noCoverPlannedDayRate: rate(i.noCoverPlannedDays, i.petDays), circleDepth: rate(i.householdsWithTwoKeys, i.newHouseholds),
    counts: { reminders: i.reminders.length, replied, atRisk: i.jobs.length, rescued: rescued.length, notFound: i.jobs.filter(j => j.everNotFound).length }
  };
}

/* ---------------- PS-128 replies: "can't come" and a substitute's name and number ---------------- */
const CANT = /(can.?t|cannot|can not|won.?t|will not|not able to|unable to)\s+(come|make it|make|do it)|not coming|\u092f\u0947\u090a \u0936\u0915\u0924 \u0928\u093e\u0939\u0940|\u092f\u0947\u0923\u093e\u0930 \u0928\u093e\u0939\u0940|\u0928\u093e\u0939\u0940 \u092f\u0947\u0923\u093e\u0930|\u091c\u092e\u0923\u093e\u0930 \u0928\u093e\u0939\u0940|\u0928\u0939\u0940\u0902 \u0906 (\u0938\u0915\u0924\u0940|\u0938\u0915\u0924\u093e|\u092a\u093e\u090a\u0901\u0917\u0940|\u092a\u093e\u090a\u0901\u0917\u093e|\u0938\u0915\u0942\u0901\u0917\u0940)|\u0928\u0939\u0940\u0902 \u0906\u090a\u0901\u0917\u0940|yeu shakat nahi|yenar nahi|nahi aa (sakti|paungi|sakta)|nahi aaungi/i;
/** Free text or a voice-note transcript in English, Hindi or Marathi that means "I can't come" (task context only, PS-118). */
export const isCantCome = (text: string) => CANT.test(text.trim());
/** "Lata Pawar 90000 00077" → name and Indian mobile in +91 form, or null when there is no usable number. */
export function parseSubstitute(text: string): { name: string; phone: string } | null {
  const digits = (text.match(/\+?[\d][\d\s-]{8,}\d/) ?? [''])[0];
  const d = digits.replace(/\D/g, ''), ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  if (!/^[6-9]\d{9}$/.test(ten)) return null;
  const name = text.replace(digits, ' ').replace(/[,;:()\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { name: name || 'Substitute', phone: '+91' + ten };
}
