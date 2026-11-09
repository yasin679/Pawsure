/**
 * Pilot cohort configuration (master prompt §4.2, §14): rewards ON for half the homes, balanced within strata
 * (gate app yes/no), reproducible from a recorded seed; and a release check that the P0 switches match §4.2.
 */
export interface CohortHome { id: string; stratum: string }

/** Small seeded PRNG (mulberry32) so an assignment can be reproduced from its seed in the decision log. */
export function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Shuffle within each stratum, alternate ON/OFF; odd leftovers alternate across strata so the arms differ by at most one. */
export function assignArms(homes: CohortHome[], seed: number): Record<string, boolean> {
  const r = rng(seed), out: Record<string, boolean> = {};
  const strata = [...new Set(homes.map(h => h.stratum))].sort();
  let nextOdd = r() < 0.5;
  for (const s of strata) {
    const g = homes.filter(h => h.stratum === s).map(h => h.id).sort();
    for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [g[i], g[j]] = [g[j]!, g[i]!]; }
    const half = Math.floor(g.length / 2);
    g.forEach((id, i) => { out[id] = i < half; });
    if (g.length % 2 === 1) { out[g[g.length - 1]!] = nextOdd; nextOdd = !nextOdd; }
  }
  return out;
}

export interface ReleaseItem { item: string; ok: boolean; detail: string }
/** §4.2 / §18: the switches the pilot must start with. Values are the stored flag values. */
export function releaseCheck(flags: Record<string, { value: unknown; locked: boolean }>, arms: boolean[]): ReleaseItem[] {
  const f = (k: string) => flags[k];
  const off = (k: string, mustLock = false): ReleaseItem => ({ item: k, ok: f(k)?.value === false && (!mustLock || !!f(k)?.locked), detail: `${String(f(k)?.value)}${f(k)?.locked ? ' (locked)' : ''} — must be OFF${mustLock ? ' and locked' : ''}` });
  const on = arms.filter(Boolean).length;
  return [
    { item: 'helperRewards arms', ok: arms.length >= 2 && Math.abs(on - (arms.length - on)) <= 1, detail: arms.length < 2 ? `only ${arms.length} home — assign arms once the cohort has enrolled (10 of 20 ON)` : `${on} of ${arms.length} homes ON — must be half (10 of 20)` },
    off('helperShareRecord'), off('nearbyMemberFallback', true), off('friendThankYouPoints'), off('ownerCameraLookIn'), off('dayCare', true), off('verifiedCarers', true)
  ];
}
