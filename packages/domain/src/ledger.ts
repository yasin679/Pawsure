/**
 * Reward ledger maths (PS-028, PS-042–044, PS-105, PS-126) and privacy-safe reporting (PS-117, §6.9).
 * Points are coupon points only — never cash. A person, not a rule, decides held points.
 */
import { REWARDS_V1, type RewardPolicy } from './rewards.js';

export type LedgerState = 'earned' | 'held' | 'released' | 'reversed' | 'expired' | 'redeemed';
export interface LedgerEntry { points: number; state: LedgerState; month: string; createdAt: string | Date; expiresAt?: string | Date | null; householdId: string }
const day10 = (v: string | Date) => (typeof v === "string" ? v : v.toISOString()).slice(0, 10);

export interface Wallet { available: number; held: number; earnedThisMonthByHousehold: Record<string, number>; expiringSoon: number; couponsAvailable: number; toNextCoupon: number }
export function wallet(entries: LedgerEntry[], today: string, p: RewardPolicy = REWARDS_V1): Wallet {
  const month = today.slice(0, 7);
  const live = entries.filter(e => !e.expiresAt || day10(e.expiresAt) >= today);
  const available = live.filter(e => e.state === 'earned' || e.state === 'released').reduce((a, e) => a + e.points, 0) - live.filter(e => e.state === 'redeemed').reduce((a, e) => a + e.points, 0);
  const held = live.filter(e => e.state === 'held').reduce((a, e) => a + e.points, 0);
  const byHh: Record<string, number> = {};
  entries.filter(e => e.month === month && (e.state === 'earned' || e.state === 'released')).forEach(e => { byHh[e.householdId] = (byHh[e.householdId] ?? 0) + e.points; });
  const in30 = new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10);
  const expiringSoon = live.filter(e => (e.state === 'earned' || e.state === 'released') && e.expiresAt && day10(e.expiresAt) <= in30).reduce((a, e) => a + e.points, 0);
  return { available, held, earnedThisMonthByHousehold: byHh, expiringSoon, couponsAvailable: Math.floor(available / p.couponPoints), toNextCoupon: p.couponPoints - (available % p.couponPoints) };
}

/** Points expire 6 months after they are earned. */
export const expiryFor = (earnedOn: string, p: RewardPolicy = REWARDS_V1) => { const d = new Date(earnedOn); d.setMonth(d.getMonth() + p.expiryMonths); return d.toISOString().slice(0, 10); };

/** Held points must be decided within the hold window (7 days); a review note is mandatory either way. */
export function decideHold(decision: 'release' | 'reverse', note: string): LedgerState {
  if (note.trim().length < 5) throw new Error('A reason the helper can read is required');
  return decision === 'release' ? 'released' : 'reversed';
}

/** Streaks are a badge only — counted in days with at least one Confirmed/Likely helper task. */
export function streak(daysWithEvidence: string[], today: string): number {
  const set = new Set(daysWithEvidence); let n = 0; const d = new Date(today);
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/**
 * Reporting cuts: groups smaller than the minimum are suppressed, never shown (PS-117: min group size 5).
 * Individual helpers are never ranked or listed in analytics.
 */
export const MIN_GROUP = 5;
export interface Cut { group: string; n: number; value: number | null; suppressed: boolean }
export function safeCuts(rows: { group: string; ok: boolean }[], min = MIN_GROUP): Cut[] {
  const by = new Map<string, { n: number; ok: number }>();
  rows.forEach(r => { const g = by.get(r.group) ?? { n: 0, ok: 0 }; g.n++; if (r.ok) g.ok++; by.set(r.group, g); });
  return [...by.entries()].map(([group, g]) => g.n < min ? { group, n: g.n, value: null, suppressed: true } : { group, n: g.n, value: Math.round((g.ok / g.n) * 1000) / 10, suppressed: false });
}

/** Masks a phone for any BI / admin list view (no raw phone numbers in BI). */
export const maskPhone = (e164: string) => e164.length > 6 ? e164.slice(0, 3) + ' •••• ••' + e164.slice(-2) : '••••';

/** DPDP: grievance and rights requests — pilot target 7 days, legal outer limit 90 days (PS-119). */
export function rightsDue(createdIso: string) {
  const t = Date.parse(createdIso);
  return { target: new Date(t + 7 * 86400000).toISOString(), legalLimit: new Date(t + 90 * 86400000).toISOString() };
}
/** Breach: notify the Data Protection Board within 72 hours of becoming aware (PS-120). */
export const boardReportDue = (awareIso: string) => new Date(Date.parse(awareIso) + 72 * 3600000).toISOString();
