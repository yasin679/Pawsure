/** Thin API client. The session token lives in localStorage; nothing sensitive is cached beyond it. */
export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';
/** The owner app and the staff console keep separate sign-ins, so opening one never signs you out of the other. */
let sessionMode: 'app' | 'staff' = 'app';
export const setSessionMode = (m: 'app' | 'staff') => { sessionMode = m; };
const KEY_FOR = { app: 'pawsure.session', staff: 'pawsure.staff.session' } as const;

export interface Session { token: string; userId: string }
export const session = {
  get(): Session | null { try { return JSON.parse(localStorage.getItem(KEY_FOR[sessionMode]) ?? 'null'); } catch { return null; } },
  set(s: Session | null) { try { s ? localStorage.setItem(KEY_FOR[sessionMode], JSON.stringify(s)) : localStorage.removeItem(KEY_FOR[sessionMode]); } catch { /* private mode */ } }
};

/**
 * Ends the session on the server too (a copied token stops working), clears the offline copy of API responses kept
 * for this device, and forgets the token. Used by every sign-out button.
 */
export async function endSession(everywhere = false) {
  try { if (session.get()) await api(everywhere ? '/v1/auth/logout-all' : '/v1/auth/logout', { body: {} }); } catch { /* offline: the token still expires */ }
  try { if ('caches' in window) await caches.delete('api'); } catch { /* no cache storage */ }
  session.set(null);
}

export class ApiError extends Error { constructor(public status: number, public body: Record<string, unknown>) { super(String(body.error ?? status)); } }

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const s = session.get();
  const res = await fetch(API + path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(init.auth !== false && s ? { authorization: 'Bearer ' + s.token } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/* Shapes returned by /v1/households/:hh/today */
export interface Ev { state: string; label: string; reasons: string[]; ruleSet: string; visitOnly?: boolean; late?: boolean; needsEscalation: boolean }
export interface EscStep { n: number; kind: string; at: number; fired: boolean; stoppedByAck: boolean; notRepeated?: boolean }
export interface Esc { open: boolean; resolved: boolean; acknowledged: boolean; steps: EscStep[]; backupExcluded: boolean }
export interface TaskCover { state: string; label: string; personKind: string | null; personId: string | null; personName: string | null; reason: string | null; lostBy: string | null; confirmedAt: number | null; jobId: string | null; skipped: boolean; handledPre: boolean }
export interface DayTask { urgency: string; cover: TaskCover | null; movedFrom: number | null; escalation: { coverHandled?: boolean }; id: string; petId: string; title: string; type: string; due: number; visitId: string | null; profile: string; ev: Ev; esc: Esc | null; points: { kind: string; points?: number; reason?: string }; signals: { kind: string; eventTime: number; receivedTime: number; code?: string; duplicate?: boolean }[]; lifecycle: { at: number; state: string; actor: string; note?: string }[] }
export interface Visit { id: string; status: string | null; arrive: number | null; exit: number | null; duration: number | null; minimum: number; callsOk: boolean; gate: boolean; reasons: string[] }
export interface DayView { careDate: string; now: number; tasks: DayTask[]; visits: Record<string, Visit>; covered: { rule: string; household: string; pets: { petId: string; status: string; why: string[] }[]; verified: boolean }; trusted: boolean; day: DayInfo }
export interface Pet { handling_note?: string; id: string; name: string; species: string; breed?: string; age?: string; size?: string; food?: string; allergies?: string; medicines?: string; fears?: string; notes?: string; vet_name?: string; vet_phone?: string; clinic24_name?: string; clinic24_phone?: string; backup_name?: string; backup_phone?: string; source?: string; updated_at?: string }
export interface Me { user: { id: string; display_name: string | null; language: string; phone_e164: string }; memberships: { household_id: string; role: string; society: string; tower: string | null }[]; consents: { kind: string; version: string; granted: boolean; recorded_at: string }[] }

export const hm = (m: number) => { const h = Math.floor(m / 60) % 24, mm = ((m % 60) + 60) % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')}`; };
export const fmt = (m: number) => `${hm(m)} ${Math.floor(m / 60) % 24 >= 12 ? 'PM' : 'AM'}`;

/* ---------- Phase 2 shapes ---------- */
export interface DayInfo { mode: string; helperUnavailable: boolean; unavailableReason: string | null; leaving: unknown; leftAt: number | null; returnAt: number; backAt: number | null; returnCheckDone: boolean; returnCheckNeeded: boolean; gateApp: boolean; alone: { longestMinutes: number; from: number; to: number; exceeds: boolean; limitHours: number } }
export interface TimelineItem { at: number; kind: string; text: string }
export interface DayReport { date: string; covered: DayView['covered']; tasks: { id: string; title: string; petId: string; due: number; state: string; label: string; lifecycle: string }[]; visits: Record<string, Visit>; points: { earned: number; held: number; rewardsArm: boolean }; callsToHelper: number; upcomingHealth: { id: string; label: string; next_due: string; pet_id: string }[] }
export interface RoutineItem { id: string; pet_id: string; title: string; task_type: string; due_minute: number; min_minutes: number; recurrence: string; escalation_profile: string; instructions: string | null; effective_from: string; assignee_role: string | null }
export interface Helper { id: string; status: string; method: string | null; paused: boolean; name: string; language: string; consent: 'pending' | 'yes' | 'notnow' | 'withdrawn' }
export interface CodeCardView { month: string; version: number; codes: Record<string, string>; today: number }
export interface Incident { id: string; severity: string; category: string; reported_at: string; ack_at: string | null; resolved_at: string | null; resolution_note: string | null; plan: { offsetMin: number; to: string; channels: string[]; purpose: string; sent: boolean; stopped: boolean }[] }
export interface HealthItem { id: string; pet_id: string; kind: string; label: string; given_on: string | null; next_due: string | null; source: string; state: string }
export interface Member { id: string; role: string; status: string; name: string; backup_address_authorised: boolean }

/* ---------- Phase 3 shapes ---------- */
export type FFTask = 'feed' | 'walk' | 'meds' | 'water' | 'litter' | 'toilet';
export interface Parsed { tasks: FFTask[]; petId: string | null; time: number | null; durationMin: number; access: string | null; lift: string | null; urgency: string; medsInstructions: string | null; sources: Record<string, string> }
export interface ReqView { origin?: { jobId: string; text: string } | null; searchOpen?: boolean; id: string; state: string; text?: string; parser: string | null; parsedBy?: string; aiConnected?: boolean; fallbackReason?: string; parsed: Parsed | null; clarifications: { field: string; question: string; options: { value: string; label: string }[] }[]; blocked: string[]; correctedFields: string[]; taskTime: number | null; mode: string | null; recipients: { friendId: string; state: string; sentAt: number; reminded: boolean; proposal?: number; name: string }[]; holdFriendId?: string; holdAt?: number; confirmedFriendId?: string; confirmedName?: string | null; history: { at: number; state: string; note: string }[]; coverTaskId: string | null; searchClosesAt: number | null; exclude: string[]; needsManualForm?: boolean }
export interface Suggestion { id: string; name: string; distance: string; language: string; reasons: string[]; message: string }
export interface SearchResult { request: ReqView; top: Suggestion[]; excludedCounts: Record<string, number>; nearbyFallback: { offered: boolean; reason: string }; laterOptions: string }
export interface FriendSummary { id: string; name: string; invited: boolean; findable: boolean; distance: string; availability: string; key: string; language: string }
export interface FriendProfileView { id: string; name: string; invited?: boolean; note?: string; distance?: string; language?: string; capabilities?: Record<string, boolean>; availability?: string; key?: string; stairsOk?: boolean; history?: string; responseBand?: string; updated?: string; disclaimer?: string }
export interface Privacy { society: string; tower: string; loc_share: string; friendsSee: string[]; hiddenUntilConfirmed: string[]; nearbyFallback: { available: boolean; reason: string } }
export interface FriendSelf { profile: { discoverable: boolean; opt_out_requested_at: string | null; paused: boolean; paused_until: string | null; windows: [number, number][]; capabilities: Record<string, boolean>; key_mode: string; stairs_ok: boolean; live_location_allowed: boolean; nearby_opt_in: boolean } | null; links: { household_id: string; status: string; society: string; tower: string; owner: string }[]; language: string; requests: { id: string; state: string; myState: string; taskTime: number | null; confirmedForMe: boolean; accessActive: boolean; message: string }[]; messages: { request_id: string | null; direction: string; body: string; at: string }[] }
