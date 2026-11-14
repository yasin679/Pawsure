/**
 * Covered care day — PS-111 (rule covered-day-v1.4; v1.3 plus PS-133 / PS-134). Deterministic, versioned; never back-filled under a new version.
 * Per pet per IST day. Covered when every planned, non-cancelled task is Confirmed, Likely or Matched, or a missed task was
 * escalated and resolved by 11:59 PM. Trusted Helper: covered only on the owner's "Covered" tap; no tap = Unknown.
 * v1.4: a task whose cover is No cover planned or Cover not found (or was skipped after cover not found) is not covered
 * unless it is later done with evidence or matched by the return check; a resolved escalation does not rescue it.
 * Open escalation at midnight = not covered. Household covered only if every pet is covered. Days with no tasks are excluded.
 */
import type { TaskEvaluation } from './trust.js';
import type { EscalationState } from './escalation.js';

import { coverBlocksDay, type CoverState } from './cover/stateMachine.js';

export const COVERED_DAY_RULE = 'covered-day-v1.4';
export type PetDayStatus = 'Covered' | 'Not covered' | 'Unknown' | 'Excluded' | 'In progress' | 'At risk';

export interface TaskOutcome { taskId: string; petId: string; ev: TaskEvaluation; esc: EscalationState | null; trusted: boolean; cover?: CoverState | null; coverSkipped?: boolean }

export interface CoveredDayInput { petIds: string[]; outcomes: TaskOutcome[]; trustedCoveredTap: boolean; dayClosed: boolean }
export interface CoveredDayResult { rule: string; household: PetDayStatus; pets: { petId: string; status: PetDayStatus; why: string[] }[]; verified: boolean }

export function coveredDay(input: CoveredDayInput): CoveredDayResult {
  const pets = input.petIds.map(petId => {
    const ts = input.outcomes.filter(o => o.petId === petId && o.ev.state !== 'Cancelled');
    if (!ts.length) return { petId, status: 'Excluded' as PetDayStatus, why: ['No planned tasks'] };
    if (ts.every(o => o.trusted)) return { petId, status: (input.trustedCoveredTap ? 'Covered' : 'Unknown') as PetDayStatus, why: [input.trustedCoveredTap ? 'Owner tapped Covered' : 'Trusted Helper day without a Covered tap'] };
    let ok = true, pending = false; const why: string[] = [];
    for (const o of ts) {
      const st = o.ev.state;
      if (o.trusted) { if (!input.trustedCoveredTap) { ok = false; why.push(`${o.taskId}: Trusted, not tapped`); } continue; }
      if ((st === 'Confirmed' || st === 'Likely' || st === 'Matched') && !(o.esc && o.esc.open)) continue;
      if (coverBlocksDay(o.cover) || o.coverSkipped) { ok = false; why.push(`${o.taskId}: ${o.coverSkipped ? 'skipped after cover not found' : o.cover === 'NoCoverPlanned' ? 'no cover planned' : 'cover not found'}`); continue; }
      if (st === 'Pending') { pending = true; continue; }
      if (o.esc?.resolved) continue;
      ok = false; why.push(`${o.taskId}: ${o.ev.label}${o.esc?.open ? ', escalation open' : ''}`);
    }
    const status: PetDayStatus = !ok ? (input.dayClosed ? 'Not covered' : 'At risk') : pending && !input.dayClosed ? 'In progress' : 'Covered';
    if (input.dayClosed && pending) return { petId, status: 'Not covered' as PetDayStatus, why: [...why, 'Task still pending at midnight'] };
    return { petId, status, why };
  });
  const counted = pets.filter(p => p.status !== 'Excluded');
  const order: PetDayStatus[] = ['Not covered', 'Unknown', 'At risk', 'In progress'];
  const household: PetDayStatus = counted.length === 0 ? 'Excluded' : (order.find(s => counted.some(p => p.status === s)) ?? 'Covered');
  const verified = input.outcomes.filter(o => o.ev.state !== 'Cancelled').every(o => o.ev.state === 'Confirmed' || o.ev.state === 'Likely');
  return { rule: COVERED_DAY_RULE, household, pets, verified: household === 'Covered' && verified };
}

/** Owners may correct a day within 48 h; later corrections need ops (PS-111). */
export const canOwnerCorrect = (dayClosedAtMs: number, nowMs: number) => nowMs - dayClosedAtMs <= 48 * 3600 * 1000;
