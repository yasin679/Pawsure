import { describe, it, expect } from 'vitest';
import { assignArms, releaseCheck } from '../src/index.js';

const homes = Array.from({ length: 20 }, (_, i) => ({ id: 'hh' + String(i).padStart(2, '0'), stratum: i < 7 ? 'gate' : 'no-gate' }));
describe('pilot cohort (§4.2 PS-126)', () => {
  it('puts exactly 10 of 20 homes in the rewards arm, balanced within strata', () => {
    const a = assignArms(homes, 42);
    expect(Object.values(a).filter(Boolean).length).toBe(10);
    const gateOn = homes.filter(h => h.stratum === 'gate' && a[h.id]).length;
    expect([3, 4]).toContain(gateOn);
  });
  it('is reproducible from the seed and changes with it', () => {
    expect(assignArms(homes, 42)).toEqual(assignArms(homes, 42));
    expect(assignArms(homes, 42)).not.toEqual(assignArms(homes, 43));
  });
  it('release check passes only with §4.2 defaults', () => {
    const flags = { helperShareRecord: { value: false, locked: false }, nearbyMemberFallback: { value: false, locked: true }, friendThankYouPoints: { value: false, locked: false }, ownerCameraLookIn: { value: false, locked: false }, dayCare: { value: false, locked: true }, verifiedCarers: { value: false, locked: true } };
    const arms = Object.values(assignArms(homes, 1));
    expect(releaseCheck(flags, arms).every(i => i.ok)).toBe(true);
    expect(releaseCheck({ ...flags, helperShareRecord: { value: true, locked: false } }, arms).find(i => i.item === 'helperShareRecord')!.ok).toBe(false);
    expect(releaseCheck({ ...flags, nearbyMemberFallback: { value: false, locked: false } }, arms).find(i => i.item === 'nearbyMemberFallback')!.ok).toBe(false);
    expect(releaseCheck(flags, [true, true, true, false]).find(i => i.item === 'helperRewards arms')!.ok).toBe(false);
    expect(releaseCheck(flags, [true]).find(i => i.item === 'helperRewards arms')!.ok).toBe(false); // one home is not a split
  });
});
