/**
 * Shared domain types. Times are minutes since IST midnight of the care day (PRD 16.3: per IST calendar day).
 * Every signal keeps event time (when it happened) and received time (when Pawsure got it) separately (PRD 12.2, C1 PS-038).
 */
export type Minutes = number;

export type TaskType = 'feeding' | 'walk' | 'medicine' | 'toilet' | 'litter' | 'water' | 'other';
export type EscalationProfile = 'standard' | 'medicine' | 'walk';

export type Confidence = 'Confirmed' | 'Likely' | 'Not confirmed' | 'Missed' | 'Matched' | 'Mismatch' | 'Pending' | 'Trusted' | 'Cancelled';
export type VisitStatus = 'Confirmed' | 'Likely' | 'Not confirmed' | 'In progress';

/** PS-121: exactly these lifecycle states. */
export type LifecycleState =
  | 'Planned' | 'Reassigned' | 'Cancelled by owner' | 'Done with evidence' | 'Done reported'
  | 'Partly done' | 'Skipped with reason' | 'Missed';

export type PhotoCode = 'today' | 'none' | 'wrong' | 'old';

export interface SignalBase { id: string; eventTime: Minutes; receivedTime: Minutes; source: string; }
export type TaskSignal =
  | (SignalBase & { kind: 'photo'; code: PhotoCode; imageHash: string; duplicate?: boolean })
  | (SignalBase & { kind: 'voice'; namesTask: boolean })
  | (SignalBase & { kind: 'ivr'; codeOk: boolean; afterPrompt: boolean })
  | (SignalBase & { kind: 'friend_photo'; imageHash: string; duplicate?: boolean });

/** code_start / code_end: a photo showing the random code sent when the helper's arrival / exit call came in. */
export type VisitSignal = SignalBase & { kind: 'call_arrive' | 'call_exit' | 'gate' | 'code_start' | 'code_end'; registeredNumber?: boolean; ownerProvided?: boolean; codeOk?: boolean; duplicate?: boolean };

export interface LifecycleEvent { at: Minutes; state: LifecycleState; actor: string; note?: string }

export interface CareTask {
  id: string;
  petId: string;
  title: string;
  type: TaskType;
  due: Minutes;
  /** Minimum minutes the task needs (PRD 10.5: feeding 5, toilet 3, medicine 3, walk 15). */
  minMinutes: number;
  visitId: string | null;
  assignee: string;
  profile: EscalationProfile;
  /** v1.4 PS-132: must-happen tasks alert at due + 15 min whatever their profile. */
  graceOverride?: number;
  signals: TaskSignal[];
  lifecycle: LifecycleEvent[];
  returnCheck?: { at: Minutes; matched?: boolean; contradicted?: string };
  escalation: { ackAt?: Minutes; ackBy?: string; resolvedAt?: Minutes; resolvedNote?: string; forceBackup?: boolean; /** v1.4 (PRD 10.4): cover continuity already ran before the task, so steps 2 and 3 are not repeated. */ coverHandled?: boolean };
  reassignedToTaskId?: string;
}

/** codes: when the random start / end code was sent to the helper (only set once it was sent). */
export interface CareVisit { id: string; who: string; signals: VisitSignal[]; codes?: { start?: Minutes; end?: Minutes } }

export interface ReasonedResult<S> { state: S; label: string; reasons: string[]; ruleSet: string }
