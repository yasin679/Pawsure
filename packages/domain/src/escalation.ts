/**
 * Missed-task escalation — PS-031, PS-032, PS-101, PS-102, PRD 10.4.
 * Step 1 owner alert at due + grace; step 2 backup look-in link 30 min later; step 3 cover suggestions 15 min after that.
 * Medicine tasks have no step 2 (D-10). "Visit only" tasks escalate exactly like missed ones (D-11).
 * Acknowledgement = explicit "I'm on it" or pressing 1 — a read/delivery receipt never counts.
 */
import type { CareTask, Minutes } from './types.js';
import { graceFor, RULES_V1, type TaskEvaluation, type TrustRules } from './trust.js';

export interface EscalationConfig { backupAfter: number; coverAfterBackup: number; lookInMinutes: number }
export const ESCALATION_V1: EscalationConfig = { backupAfter: 30, coverAfterBackup: 15, lookInMinutes: 15 };

export type EscalationStepKind = 'owner_alert' | 'backup_lookin' | 'cover_suggestions';
export interface EscalationStep { n: 1 | 2 | 3; kind: EscalationStepKind; at: Minutes; fired: boolean; stoppedByAck: boolean; /** v1.4: cover continuity already asked the backups before the task. */ notRepeated?: boolean }
export interface EscalationState { open: boolean; resolved: boolean; acknowledged: boolean; steps: EscalationStep[]; backupExcluded: boolean }

/** D-10 (agreed 9 Nov 2026): backups never give medicine, so medicine tasks have no backup look-in step. */
export const backupAllowed = (task: Pick<CareTask, 'profile'>) => task.profile !== 'medicine';

export function escalationTimes(task: Pick<CareTask, 'due' | 'profile'> & { graceOverride?: number }, r: TrustRules = RULES_V1, c: EscalationConfig = ESCALATION_V1) {
  const s1 = task.due + graceFor(task, r);
  return { s1, s2: s1 + c.backupAfter, s3: s1 + c.backupAfter + c.coverAfterBackup };
}

export function escalationState(task: CareTask, ev: TaskEvaluation, now: Minutes, r: TrustRules = RULES_V1, c: EscalationConfig = ESCALATION_V1): EscalationState | null {
  const force = !!task.escalation.forceBackup;
  if (!ev.needsEscalation && !force) return null;
  const t = escalationTimes(task, r, c), ack = task.escalation.ackAt, withBackup = backupAllowed(task);
  // A forced escalation (friend no-show) jumps to the backup step; with no backup step it jumps to cover suggestions.
  const forcedUpTo = withBackup ? 2 : 3;
  const mk = (n: 1 | 2 | 3, kind: EscalationStepKind, at: Minutes): EscalationStep => {
    const stoppedByAck = n > 1 && ack != null && ack <= at;
    const due = now >= at || (force && n <= forcedUpTo);
    const notRepeated = n > 1 && !!task.escalation.coverHandled && !force;
    return { n, kind, at, fired: due && !stoppedByAck && !notRepeated, stoppedByAck, ...(notRepeated ? { notRepeated } : {}) };
  };
  const steps = [mk(1, 'owner_alert', t.s1), ...(withBackup ? [mk(2, 'backup_lookin', t.s2)] : []), mk(3, 'cover_suggestions', t.s3)];
  const resolved = task.escalation.resolvedAt != null;
  return { open: (now >= t.s1 || force) && !resolved, resolved, acknowledged: ack != null, steps, backupExcluded: !withBackup };
}

/** Look-in link validity (PS-102): recipient-scoped, 15 minutes, dies on revocation. */
export interface LookInLink { id: string; taskId: string; recipientId: string; createdAt: Minutes; expiresAt: Minutes; revoked: boolean; showAddress: boolean }
export function canOpenLookIn(link: LookInLink, recipientId: string, now: Minutes, recipientStillAuthorised: boolean): { ok: boolean; reason?: string } {
  if (link.recipientId !== recipientId) return { ok: false, reason: 'not_recipient' };
  if (link.revoked || !recipientStillAuthorised) return { ok: false, reason: 'revoked' };
  if (now >= link.expiresAt) return { ok: false, reason: 'expired' };
  return { ok: true };
}
