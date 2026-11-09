/** Task lifecycle — PS-121. One current state, append-only history; nothing is overwritten. */
import type { CareTask, LifecycleState, Minutes } from './types.js';
import { currentLifecycle } from './trust.js';

const ALLOWED: Record<LifecycleState, LifecycleState[]> = {
  'Planned': ['Reassigned', 'Cancelled by owner', 'Done with evidence', 'Done reported', 'Partly done', 'Skipped with reason', 'Missed'],
  'Missed': ['Done with evidence', 'Done reported', 'Partly done', 'Skipped with reason', 'Cancelled by owner', 'Reassigned'],
  'Done reported': ['Done with evidence', 'Partly done', 'Skipped with reason'],
  'Done with evidence': ['Partly done'],
  'Partly done': ['Done with evidence'],
  'Skipped with reason': ['Done with evidence'],
  'Reassigned': [],
  'Cancelled by owner': []
};

export class LifecycleError extends Error {}

/** Returns a new task with the transition appended. Requires a note for cancel / skip / partly done / reassign. */
export function transition(task: CareTask, to: LifecycleState, actor: string, at: Minutes, note?: string): CareTask {
  const from = currentLifecycle(task);
  if (from === to) return task;
  if (!ALLOWED[from].includes(to)) throw new LifecycleError(`Cannot move ${task.id} from ${from} to ${to}`);
  if (['Cancelled by owner', 'Skipped with reason', 'Partly done', 'Reassigned'].includes(to) && !note?.trim()) throw new LifecycleError(`${to} needs a reason`);
  return { ...task, lifecycle: [...task.lifecycle, { at, state: to, actor, note }] };
}
