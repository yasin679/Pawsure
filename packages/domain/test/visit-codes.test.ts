import { describe, it, expect } from 'vitest';
import { evaluateVisit, evaluateTask, type VisitSignal, type CareVisit } from '../src/index.js';
import { T, task, call } from './helpers.js';

/** A photo the helper sent showing the random start / end code (true = it matched). */
let n = 0;
const codePhoto = (kind: 'code_start' | 'code_end', at: number, codeOk = true, duplicate = false): VisitSignal =>
  ({ id: 'vc' + ++n, kind, codeOk, duplicate, registeredNumber: true, eventTime: at, receivedTime: at, source: 'whatsapp' });
const visit = (signals: VisitSignal[], codes: CareVisit['codes']): CareVisit => ({ id: 'v1', who: 'sunita', signals, codes });
const calls = [call('call_arrive', T(13, 0)), call('call_exit', T(13, 20))];
const sent = { start: T(13, 0), end: T(13, 20) };

describe('random start and end codes for a visit', () => {
  it('both code photos in time + long-enough calls → visit Confirmed', () => {
    const v = evaluateVisit(visit([...calls, codePhoto('code_start', T(13, 3)), codePhoto('code_end', T(13, 24))], sent), [task()], false, T(14));
    expect(v.codes).toEqual({ start: 'ok', end: 'ok' });
    expect(v.status).toBe('Confirmed');
    expect(v.reasons.join()).toMatch(/R-START-CODE-OK.*R-END-CODE-OK/);
  });

  it('calls only, codes never sent → unchanged: Likely, no code reasons', () => {
    const v = evaluateVisit(visit(calls, undefined), [task()], false, T(14));
    expect(v.codes).toEqual({ start: null, end: null });
    expect(v.status).toBe('Likely');
    expect(v.reasons.join()).not.toMatch(/CODE/);
  });

  it('codes sent but no photos came → Likely, with CODE-MISSING shown', () => {
    const v = evaluateVisit(visit(calls, sent), [task()], false, T(14));
    expect(v.codes).toEqual({ start: 'missing', end: 'missing' });
    expect(v.status).toBe('Likely');
    expect(v.reasons.join()).toMatch(/R-START-CODE-MISSING/);
  });

  it('a wrong code → visit Not confirmed even with long-enough calls', () => {
    const v = evaluateVisit(visit([...calls, codePhoto('code_start', T(13, 3)), codePhoto('code_end', T(13, 22), false)], sent), [task()], false, T(14));
    expect(v.codes.end).toBe('wrong');
    expect(v.status).toBe('Not confirmed');
  });

  it('a wrong code then the right one in time counts as ok', () => {
    const v = evaluateVisit(visit([...calls, codePhoto('code_start', T(13, 1), false), codePhoto('code_start', T(13, 4)), codePhoto('code_end', T(13, 25))], sent), [task()], false, T(14));
    expect(v.codes.start).toBe('ok');
    expect(v.status).toBe('Confirmed');
  });

  it('the right code after the 10-minute limit is late and does not confirm', () => {
    const v = evaluateVisit(visit([...calls, codePhoto('code_start', T(13, 15)), codePhoto('code_end', T(13, 24))], sent), [task()], false, T(14));
    expect(v.codes.start).toBe('late');
    expect(v.status).toBe('Likely');
  });

  it('a photo sent before the code existed, or a re-sent photo, never counts', () => {
    const v = evaluateVisit(visit([...calls, codePhoto('code_start', T(12, 58)), codePhoto('code_end', T(13, 22), true, true)], sent), [task()], false, T(14));
    expect(v.codes).toEqual({ start: 'missing', end: 'missing' });
    expect(v.status).toBe('Likely');
  });

  it('during the visit the start code shows as waiting, then ok', () => {
    const waiting = evaluateVisit(visit([calls[0]!], { start: T(13) }), [task()], false, T(13, 5));
    expect(waiting.status).toBe('In progress');
    expect(waiting.codes.start).toBe('waiting');
    const ok = evaluateVisit(visit([calls[0]!, codePhoto('code_start', T(13, 4))], { start: T(13) }), [task()], false, T(13, 6));
    expect(ok.codes.start).toBe('ok');
  });

  it('codes confirm the visit, never the task on their own', () => {
    const t = task();
    const v = evaluateVisit(visit([...calls, codePhoto('code_start', T(13, 3)), codePhoto('code_end', T(13, 24))], sent), [t], false, T(14));
    const r = evaluateTask(t, { now: T(14), visit: v });
    expect(r.state).toBe('Not confirmed');
    expect(r.visitOnly).toBe(true);
  });
});
