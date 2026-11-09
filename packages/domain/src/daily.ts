/** Daily-care rules: alone window (PS-012), return check (PS-033), health reminders (PS-041, PS-046). */
import type { CareTask, Minutes, TaskType } from './types.js';

/**
 * Longest stretch the pet is alone, from when the owner leaves until they return, given planned visit times.
 * The threshold is owner-set; Pawsure makes no medical claim about how long pets can be alone.
 */
export function aloneWindow(outFrom: Minutes, outTo: Minutes, visitTimes: Minutes[], limitHours: number) {
  const pts = [outFrom, ...visitTimes.filter(t => t > outFrom && t < outTo).sort((a, b) => a - b), outTo];
  let longest = 0, from = outFrom, to = outTo;
  for (let i = 1; i < pts.length; i++) { const g = pts[i]! - pts[i - 1]!; if (g > longest) { longest = g; from = pts[i - 1]!; to = pts[i]!; } }
  return { longestMinutes: longest, from, to, exceeds: longest > limitHours * 60, limitHours };
}

/** Five-tap return check (C3). 0 = first option (done-looking), 1 = second option. */
export interface ReturnAnswers { food: 0 | 1; water: 0 | 1; pad: 0 | 1; pet: 0 | 1; damage: 0 | 1 }
export const RETURN_QUESTIONS = [
  { key: 'food', q: 'Food bowl', a: ['Empty / eaten', 'Untouched'] },
  { key: 'water', q: 'Water bowl', a: ['Lower / refilled', 'Same or dry'] },
  { key: 'pad', q: 'Toilet pad', a: ['Changed', 'Old'] },
  { key: 'pet', q: 'Your pet', a: ['Normal', 'Very hungry or thirsty'] },
  { key: 'damage', q: 'Anything damaged or wrong?', a: ['No', 'Yes'] }
] as const;

/** What the owner can observe for a task type; medicine is not observable on return. */
export function observedDone(type: TaskType, a: ReturnAnswers): boolean | null {
  if (type === 'feeding' || type === 'litter') return a.food === 0;
  if (type === 'toilet') return a.pad === 0;
  if (type === 'water') return a.water === 0;
  return null;
}

export type ReturnOutcome = { taskId: string; result: 'matched' | 'contradicted' | 'unchanged'; what?: string };
/** Matched: owner confirms a task that lacked evidence (no points). Contradicted: owner check beats Confirmed/Likely → hold (PRD 10.5). */
export function applyReturnCheck(tasks: (Pick<CareTask, 'id' | 'type'> & { state: string; helperTask: boolean })[], a: ReturnAnswers): ReturnOutcome[] {
  return tasks.map(t => {
    const seen = observedDone(t.type, a);
    if (seen == null || !t.helperTask) return { taskId: t.id, result: 'unchanged' as const };
    const evidenced = t.state === 'Confirmed' || t.state === 'Likely';
    if (evidenced && !seen) return { taskId: t.id, result: 'contradicted' as const, what: t.type === 'toilet' ? 'toilet pad old' : t.type === 'water' ? 'water same or dry' : 'food bowl untouched' };
    if (!evidenced && seen && ['Not confirmed', 'Missed'].includes(t.state)) return { taskId: t.id, result: 'matched' as const };
    return { taskId: t.id, result: 'unchanged' as const };
  });
}
/** The check is offered mainly when something lacks evidence (PS-033). */
export const returnCheckNeeded = (states: string[]) => states.some(s => s === 'Not confirmed' || s === 'Missed');

/** Health reminders: pre-due 3 days, due, overdue. Pawsure only reminds — never prescribes. */
export type HealthState = 'upcoming' | 'due_soon' | 'due' | 'overdue' | 'done' | 'snoozed';
export function healthState(nextDue: string | null, today: string, opts: { done?: boolean; snoozedUntil?: string | null } = {}): HealthState {
  if (opts.done) return 'done';
  if (opts.snoozedUntil && opts.snoozedUntil >= today) return 'snoozed';
  if (!nextDue) return 'upcoming';
  const d = Math.round((Date.parse(nextDue) - Date.parse(today)) / 86400000);
  return d < 0 ? 'overdue' : d === 0 ? 'due' : d <= 3 ? 'due_soon' : 'upcoming';
}
