/** Helper rewards — PS-028, PS-042–044, PS-126 (pilot switch). Coupon points only; never cash. */
import type { Confidence } from './types.js';

export interface RewardPolicy { pointsPerTask: number; monthlyCapPerHousehold: number; couponPoints: number; couponRupees: number; expiryMonths: number; holdDays: number }
export const REWARDS_V1: RewardPolicy = { pointsPerTask: 5, monthlyCapPerHousehold: 125, couponPoints: 500, couponRupees: 20, expiryMonths: 6, holdDays: 7 };

export type PointsDecision = { kind: 'earn'; points: number } | { kind: 'hold'; points: number; reason: string } | { kind: 'none'; reason: string };

export function pointsFor(state: Confidence, opts: { armOn: boolean; isHelperTask: boolean; monthEarnedInHousehold: number }, p: RewardPolicy = REWARDS_V1): PointsDecision {
  if (!opts.armOn) return { kind: 'none', reason: 'rewards_arm_off' };
  if (!opts.isHelperTask) return { kind: 'none', reason: 'not_helper_task' };
  if (state === 'Mismatch') return { kind: 'hold', points: p.pointsPerTask, reason: 'mismatch_hold' };
  if (state !== 'Confirmed' && state !== 'Likely') return { kind: 'none', reason: state === 'Matched' ? 'matched_owner_check_no_points' : 'no_points_' + state.toLowerCase().replace(/ /g, '_') };
  const room = Math.max(0, p.monthlyCapPerHousehold - opts.monthEarnedInHousehold);
  if (room === 0) return { kind: 'none', reason: 'monthly_cap_reached' };
  return { kind: 'earn', points: Math.min(p.pointsPerTask, room) };
}

export const pointsToRupees = (pts: number, p: RewardPolicy = REWARDS_V1) => (pts / p.couponPoints) * p.couponRupees;
