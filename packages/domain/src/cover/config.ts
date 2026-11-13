/**
 * Cover continuity — PRD v1.4 section 7.7 and 9.6, PS-127 to PS-139.
 * Cover says who is expected to do a task; evidence says whether it was done. A caregiver's Yes is never evidence.
 * Every timing below is configuration with the PRD default; households and tasks may override (see `coverConfig`).
 */
import type { Minutes, TaskType } from '../types.js';

export const COVER_RULE = 'cover-v1.4';

export interface CoverConfig {
  /** PS-127: reminder this many minutes before the first task of the visit. */
  reminderLeadMin: number;
  /** PS-127: tasks before this minute of the day are reminded the evening before. */
  earlyTaskBefore: Minutes;
  /** PS-127: minute of the previous day for the evening reminder (20:00). */
  eveningReminderAt: Minutes;
  /** PS-129: no reply by task time minus this → At risk. */
  confirmDeadlineMin: number;
  /** Evening reminders and advisories: At risk this many minutes after the reminder (PRD silent; D-40). */
  eveningDeadlineMin: number;
  /** PS-130 */
  maxBackups: number; pairSize: number; pairWindowMin: number;
  /** PS-134: more than this many minutes before the task → ask backups and friends together. */
  wideAskAfterMin: number; wideWindowMin: number;
  /** 7.7 step 29 */
  holdMin: number; holdReminderMin: number;
  /** PS-131 / PS-123 */
  friendFinderCutoffMin: number;
  /** PS-132 */
  mustHappenGraceMin: number; circleCallAfterMin: number;
  /** PS-133 */
  adhocLinkMin: number;
  /** PS-137 */
  checklistReminderMin: number;
  /** PS-128 (PRD silent; D-45) and PS-136 (D-47) */
  substituteDeadlineMin: number; extensionReplyMin: number;
  /** PS-135 */
  thinCircleKeyHolders: number; advisoryNotBefore: Minutes;
}

export const COVER_V1: CoverConfig = {
  reminderLeadMin: 90, earlyTaskBefore: 600, eveningReminderAt: 1200, confirmDeadlineMin: 45, eveningDeadlineMin: 45,
  maxBackups: 5, pairSize: 2, pairWindowMin: 10, wideAskAfterMin: 180, wideWindowMin: 60, holdMin: 10, holdReminderMin: 5,
  friendFinderCutoffMin: 30, mustHappenGraceMin: 15, circleCallAfterMin: 15, adhocLinkMin: 15, checklistReminderMin: 15,
  substituteDeadlineMin: 45, extensionReplyMin: 10, thinCircleKeyHolders: 2, advisoryNotBefore: 1080
};

/** Household and per-task overrides on top of the defaults. Unknown keys are ignored. */
export function coverConfig(...overrides: (Partial<CoverConfig> | null | undefined)[]): CoverConfig {
  const out: CoverConfig = { ...COVER_V1 };
  for (const o of overrides) if (o) for (const k of Object.keys(COVER_V1) as (keyof CoverConfig)[]) { const v = o[k]; if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v; }
  return out;
}

/* ---------------- PS-132 urgency ---------------- */
export type Urgency = 'CanWait' | 'TimeSensitive' | 'MustHappen';
export const URGENCY_LABEL: Record<Urgency, string> = { CanWait: 'Can wait', TimeSensitive: 'Time-sensitive', MustHappen: 'Must happen' };

/** Defaults by task type: walk and play can wait; meals are time-sensitive; medicine must happen; water must happen on hot days. */
export function defaultUrgency(type: TaskType, opts: { hotDay?: boolean } = {}): Urgency {
  if (type === 'medicine') return 'MustHappen';
  if (type === 'walk' || type === 'other') return 'CanWait';
  if (type === 'water') return opts.hotDay ? 'MustHappen' : 'TimeSensitive';
  return 'TimeSensitive';
}
export const isUrgency = (v: unknown): v is Urgency => v === 'CanWait' || v === 'TimeSensitive' || v === 'MustHappen';

/** Must-happen tasks alert at due + 15 min (the medicine timing); other tasks keep their escalation profile. */
export const alertGrace = (urgency: Urgency, profileGrace: number, c: CoverConfig = COVER_V1) => urgency === 'MustHappen' ? Math.min(profileGrace, c.mustHappenGraceMin) : profileGrace;

export interface NotFoundOptions { handle: true; askSomeone: true; askCircle: boolean; friendFinder: boolean; move: boolean; moveWarning: boolean; skip: boolean; circleCallAt: Minutes | null }
/**
 * PS-133 options by urgency. Any must-happen task: no Move, no Skip, and the care circle is called 15 min after
 * cover not found if the owner has not acknowledged. Time-sensitive: Move with a warning, no Skip. Can wait: both.
 */
export function notFoundOptions(urgencies: Urgency[], o: { now: Minutes; firstDue: Minutes; notFoundAt: Minutes | null; acknowledged: boolean; circleAsked: boolean; circleCalled: boolean }, c: CoverConfig = COVER_V1): NotFoundOptions {
  const must = urgencies.includes('MustHappen'), allWait = urgencies.length > 0 && urgencies.every(u => u === 'CanWait');
  return {
    handle: true, askSomeone: true, askCircle: !o.circleAsked, friendFinder: friendFinderOpen(o.now, o.firstDue, c),
    move: !must, moveWarning: !must && urgencies.includes('TimeSensitive'), skip: allWait,
    circleCallAt: must && o.notFoundAt != null && !o.acknowledged && !o.circleCalled ? o.notFoundAt + c.circleCallAfterMin : null
  };
}
export const circleCallDue = (o: { urgencies: Urgency[]; notFoundAt: Minutes | null; acknowledged: boolean; circleCalled: boolean; now: Minutes }, c: CoverConfig = COVER_V1) =>
  o.urgencies.includes('MustHappen') && o.notFoundAt != null && !o.acknowledged && !o.circleCalled && o.now >= o.notFoundAt + c.circleCallAfterMin;

/* ---------------- PS-131 Friend Finder gate ---------------- */
/** A new search may start only while now is before task time − 30 min. Exactly at the cutoff the window is closed. */
export const friendFinderOpen = (now: Minutes, taskDue: Minutes, c: CoverConfig = COVER_V1) => now < taskDue - c.friendFinderCutoffMin;
export const friendFinderCutoff = (taskDue: Minutes, c: CoverConfig = COVER_V1) => taskDue - c.friendFinderCutoffMin;
/** v1.3 "friend cancelled → reopen search" becomes: reopen only before the cutoff, else the backup runner. */
export const afterFriendCancel = (now: Minutes, taskDue: Minutes, c: CoverConfig = COVER_V1): 'reopen_search' | 'backup_runner' => friendFinderOpen(now, taskDue, c) ? 'reopen_search' : 'backup_runner';
