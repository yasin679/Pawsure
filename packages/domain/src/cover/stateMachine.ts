/** Task cover state machine — PRD 9.6. Pure transition function with guards and reason codes. */
import type { Urgency } from './config.js';

export type CoverState =
  | 'Assigned' | 'ConfirmedByCaregiver' | 'AtRisk' | 'SubstituteProposed' | 'AskingBackups' | 'FriendFinder'
  | 'CoveredByReplacement' | 'CoverNotFound' | 'OwnerHandling' | 'NoCoverPlanned' | 'Extended';
export const COVER_STATES: CoverState[] = ['Assigned', 'ConfirmedByCaregiver', 'AtRisk', 'SubstituteProposed', 'AskingBackups', 'FriendFinder', 'CoveredByReplacement', 'CoverNotFound', 'OwnerHandling', 'NoCoverPlanned', 'Extended'];
export const COVER_LABEL: Record<CoverState, string> = {
  Assigned: 'Assigned', ConfirmedByCaregiver: 'Confirmed by caregiver', AtRisk: 'At risk', SubstituteProposed: 'Substitute proposed',
  AskingBackups: 'Asking backups', FriendFinder: 'Friend Finder', CoveredByReplacement: 'Covered by replacement',
  CoverNotFound: 'Cover not found', OwnerHandling: 'Owner handling', NoCoverPlanned: 'No cover planned', Extended: 'Extended'
};

export type CoverEvent =
  | 'caregiver_yes' | 'caregiver_cant' | 'no_reply' | 'friend_cancelled' | 'marked_unavailable' | 'late_yes'
  | 'substitute_named' | 'substitute_approved' | 'substitute_declined' | 'substitute_timeout'
  | 'backups_asked' | 'replacement_confirmed' | 'backups_exhausted' | 'owner_stopped' | 'replacement_cant'
  | 'friend_finder_started' | 'friend_finder_ended'
  | 'owner_handles' | 'owner_moves' | 'owner_skips' | 'ask_someone' | 'ask_circle' | 'leave_anyway' | 'extended' | 'restored';
export const COVER_EVENTS: CoverEvent[] = ['caregiver_yes', 'caregiver_cant', 'no_reply', 'friend_cancelled', 'marked_unavailable', 'late_yes', 'substitute_named', 'substitute_approved', 'substitute_declined', 'substitute_timeout', 'backups_asked', 'replacement_confirmed', 'backups_exhausted', 'owner_stopped', 'replacement_cant', 'friend_finder_started', 'friend_finder_ended', 'owner_handles', 'owner_moves', 'owner_skips', 'ask_someone', 'ask_circle', 'leave_anyway', 'extended', 'restored'];

export interface CoverGuards { friendFinderOpen: boolean; urgency: Urgency }
export interface CoverTransition { state: CoverState; reason: string }
export class CoverError extends Error { constructor(public code: string, msg: string) { super(msg); } }

const AT_RISK_REASON: Partial<Record<CoverEvent, string>> = {
  caregiver_cant: 'R-COVER-CANT: caregiver said they can’t make it', no_reply: 'R-COVER-NO-REPLY: no reply by the confirmation deadline',
  friend_cancelled: 'R-COVER-FRIEND-CANCEL: friend cancelled', marked_unavailable: 'R-COVER-OWNER-MARKED: owner marked the helper unavailable',
  substitute_declined: 'R-COVER-SUB-DECLINED: owner declined the substitute', substitute_timeout: 'R-COVER-SUB-TIMEOUT: substitute not approved in time',
  owner_stopped: 'R-COVER-STOPPED: owner stopped the backup list', replacement_cant: 'R-COVER-REPLACEMENT-CANT: replacement can’t make it'
};

type Rule = CoverState | ((g: CoverGuards) => CoverState | null);
const toAtRisk: CoverState = 'AtRisk';
const TABLE: Record<CoverState, Partial<Record<CoverEvent, Rule>>> = {
  Assigned: { caregiver_yes: 'ConfirmedByCaregiver', caregiver_cant: toAtRisk, no_reply: toAtRisk, friend_cancelled: toAtRisk, marked_unavailable: toAtRisk, substitute_named: 'SubstituteProposed', owner_handles: 'OwnerHandling', leave_anyway: 'NoCoverPlanned', extended: 'Extended' },
  ConfirmedByCaregiver: { caregiver_cant: toAtRisk, friend_cancelled: toAtRisk, marked_unavailable: toAtRisk, substitute_named: 'SubstituteProposed' },
  Extended: { caregiver_yes: 'ConfirmedByCaregiver', caregiver_cant: toAtRisk, no_reply: toAtRisk, owner_handles: 'OwnerHandling' },
  AtRisk: {
    late_yes: 'ConfirmedByCaregiver', caregiver_yes: 'ConfirmedByCaregiver', substitute_named: 'SubstituteProposed', backups_asked: 'AskingBackups', ask_someone: 'AskingBackups', ask_circle: 'AskingBackups',
    backups_exhausted: (g) => g.friendFinderOpen ? 'FriendFinder' : 'CoverNotFound', friend_finder_started: (g) => g.friendFinderOpen ? 'FriendFinder' : null,
    replacement_confirmed: 'CoveredByReplacement', owner_handles: 'OwnerHandling', leave_anyway: 'NoCoverPlanned', restored: 'Assigned',
    // the owner stopped the list and decides directly
    owner_moves: (g) => g.urgency === 'MustHappen' ? null : 'OwnerHandling', owner_skips: (g) => g.urgency === 'CanWait' ? 'CoverNotFound' : null
  },
  SubstituteProposed: { substitute_approved: 'CoveredByReplacement', substitute_declined: toAtRisk, substitute_timeout: toAtRisk },
  AskingBackups: {
    replacement_confirmed: 'CoveredByReplacement', backups_exhausted: (g) => g.friendFinderOpen ? 'FriendFinder' : 'CoverNotFound', owner_stopped: toAtRisk,
    late_yes: 'ConfirmedByCaregiver', owner_handles: 'OwnerHandling', leave_anyway: 'NoCoverPlanned', friend_finder_started: (g) => g.friendFinderOpen ? 'FriendFinder' : null
  },
  FriendFinder: { replacement_confirmed: 'CoveredByReplacement', friend_finder_ended: 'CoverNotFound', backups_asked: 'AskingBackups', late_yes: 'ConfirmedByCaregiver', owner_handles: 'OwnerHandling', leave_anyway: 'NoCoverPlanned' },
  CoverNotFound: {
    owner_handles: 'OwnerHandling', owner_moves: (g) => g.urgency === 'MustHappen' ? null : 'OwnerHandling', owner_skips: (g) => g.urgency === 'CanWait' ? 'CoverNotFound' : null,
    ask_someone: 'AskingBackups', ask_circle: 'AskingBackups', friend_finder_started: (g) => g.friendFinderOpen ? 'FriendFinder' : null,
    replacement_confirmed: 'CoveredByReplacement', late_yes: 'ConfirmedByCaregiver', leave_anyway: 'NoCoverPlanned'
  },
  CoveredByReplacement: { replacement_cant: toAtRisk, friend_cancelled: toAtRisk },
  OwnerHandling: { backups_asked: 'AskingBackups', leave_anyway: 'NoCoverPlanned' },
  NoCoverPlanned: { owner_handles: 'OwnerHandling', backups_asked: 'AskingBackups', replacement_confirmed: 'CoveredByReplacement', late_yes: 'ConfirmedByCaregiver' }
};

const GUARD_FAIL: Partial<Record<CoverEvent, string>> = {
  friend_finder_started: 'Too close to the task for Friend Finder (the search closes 30 minutes before the task).',
  owner_moves: 'A must-happen task can’t be moved.',
  owner_skips: 'Only a task that can wait may be skipped.'
};

/** Returns the next state and a reason code, or throws CoverError (`not_allowed` or `guard_failed`). */
export function coverTransition(from: CoverState, event: CoverEvent, g: CoverGuards): CoverTransition {
  const rule = TABLE[from][event];
  if (rule === undefined) throw new CoverError('not_allowed', `Cover can’t go from ${COVER_LABEL[from]} on ${event}`);
  const state = typeof rule === 'function' ? rule(g) : rule;
  if (state == null) throw new CoverError('guard_failed', GUARD_FAIL[event] ?? `Not allowed now: ${event}`);
  const reason = state === 'AtRisk' ? (AT_RISK_REASON[event] ?? 'R-COVER-AT-RISK') : event === 'backups_exhausted' && state === 'CoverNotFound' ? 'R-COVER-FF-SKIPPED: too close to the task for Friend Finder' : 'R-COVER-' + event.toUpperCase().replace(/_/g, '-');
  return { state, reason };
}
export const canCover = (from: CoverState, event: CoverEvent, g: CoverGuards): boolean => { try { coverTransition(from, event, g); return true; } catch { return false; } };

/**
 * What happens next from a state: the events that can still move it, plus the standing step that closes it.
 * Never empty — the PRD requires that no path ends without a next step.
 */
export function nextSteps(from: CoverState, g: CoverGuards): string[] {
  const moves = COVER_EVENTS.filter(e => canCover(from, e, g));
  const standing: Partial<Record<CoverState, string>> = {
    ConfirmedByCaregiver: 'evidence_at_task_time', CoveredByReplacement: 'evidence_at_task_time', OwnerHandling: 'evidence_or_return_check',
    NoCoverPlanned: 'task_still_tracked', CoverNotFound: 'owner_options', Assigned: 'reminder'
  };
  return standing[from] ? [...moves, standing[from]!] : moves;
}
/** States in which somebody is named and expected: no further asks are sent. */
export const coverSettled = (s: CoverState) => s === 'ConfirmedByCaregiver' || s === 'CoveredByReplacement' || s === 'OwnerHandling';
/** States that keep the day from counting as covered unless evidence or the return check closes the task (PS-133, PS-134). */
export const coverBlocksDay = (s: CoverState | null | undefined) => s === 'NoCoverPlanned' || s === 'CoverNotFound';
/** States shown in orange on Today. */
export const coverAtRisk = (s: CoverState) => s === 'AtRisk' || s === 'AskingBackups' || s === 'SubstituteProposed' || s === 'FriendFinder' || s === 'Extended';
