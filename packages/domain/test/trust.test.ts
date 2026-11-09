import { describe, it, expect } from 'vitest';
import { evaluateTask, evaluateVisit, photoSampleRate, transition, LifecycleError, pointsFor, checkCode, generateCard, redactCodes } from '../src/index.js';
import { T, task, photo, voice, ivr, call, gate, visit } from './helpers.js';

const ev = (t: ReturnType<typeof task>, signals: Parameters<typeof visit>[0] = [], now = T(14)) => {
  const v = evaluateVisit(visit(signals), [t], t.signals.some(s => s.kind === 'photo' && s.code === 'today'), now);
  return evaluateTask(t, { now, visit: v });
};

describe('confidence rules v1 (PRD 10.5, PS-030, PS-122)', () => {
  it('#3 photo with today’s code alone is Likely, never Confirmed', () => {
    expect(ev(task({ signals: [photo(T(13, 5))] })).state).toBe('Likely');
  });
  it('photo + code + sufficient arrival/exit calls → Confirmed (two independent channels)', () => {
    const r = ev(task({ signals: [photo(T(13, 8))] }), [call('call_arrive', T(13, 4)), call('call_exit', T(13, 22))]);
    expect(r.state).toBe('Confirmed');
    expect(r.reasons.join()).toMatch(/R-VISIT-CALLS-OK/);
  });
  it('photo + code + owner-provided gate entry → Confirmed', () => {
    expect(ev(task({ signals: [photo(T(13, 8))] }), [gate(T(13, 2))]).state).toBe('Confirmed');
  });
  it('#18 arrival/exit only → visit Likely, task Not confirmed (visit only)', () => {
    const t = task();
    const v = evaluateVisit(visit([call('call_arrive', T(13, 4)), call('call_exit', T(13, 22))]), [t], false, T(13, 40));
    expect(v.status).toBe('Likely');
    const r = evaluateTask(t, { now: T(13, 40), visit: v });
    expect(r.state).toBe('Not confirmed');
    expect(r.visitOnly).toBe(true);
  });
  it('#4 visit shorter than the summed minimum is Not confirmed', () => {
    const tasks = [task({ minMinutes: 5 }), task({ minMinutes: 3 }), task({ minMinutes: 3 })];
    const v = evaluateVisit(visit([call('call_arrive', T(13, 4)), call('call_exit', T(13, 10))]), tasks, false, T(14));
    expect(v.minimum).toBe(11);
    expect(v.status).toBe('Not confirmed');
  });
  it('visit minimum is capped at 30 minutes', () => {
    const v = evaluateVisit(visit([]), [task({ minMinutes: 15 }), task({ minMinutes: 15 }), task({ minMinutes: 5 })], false, T(14));
    expect(v.minimum).toBe(30);
  });
  it('calls from an unregistered number never count', () => {
    const v = evaluateVisit(visit([call('call_arrive', T(13, 4), false), call('call_exit', T(13, 30), false)]), [task()], false, T(14));
    expect(v.status).toBeNull();
  });
  it('arrival without exit is "In progress" before it counts as one call only', () => {
    const v = evaluateVisit(visit([call('call_arrive', T(13, 4))]), [task()], false, T(13, 10));
    expect(v.status).toBe('In progress');
  });
  it('photo without code, voice naming task, IVR code after prompt → Likely each', () => {
    expect(ev(task({ signals: [photo(T(13), 'none')] })).state).toBe('Likely');
    expect(ev(task({ signals: [voice(T(13))] })).state).toBe('Likely');
    expect(ev(task({ signals: [ivr(T(13))] })).state).toBe('Likely');
  });
  it('wrong or old code → Not confirmed', () => {
    expect(ev(task({ signals: [photo(T(13), 'wrong')] })).state).toBe('Not confirmed');
    expect(ev(task({ signals: [photo(T(13), 'old')] })).state).toBe('Not confirmed');
    expect(ev(task({ signals: [ivr(T(13), false)] })).state).toBe('Not confirmed');
  });
  it('#19 a duplicate image hash never counts again', () => {
    const r = ev(task({ signals: [photo(T(13), 'today', 'img#a', true)] }));
    expect(r.state).toBe('Missed');
    expect(r.reasons.join()).toMatch(/R-HASH-REUSED/);
  });
  it('nothing by due + grace → Missed; before that → Pending', () => {
    expect(ev(task(), [], T(13, 29)).state).toBe('Pending');
    expect(ev(task(), [], T(13, 30)).state).toBe('Missed');
  });
  it('medicine grace is 15 min, walk 45 min', () => {
    expect(ev(task({ profile: 'medicine' }), [], T(13, 15)).state).toBe('Missed');
    expect(ev(task({ profile: 'walk' }), [], T(13, 44)).state).toBe('Pending');
  });
  it('late evidence within 3 h is kept and labelled late; later is ignored', () => {
    const late = ev(task({ signals: [photo(T(15))] }), [], T(15, 5));
    expect(late.state).toBe('Likely'); expect(late.late).toBe(true);
    expect(ev(task({ signals: [photo(T(16, 31))] }), [], T(17)).state).toBe('Missed');
  });
  it('return check: Matched when it confirms an unconfirmed task; Mismatch when it contradicts', () => {
    expect(ev(task({ returnCheck: { at: T(19), matched: true } }), [], T(19)).state).toBe('Matched');
    expect(ev(task({ signals: [photo(T(13))], returnCheck: { at: T(19), contradicted: 'food bowl untouched' } }), [], T(19)).state).toBe('Mismatch');
  });
  it('#10 Trusted Helper mode creates no monitoring', () => {
    const r = evaluateTask(task(), { now: T(20), trustedHelperDay: true });
    expect(r.state).toBe('Trusted'); expect(r.needsEscalation).toBe(false);
  });
  it('#5 random photo prompts rise to 1 in 5 without a gate app', () => {
    expect(photoSampleRate({ gateApp: true, mismatchInLast14Days: false })).toBe(0.1);
    expect(photoSampleRate({ gateApp: false, mismatchInLast14Days: false })).toBe(0.2);
  });
});

describe('task lifecycle (PS-121)', () => {
  it('#20 cancel needs a reason and history is appended, not overwritten', () => {
    const t = task();
    expect(() => transition(t, 'Cancelled by owner', 'owner', T(9))).toThrow(LifecycleError);
    const c = transition(t, 'Cancelled by owner', 'owner', T(9), 'At the vet');
    expect(c.lifecycle.map(x => x.state)).toEqual(['Planned', 'Cancelled by owner']);
    expect(evaluateTask(c, { now: T(20) }).state).toBe('Cancelled');
  });
  it('#20 partly done lists what was skipped', () => {
    const p = transition(task(), 'Partly done', 'owner', T(14), 'Water not refilled');
    expect(p.lifecycle.at(-1)?.note).toBe('Water not refilled');
  });
  it('done reported without evidence stays Not confirmed', () => {
    const d = transition(task(), 'Done reported', 'helper', T(13, 10));
    expect(evaluateTask(d, { now: T(14) }).state).toBe('Not confirmed');
  });
});

describe('rewards (PS-028, PS-044, PS-126)', () => {
  it('5 points per Confirmed/Likely, none for Matched, capped at 125 per household per month', () => {
    expect(pointsFor('Likely', { armOn: true, isHelperTask: true, monthEarnedInHousehold: 0 })).toEqual({ kind: 'earn', points: 5 });
    expect(pointsFor('Matched', { armOn: true, isHelperTask: true, monthEarnedInHousehold: 0 }).kind).toBe('none');
    expect(pointsFor('Confirmed', { armOn: true, isHelperTask: true, monthEarnedInHousehold: 123 })).toEqual({ kind: 'earn', points: 2 });
    expect(pointsFor('Confirmed', { armOn: true, isHelperTask: true, monthEarnedInHousehold: 125 }).kind).toBe('none');
  });
  it('#14 mismatch holds points; control arm earns nothing', () => {
    expect(pointsFor('Mismatch', { armOn: true, isHelperTask: true, monthEarnedInHousehold: 0 }).kind).toBe('hold');
    expect(pointsFor('Confirmed', { armOn: false, isHelperTask: true, monthEarnedInHousehold: 0 }).kind).toBe('none');
  });
});

describe('code card (PS-024, PS-109)', () => {
  const rnd = (k: number) => Uint32Array.from({ length: k }, (_, i) => i * 7919 + 13);
  it('today / old (rotated or other day) / wrong', () => {
    const v1 = generateCard('h1', '2026-11', 1, 30, rnd);
    const v2 = { ...generateCard('h1', '2026-11', 2, 30, (k) => Uint32Array.from({ length: k }, (_, i) => i * 104729 + 7)) };
    const cards = [{ ...v1, active: false }, v2];
    expect(checkCode(cards, 6, v2.codes[6]!)).toBe('today');
    expect(checkCode(cards, 6, v1.codes[6]!)).toBe('old');
    expect(checkCode(cards, 6, '0000')).toBe('wrong');
  });
  it('codes never appear in notification previews', () => {
    expect(redactCodes('Today’s code 4827 was used')).toBe('Today’s code •••• was used');
  });
});
