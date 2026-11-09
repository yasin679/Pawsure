/**
 * Deterministic eligibility and nearest-first ranking (PS-057, PS-058, PS-066, PRD 9.2).
 * AI is never consulted here. No paid placement, thank-you points or sensitive attributes in ranking.
 */
import type { Minutes } from '../types.js';
import type { FFTask, ParsedRequest } from './parse.js';

export type Capability = 'feed' | 'walk' | 'meds' | 'large';
export interface FriendProfile {
  id: string; displayName: string; distanceBand: number; distanceLabel: string; language: 'en' | 'hi' | 'mr';
  inviteAccepted: boolean; discoverable: boolean; optOutPending?: boolean; paused: boolean; blocked: boolean;
  windows: [Minutes, Minutes][]; windowsLabel: string; capabilities: Partial<Record<Capability, boolean>>;
  key: 'yes' | 'handover' | 'no'; stairsOk: boolean; capacity: number; activeRequests: number;
  helpCount: number; checkedInCount: number; responseBand: string; responseRank: number; updatedLabel: string;
}

export const capabilitiesNeeded = (tasks: FFTask[]): Capability[] => {
  const c = new Set<Capability>();
  if (tasks.some(t => t === 'feed' || t === 'water' || t === 'litter' || t === 'toilet')) c.add('feed');
  if (tasks.includes('walk')) c.add('walk');
  if (tasks.includes('meds')) c.add('meds');
  return [...c];
};

export interface Match { friend: FriendProfile; reasons: string[] }
export interface MatchResult { top: Match[]; eligible: Match[]; excludedCounts: Record<string, number> }

export function matchFriends(req: ParsedRequest, friends: FriendProfile[], opts: { maxBand: number; exclude?: string[]; largeOrAnxiousPet?: boolean }): MatchResult {
  if (req.time == null) throw new Error('Search requires a confirmed time');
  const start = req.time, end = req.time + req.durationMin, need = capabilitiesNeeded(req.tasks);
  if (opts.largeOrAnxiousPet) need.push('large');
  const excluded: Record<string, number> = {}; const X = (k: string) => { excluded[k] = (excluded[k] ?? 0) + 1; };
  const eligible: Match[] = [];
  for (const f of friends) {
    if (opts.exclude?.includes(f.id)) { X('Excluded on this request'); continue; }
    if (f.blocked) { X('Blocked'); continue; }
    if (!f.inviteAccepted || !f.discoverable || f.optOutPending) { X('Has not opted in to be found'); continue; }
    if (f.paused) { X('Paused requests'); continue; }
    if (!f.windows.some(([a, b]) => a <= start && b >= end)) { X('Not free at that time'); continue; }
    const missing = need.find(c => !f.capabilities[c]);
    if (missing) { X(missing === 'meds' ? 'Has not chosen medicine tasks' : `Has not chosen ${missing}`); continue; }
    if (f.activeRequests >= f.capacity) { X('Already helping someone'); continue; }
    if (req.access === 'Key handover' && f.key === 'no') { X('Cannot do key handover'); continue; }
    if (req.lift === 'Stairs needed' && !f.stairsOk) { X('Needs the lift'); continue; }
    if (f.distanceBand > opts.maxBand) { X('Beyond your distance limit'); continue; }
    const CAP_LABEL: Record<Capability, string> = { feed: 'Feeding / water', walk: 'Short walks', meds: 'Medicines', large: 'Large / anxious dogs' };
    const reasons = [`Usually free ${f.windowsLabel} (updated ${f.updatedLabel})`, f.distanceLabel, ...need.map(c => `Chose “${CAP_LABEL[c]}”`), f.key === 'yes' ? 'Has a key arrangement' : 'OK with key handover'];
    if (f.stairsOk) reasons.push('Fine with stairs');
    if (f.helpCount >= 5) reasons.push(`Helped ${f.helpCount} times, ${Math.round((f.checkedInCount / f.helpCount) * 100)}% checked in`);
    else if (f.helpCount > 0) reasons.push(`Helped ${f.helpCount} times (small sample)`);
    reasons.push(f.responseBand);
    eligible.push({ friend: f, reasons });
  }
  eligible.sort((a, b) => a.friend.distanceBand - b.friend.distanceBand
    || (a.friend.key === 'yes' ? 0 : 1) - (b.friend.key === 'yes' ? 0 : 1)
    || a.friend.responseRank - b.friend.responseRank
    || a.friend.displayName.localeCompare(b.friend.displayName));
  return { top: eligible.slice(0, 3), eligible, excludedCounts: excluded };
}

/** PS-069: show history only with a qualifier for small samples. */
export const historySummary = (f: Pick<FriendProfile, 'helpCount' | 'checkedInCount'>) =>
  f.helpCount === 0 ? 'No helps yet' : f.helpCount < 5 ? `${f.checkedInCount} of ${f.helpCount} checked in (too few to show a %)` : `${Math.round((f.checkedInCount / f.helpCount) * 100)}% checked in over ${f.helpCount} helps`;
