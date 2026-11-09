import { describe, it, expect } from 'vitest';
import { wallet, expiryFor, decideHold, streak, safeCuts, maskPhone, rightsDue, boardReportDue, type LedgerEntry } from '../src/index.js';

const e = (points: number, state: LedgerEntry['state'], month = '2026-11', expiresAt = '2027-05-06', householdId = 'h1'): LedgerEntry => ({ points, state, month, createdAt: month + '-06', expiresAt, householdId });

describe('wallet (PS-042, PS-126)', () => {
  it('sums available and held, per-household month totals, coupons at 500 points', () => {
    const w = wallet([e(5, 'earned'), e(5, 'earned', '2026-11', '2027-05-06', 'h2'), e(5, 'held'), e(490, 'earned', '2026-10'), e(5, 'released')], '2026-11-06');
    expect(w.available).toBe(505); expect(w.held).toBe(5);
    expect(w.earnedThisMonthByHousehold).toEqual({ h1: 10, h2: 5 });
    expect(w.couponsAvailable).toBe(1); expect(w.toNextCoupon).toBe(495);
  });
  it('expired points do not count; points expire 6 months after earning', () => {
    expect(wallet([e(50, 'earned', '2026-04', '2026-10-01')], '2026-11-06').available).toBe(0);
    expect(expiryFor('2026-11-06')).toBe('2027-05-06');
  });
});

describe('holds and streaks (PS-044, PS-105)', () => {
  it('a decision needs a readable reason', () => {
    expect(() => decideHold('reverse', 'no')).toThrow();
    expect(decideHold('release', 'Helper explained: bowl was refilled')).toBe('released');
  });
  it('streak counts consecutive days with evidence (badge only)', () => {
    expect(streak(['2026-11-06', '2026-11-05', '2026-11-04', '2026-11-02'], '2026-11-06')).toBe(3);
  });
});

describe('privacy-safe reporting (PS-117)', () => {
  it('groups under 5 are suppressed', () => {
    const rows = [...Array(6).fill({ group: 'photo', ok: true }), { group: 'photo', ok: false }, ...Array(3).fill({ group: 'ivr', ok: true })];
    const cuts = safeCuts(rows);
    expect(cuts.find(c => c.group === 'photo')).toEqual({ group: 'photo', n: 7, value: 85.7, suppressed: false });
    expect(cuts.find(c => c.group === 'ivr')).toEqual({ group: 'ivr', n: 3, value: null, suppressed: true });
  });
  it('phones are masked; rights and breach clocks', () => {
    expect(maskPhone('+919000000035')).toBe('+91 •••• ••35');
    expect(rightsDue('2026-11-06T00:00:00Z').target).toBe('2026-11-13T00:00:00.000Z');
    expect(boardReportDue('2026-11-06T10:00:00Z')).toBe('2026-11-09T10:00:00.000Z');
  });
});
