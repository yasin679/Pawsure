/**
 * Role × resource × action matrix (master prompt §5). Enforced server-side per object (household tenant) — the UI only mirrors it.
 * Household isolation: every resource belongs to one household; a helper in two households holds two separate memberships.
 */
export type Role = 'owner' | 'co_owner' | 'backup' | 'family' | 'viewer' | 'helper' | 'friend' | 'nearby_member' | 'ops' | 'ops_lead' | 'privacy_lead' | 'tech_lead' | 'auditor' | 'substitute' | 'adhoc_visitor';
export type Resource = 'household' | 'pet' | 'emergency_card' | 'routine' | 'task' | 'evidence' | 'timeline' | 'alert' | 'incident' | 'care_circle' | 'helper_consent' | 'code_card' | 'friend_request' | 'friend_profile' | 'access_details' | 'wallet' | 'rights_request' | 'feature_flag' | 'audit_log' | 'ops_queue' | 'address' | 'metrics' | 'breach' | 'backup_list' | 'cover' | 'cluster_advisory';
export type Action = 'read' | 'create' | 'update' | 'delete' | 'acknowledge' | 'approve' | 'export';

type Matrix = Partial<Record<Role, Partial<Record<Resource, Action[]>>>>;
const ALL: Action[] = ['read', 'create', 'update', 'delete', 'acknowledge', 'approve'];
export const MATRIX: Matrix = {
  owner: { household: ALL, pet: ALL, emergency_card: ALL, routine: ALL, task: ALL, evidence: ['read'], timeline: ['read'], alert: ['read', 'acknowledge'], incident: ['read', 'create', 'update', 'acknowledge'], care_circle: ALL, helper_consent: ['read'], code_card: ['read', 'create', 'update'], friend_request: ALL, friend_profile: ['read'], access_details: ['read', 'approve'], wallet: ['read'], rights_request: ['read', 'create'], address: ['read', 'update'], backup_list: ALL, cover: ALL },
  co_owner: { backup_list: ['read'], cover: ['read', 'update', 'acknowledge'], household: ['read'], pet: ['read', 'update'], emergency_card: ['read', 'update'], routine: ['read', 'create', 'update'], task: ['read', 'update'], evidence: ['read'], timeline: ['read'], alert: ['read', 'acknowledge'], incident: ['read', 'create', 'update', 'acknowledge'], care_circle: ['read'], friend_request: ['read', 'create', 'update', 'approve'], friend_profile: ['read'], code_card: ['read'], wallet: ['read'], address: ['read'] },
  backup: { pet: ['read'], emergency_card: ['read'], alert: ['read', 'acknowledge'], incident: ['read', 'acknowledge', 'update'], timeline: ['read'] },
  family: { pet: ['read'], timeline: ['read'], alert: ['read', 'acknowledge'], emergency_card: ['read'] },
  viewer: { timeline: ['read'], pet: ['read'] },
  helper: { task: ['read'], evidence: ['create'], incident: ['create'], helper_consent: ['read', 'update'], emergency_card: ['read'], wallet: ['read'], rights_request: ['create'] },
  friend: { friend_profile: ['read', 'update', 'delete'], friend_request: ['read', 'update'], access_details: ['read'], emergency_card: ['read'], rights_request: ['create'] },
  nearby_member: {},
  // v1.4: task-scoped, expiring visitors. A substitute is named by the caregiver; an ad-hoc visitor is a number the owner typed in (PS-128, PS-133).
  substitute: { task: ['read'], evidence: ['create'], access_details: ['read'], emergency_card: ['read'], incident: ['create'] },
  adhoc_visitor: { task: ['read'], evidence: ['create'], access_details: ['read'], emergency_card: ['read'], incident: ['create'] },
  ops: { cluster_advisory: ['read', 'create'], ops_queue: ['read', 'update'], incident: ['read', 'update'], timeline: ['read'], friend_request: ['read'], helper_consent: ['read'], metrics: ['read'], household: ['read'] },
  ops_lead: { cluster_advisory: ['read', 'create'], ops_queue: ALL, incident: ['read', 'update'], feature_flag: ['read', 'update'], audit_log: ['read'], wallet: ['read', 'update', 'approve'], friend_profile: ['read', 'update'], household: ['read'], metrics: ['read'], helper_consent: ['read'], friend_request: ['read'], breach: ['read'] },
  privacy_lead: { rights_request: ['read', 'update', 'approve'], audit_log: ['read', 'export'], feature_flag: ['read'], breach: ['read', 'create', 'update'], metrics: ['read'], household: ['read'] },
  tech_lead: { feature_flag: ['read', 'update'], audit_log: ['read'], breach: ['read', 'create', 'update'], metrics: ['read'], ops_queue: ['read'], friend_request: ['read'] },
  auditor: { audit_log: ['read', 'export'], ops_queue: ['read'], metrics: ['read'] }
};

/** Conditional rules that the static matrix cannot express. */
export interface AccessContext { sameHousehold: boolean; linkValid?: boolean; requestAccepted?: boolean; ownerAuthorisedDisclosure?: boolean; backupAuthorisedForAddress?: boolean; duringVisitOrIncident?: boolean;
  /** v1.4 one-time task link: this task only, not expired, not revoked. */
  taskLinkValid?: boolean; forThisTask?: boolean; accepted?: boolean; ownerApproved?: boolean }

export function can(role: Role, resource: Resource, action: Action, ctx: AccessContext): boolean {
  const staff = role === 'ops' || role === 'ops_lead' || role === 'privacy_lead' || role === 'tech_lead' || role === 'auditor';
  if (!staff && !ctx.sameHousehold) return false;
  if (role === 'nearby_member') return false; // switch OFF until ID checks are approved (PS-062)
  if (!(MATRIX[role]?.[resource] ?? []).includes(action)) return false;
  if (role === 'backup' && (resource === 'pet' || resource === 'emergency_card')) return ctx.linkValid === true;
  if (role === 'helper' && resource === 'emergency_card') return ctx.duringVisitOrIncident === true;
  if (role === 'substitute' || role === 'adhoc_visitor') {
    if (ctx.taskLinkValid !== true || ctx.forThisTask !== true) return false;
    if (resource === 'task') return true; // task, time and tower only
    return ctx.accepted === true && ctx.ownerApproved === true; // address, gate, key, emergency card, evidence: only after accept + owner approval
  }
  if (role === 'friend' && (resource === 'access_details' || resource === 'emergency_card')) return ctx.requestAccepted === true && ctx.ownerAuthorisedDisclosure === true;
  return true;
}

export function canSeeAddress(role: Role, ctx: AccessContext): boolean {
  if (role === 'owner' || role === 'co_owner') return ctx.sameHousehold;
  if (role === 'backup') return ctx.sameHousehold && ctx.linkValid === true && ctx.backupAuthorisedForAddress === true;
  if (role === 'friend') return ctx.sameHousehold && ctx.requestAccepted === true && ctx.ownerAuthorisedDisclosure === true;
  if (role === 'substitute' || role === 'adhoc_visitor') return ctx.sameHousehold && ctx.taskLinkValid === true && ctx.forThisTask === true && ctx.accepted === true && ctx.ownerApproved === true;
  return false;
}

/** Revocation must reach every channel within this many seconds (PS-005). */
export const REVOCATION_SLA_SECONDS = 60;

/**
 * PRD 9.5 (v1.4): the owner approves every outbound request. The one exception is the ordered backup list when the
 * owner has turned on standing approval. It never covers friends, nearby members, substitutes or ad-hoc numbers.
 */
export type OutreachTarget = 'backup_list' | 'friend' | 'adhoc_number' | 'substitute' | 'nearby_member' | 'care_circle_call';
export function outreachAllowed(target: OutreachTarget, o: { standingApproval: boolean; ownerApprovedThisSend: boolean; mustHappenUnacknowledged?: boolean }): boolean {
  if (target === 'nearby_member') return false;
  if (o.ownerApprovedThisSend) return true;
  if (target === 'backup_list') return o.standingApproval;
  if (target === 'care_circle_call') return o.mustHappenUnacknowledged === true; // PS-132 automated call, no details shared
  return false;
}
