import { describe, it, expect } from 'vitest';
import { aloneWindow, applyReturnCheck, returnCheckNeeded, healthState } from '../src/index.js';
import { T } from './helpers.js';

describe('alone window (PS-012)', () => {
  it('finds the longest gap between leaving, visits and returning', () => {
    const w = aloneWindow(T(9), T(19), [T(13), T(16)], 6);
    expect(w.longestMinutes).toBe(240); expect(w.exceeds).toBe(false);
  });
  it('warns when the helper can’t come and the gap exceeds the owner limit', () => {
    const w = aloneWindow(T(9), T(19), [], 6);
    expect(w.exceeds).toBe(true); expect([w.from, w.to]).toEqual([T(9), T(19)]);
  });
});

describe('return check (PS-033, PRD 10.5)', () => {
  const all = { food: 0, water: 0, pad: 0, pet: 0, damage: 0 } as const;
  it('#11 matches an unconfirmed task the owner sees was done (no points)', () => {
    expect(applyReturnCheck([{ id: 'a', type: 'litter', state: 'Not confirmed', helperTask: true }], all)[0]!.result).toBe('matched');
  });
  it('#12 contradicts a Likely task when the bowl is untouched', () => {
    const r = applyReturnCheck([{ id: 'a', type: 'feeding', state: 'Likely', helperTask: true }], { ...all, food: 1 });
    expect(r[0]).toEqual({ taskId: 'a', result: 'contradicted', what: 'food bowl untouched' });
  });
  it('medicine is never observable on return', () => {
    expect(applyReturnCheck([{ id: 'm', type: 'medicine', state: 'Not confirmed', helperTask: true }], all)[0]!.result).toBe('unchanged');
  });
  it('is offered mainly when evidence is incomplete', () => {
    expect(returnCheckNeeded(['Confirmed', 'Likely'])).toBe(false);
    expect(returnCheckNeeded(['Confirmed', 'Not confirmed'])).toBe(true);
  });
});

describe('health reminders (PS-041)', () => {
  it('upcoming / due soon / due / overdue / snoozed / done', () => {
    expect(healthState('2026-11-20', '2026-11-06')).toBe('upcoming');
    expect(healthState('2026-11-08', '2026-11-06')).toBe('due_soon');
    expect(healthState('2026-11-06', '2026-11-06')).toBe('due');
    expect(healthState('2026-10-29', '2026-11-06')).toBe('overdue');
    expect(healthState('2026-10-29', '2026-11-06', { snoozedUntil: '2026-11-07' })).toBe('snoozed');
    expect(healthState('2026-10-29', '2026-11-06', { done: true })).toBe('done');
  });
});
