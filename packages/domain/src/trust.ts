/**
 * Trust / confidence engine — PRD 5.1, 10.5 (rule set v1), PS-030, PS-122.
 * Pure functions. Visit status and task status are computed separately; a visit alone never makes a task Confirmed or Likely.
 */
import type { CareTask, CareVisit, Confidence, Minutes, ReasonedResult, TaskSignal, VisitSignal, VisitStatus } from './types.js';

export interface TrustRules {
  version: string;
  /** Evidence window opens this many minutes before due. */
  windowBefore: number;
  /** Grace after due, by escalation profile (PRD 10.4 / PS-101). */
  grace: { standard: number; medicine: number; walk: number };
  /** Late evidence accepted (and labelled late) for this many minutes after grace. */
  lateAccept: number;
  /** Visit minimum is the sum of task minimums, capped here. */
  visitMinCap: number;
  /** An arrival without exit is "in progress" for this long before it counts as "one call only". */
  inProgressFor: number;
  /** The photo with the random start / end code must arrive within this many minutes of the code being sent. */
  visitCodeWithin: number;
}

export const RULES_V1: TrustRules = {
  version: 'confidence-v1',
  windowBefore: 30,
  grace: { standard: 30, medicine: 15, walk: 45 },
  lateAccept: 180,
  visitMinCap: 30,
  inProgressFor: 45,
  visitCodeWithin: 10
};

/** Random in-app photo prompt rate (PRD 10.5): 1 in 10 visits; 1 in 5 without a gate app or after a mismatch in the last 14 days. */
export const photoSampleRate = (o: { gateApp: boolean; mismatchInLast14Days: boolean }) => (!o.gateApp || o.mismatchInLast14Days ? 1 / 5 : 1 / 10);

export const graceFor = (t: Pick<CareTask, 'profile'> & { graceOverride?: number }, r: TrustRules = RULES_V1) => t.graceOverride ?? r.grace[t.profile];

export function minVisitDuration(tasks: Pick<CareTask, 'minMinutes'>[], r: TrustRules = RULES_V1): number {
  return Math.min(r.visitMinCap, tasks.reduce((a, t) => a + t.minMinutes, 0));
}

/** ok: right code in time · late: right code after the window · wrong: a code that doesn't match · waiting: sent, still in time · missing: sent, nothing came. */
export type VisitCodeState = 'ok' | 'late' | 'wrong' | 'waiting' | 'missing';

export interface VisitEvaluation {
  status: VisitStatus | null;
  arrive: Minutes | null;
  exit: Minutes | null;
  duration: number | null;
  minimum: number;
  callsOk: boolean;
  gate: boolean;
  /** Random codes sent at the arrival and exit calls; null = not sent (no call yet, or not a photo helper). */
  codes: { start: VisitCodeState | null; end: VisitCodeState | null };
  reasons: string[];
}

function codeState(sentAt: Minutes | undefined, sigs: VisitSignal[], now: Minutes, r: TrustRules): VisitCodeState | null {
  if (sentAt == null) return null;
  const after = sigs.filter(s => !s.duplicate && s.eventTime >= sentAt);
  if (after.some(s => s.codeOk && s.eventTime <= sentAt + r.visitCodeWithin)) return 'ok';
  if (after.some(s => s.codeOk === false)) return 'wrong';
  if (after.some(s => s.codeOk)) return 'late';
  return now <= sentAt + r.visitCodeWithin ? 'waiting' : 'missing';
}
const CODE_REASON: Record<VisitCodeState, string> = {
  ok: 'CODE-OK: photo with the code arrived in time', late: 'CODE-LATE: photo with the code arrived after the time limit',
  wrong: 'CODE-WRONG: the code in the photo does not match', waiting: 'CODE-WAITING: code sent, photo not in yet', missing: 'CODE-MISSING: code sent, no photo came'
};

/** Visit status from registered arrival/exit calls and owner-provided gate entries only. */
export function evaluateVisit(visit: CareVisit, visitTasks: CareTask[], hasStrongTaskEvidence: boolean, now: Minutes, r: TrustRules = RULES_V1): VisitEvaluation {
  const ok = visit.signals.filter(s => (s.kind === 'gate') || s.registeredNumber !== false);
  const arrivals = ok.filter(s => s.kind === 'call_arrive').map(s => s.eventTime);
  const exits = ok.filter(s => s.kind === 'call_exit').map(s => s.eventTime);
  const gate = ok.some(s => s.kind === 'gate');
  const codes = {
    start: codeState(visit.codes?.start, ok.filter(s => s.kind === 'code_start'), now, r),
    end: codeState(visit.codes?.end, ok.filter(s => s.kind === 'code_end'), now, r)
  };
  const codesOk = codes.start === 'ok' && codes.end === 'ok';
  const codeWrong = codes.start === 'wrong' || codes.end === 'wrong';
  const arrive = arrivals.length ? Math.min(...arrivals) : null;
  const exit = exits.length ? Math.max(...exits) : null;
  const duration = arrive != null && exit != null ? exit - arrive : null;
  const minimum = minVisitDuration(visitTasks.filter(t => !isCancelled(t)), r);
  const callsOk = duration != null && duration >= minimum;
  const reasons: string[] = [];
  if (visit.signals.some(s => s.kind !== 'gate' && s.registeredNumber === false)) reasons.push('R-CALL-UNREGISTERED: call from an unregistered number ignored');
  if (callsOk) reasons.push(`R-VISIT-CALLS-OK: ${duration} min ≥ ${minimum} min minimum`);
  else if (duration != null) reasons.push(`R-VISIT-SHORT: ${duration} min < ${minimum} min minimum`);
  else if (arrive != null || exit != null) reasons.push(`R-VISIT-ONE-CALL: only ${arrive != null ? 'arrival' : 'exit'} call`);
  if (gate) reasons.push('R-GATE-OWNER: owner-provided gate entry (not a gate-app integration)');
  if (codes.start) reasons.push(`R-START-${CODE_REASON[codes.start]}`);
  if (codes.end) reasons.push(`R-END-${CODE_REASON[codes.end]}`);
  if (arrive != null && exit == null && !gate && now - arrive < r.inProgressFor) {
    return { status: 'In progress', arrive, exit, duration, minimum, callsOk: false, gate, codes, reasons: [`R-VISIT-IN-PROGRESS: arrived at ${arrive}`, ...(codes.start ? [`R-START-${CODE_REASON[codes.start]}`] : [])] };
  }
  let status: VisitStatus | null = null;
  // A wrong start / end code is a conflict: the visit is never Likely or Confirmed on calls while it stands.
  if (codeWrong && !gate) status = arrive != null || exit != null ? 'Not confirmed' : null;
  // Fresh photos at the start and the end are a second channel next to the calls, like a gate entry.
  else if (callsOk && (gate || hasStrongTaskEvidence || codesOk)) status = 'Confirmed';
  else if (callsOk || gate) status = 'Likely';
  else if (arrive != null || exit != null) status = 'Not confirmed';
  return { status, arrive, exit, duration, minimum, callsOk, gate, codes, reasons };
}

export interface ScoredSignal { signal: TaskSignal; strong: boolean; weak: boolean; conflict: boolean; late: boolean }

/** Signals that count for a task after window, lateness and duplicate rules. */
export function scoreTaskSignals(task: CareTask, r: TrustRules = RULES_V1): ScoredSignal[] {
  const g = graceFor(task, r);
  const out: ScoredSignal[] = [];
  for (const s of task.signals) {
    if ('duplicate' in s && s.duplicate) continue;
    if (s.eventTime < task.due - r.windowBefore) continue;
    if (s.eventTime > task.due + g + r.lateAccept) continue;
    const late = s.eventTime > task.due + g;
    let strong = false, weak = false, conflict = false;
    if (s.kind === 'photo') { if (s.code === 'today') strong = true; else if (s.code === 'none') weak = true; else conflict = true; }
    if (s.kind === 'voice' && s.namesTask) weak = true;
    if (s.kind === 'ivr') { if (s.codeOk && s.afterPrompt) weak = true; else if (!s.codeOk) conflict = true; }
    if (s.kind === 'friend_photo') weak = true;
    out.push({ signal: s, strong, weak, conflict, late });
  }
  return out;
}

export const currentLifecycle = (t: CareTask) => t.lifecycle[t.lifecycle.length - 1]?.state ?? 'Planned';
export const isCancelled = (t: CareTask) => currentLifecycle(t) === 'Cancelled by owner';

export interface TaskEvaluation extends ReasonedResult<Confidence> { visitOnly?: boolean; late?: boolean; needsEscalation: boolean; visit?: VisitEvaluation | null }

export interface EvaluateContext { now: Minutes; visit?: VisitEvaluation | null; trustedHelperDay?: boolean; trustedCovered?: boolean; rules?: TrustRules }

/** Owner-facing task confidence (PRD 10.5 table). Never Confirmed from one signal; never Confirmed/Likely from visit evidence alone. */
export function evaluateTask(task: CareTask, ctx: EvaluateContext): TaskEvaluation {
  const r = ctx.rules ?? RULES_V1, now = ctx.now, g = graceFor(task, r), v = ctx.visit ?? null;
  const base = { ruleSet: r.version, visit: v };
  const life = currentLifecycle(task);
  if (life === 'Cancelled by owner') return { ...base, state: 'Cancelled', label: 'Cancelled by owner', reasons: ['Excluded from covered-day denominator'], needsEscalation: false };
  if (task.reassignedToTaskId) return { ...base, state: 'Cancelled', label: 'Reassigned', reasons: ['Reassigned to a named person; the new task carries the evidence. Original kept.'], needsEscalation: false };
  if (ctx.trustedHelperDay) return { ...base, state: 'Trusted', label: ctx.trustedCovered ? 'Covered (owner tap)' : 'Trusted helper, no check-ins', reasons: ['Trusted Helper mode: no check-ins, alerts or points'], needsEscalation: false };
  if (task.returnCheck?.contradicted) return { ...base, state: 'Mismatch', label: 'Mismatch, under review', reasons: [`R-OWNER-CONTRADICT: ${task.returnCheck.contradicted}`, 'Owner return check beats helper evidence; points held up to 7 days'], needsEscalation: false };

  const scored = scoreTaskSignals(task, r);
  const strong = scored.find(s => s.strong), weak = scored.find(s => s.weak), conflict = scored.find(s => s.conflict);
  const reasons: string[] = [];
  if (task.signals.some(s => 'duplicate' in s && s.duplicate)) reasons.push('R-HASH-REUSED: an image sent before does not count again');
  const visitEvidence = !!v && (v.callsOk || v.gate);

  if (strong && visitEvidence) {
    reasons.push('R-PHOTO-CODE-OK: photo includes today’s code', v!.callsOk ? 'R-VISIT-CALLS-OK: independent visit channel' : 'R-GATE-OWNER: independent owner-provided gate entry');
    if (strong.late) reasons.push('R-LATE: evidence after the grace period');
    return { ...base, state: 'Confirmed', label: 'Confirmed', reasons, late: strong.late, needsEscalation: false };
  }
  if (conflict && !strong) {
    const s = conflict.signal;
    reasons.push(s.kind === 'ivr' ? 'R-CODE-WRONG: IVR code did not match today' : `R-CODE-${s.kind === 'photo' && s.code === 'old' ? 'OLD' : 'WRONG'}: code in photo is not today’s`);
    return { ...base, state: 'Not confirmed', label: 'Not confirmed', reasons, needsEscalation: true };
  }
  const one = strong ?? weak;
  if (one) {
    const s = one.signal;
    reasons.push(s.kind === 'photo' ? (s.code === 'today' ? 'R-PHOTO-CODE-OK: photo includes today’s code (no second channel)' : 'R-PHOTO-NOCODE: photo without code')
      : s.kind === 'voice' ? 'R-VOICE-NAMES-TASK: voice note names the task'
      : s.kind === 'ivr' ? 'R-IVR-CODE-OK: code entered after the task prompt' : 'R-FRIEND-PHOTO: photo from the covering friend');
    if (one.late) reasons.push('R-LATE: evidence after the grace period, labelled late');
    return { ...base, state: 'Likely', label: 'Likely', reasons, late: one.late, needsEscalation: false };
  }
  if (task.returnCheck?.matched) return { ...base, state: 'Matched', label: 'Matched (owner check)', reasons: ['R-OWNER-MATCH: owner checked on return; counts toward a covered day; no helper points'], needsEscalation: false };
  if (v?.callsOk) return { ...base, state: 'Not confirmed', label: 'Not confirmed (visit only)', visitOnly: true, reasons: ['R-VISIT-ONLY: visit recorded, no evidence for this task'], needsEscalation: true };
  if (life === 'Done reported') return { ...base, state: 'Not confirmed', label: 'Not confirmed', reasons: ['R-DONE-REPORTED: helper says done; no task evidence'], needsEscalation: true };
  if (life === 'Skipped with reason') return { ...base, state: 'Not confirmed', label: 'Not confirmed (skipped)', reasons: ['R-SKIPPED'], needsEscalation: true };
  if (v?.status === 'Not confirmed' && now >= task.due + g) return { ...base, state: 'Not confirmed', label: 'Not confirmed', reasons: v.reasons.slice(), needsEscalation: true };
  if (now >= task.due + g) return { ...base, state: 'Missed', label: 'Missed', reasons: [...reasons, `R-NO-SIGNAL: nothing valid by due + ${g} min grace`], needsEscalation: true };
  return { ...base, state: 'Pending', label: now >= task.due - r.windowBefore ? 'Awaiting evidence' : 'Planned', reasons: [...reasons, `Evidence window ${task.due - r.windowBefore}–${task.due + g}`], needsEscalation: false };
}
