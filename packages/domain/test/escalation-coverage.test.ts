import { describe, it, expect } from 'vitest';
import { evaluateTask, escalationState, escalationTimes, canOpenLookIn, coveredDay, dueSteps, resolveIncident, severityOf, can, canSeeAddress, type TaskOutcome } from '../src/index.js';
import { T, task, photo } from './helpers.js';

describe('escalation defaults (PS-101, PS-102)', () => {
  it('#7 4 PM task: owner 4:30, backup 5:00, cover 5:15', () => {
    expect(escalationTimes(task({ due: T(16) }))).toEqual({ s1: T(16, 30), s2: T(17), s3: T(17, 15) });
  });
  it('medicine owner alert at +15, walk at +45', () => {
    expect(escalationTimes(task({ due: T(16), profile: 'medicine' })).s1).toBe(T(16, 15));
    expect(escalationTimes(task({ due: T(16), profile: 'walk' })).s1).toBe(T(16, 45));
  });
  it('#6 steps fire in order with no acknowledgement', () => {
    const t = task({ due: T(16) });
    const at = (now: number) => escalationState(t, evaluateTask(t, { now }), now)!.steps.map(s => s.fired);
    expect(at(T(16, 30))).toEqual([true, false, false]);
    expect(at(T(17))).toEqual([true, true, false]);
    expect(at(T(17, 15))).toEqual([true, true, true]);
  });
  it('#7 owner acknowledgement stops later steps', () => {
    const t = task({ due: T(16), escalation: { ackAt: T(16, 40), ackBy: 'owner' } });
    const s = escalationState(t, evaluateTask(t, { now: T(18) }), T(18))!;
    expect(s.steps.map(x => x.fired)).toEqual([true, false, false]);
    expect(s.steps[1]!.stoppedByAck).toBe(true);
  });
  it('D-10 medicine tasks never go to the backup: owner alert, then cover suggestions', () => {
    const t = task({ due: T(13), profile: 'medicine', type: 'medicine' });
    const s = escalationState(t, evaluateTask(t, { now: T(14, 30) }), T(14, 30))!;
    expect(s.backupExcluded).toBe(true);
    expect(s.steps.map(x => x.kind)).toEqual(['owner_alert', 'cover_suggestions']);
    expect(s.steps.map(x => [x.at, x.fired])).toEqual([[T(13, 15), true], [T(14), true]]);
  });
  it('D-10 a friend no-show on a medicine task skips the backup and goes straight to cover', () => {
    const t = task({ due: T(17), profile: 'medicine', type: 'medicine', escalation: { forceBackup: true } });
    const s = escalationState(t, evaluateTask(t, { now: T(17, 20) }), T(17, 20))!;
    expect(s.steps.map(x => x.kind + ':' + x.fired)).toEqual(['owner_alert:true', 'cover_suggestions:true']);
  });
  it('D-11 visit-only tasks escalate to the backup like missed tasks', () => {
    const t = task({ due: T(13) });
    const ev = { ...evaluateTask(t, { now: T(14) }), state: 'Not confirmed' as const, visitOnly: true, needsEscalation: true };
    expect(escalationState(t, ev, T(14))!.steps.find(x => x.kind === 'backup_lookin')!.fired).toBe(true);
  });
  it('a task with evidence does not escalate', () => {
    const t = task({ due: T(16), signals: [photo(T(16, 2))] });
    expect(escalationState(t, evaluateTask(t, { now: T(18) }), T(18))).toBeNull();
  });
  it('#8 look-in link: recipient-scoped, 15 minutes, dies on revocation', () => {
    const link = { id: 'l', taskId: 't', recipientId: 'ankita', createdAt: T(17), expiresAt: T(17, 15), revoked: false, showAddress: true };
    expect(canOpenLookIn(link, 'ankita', T(17, 5), true).ok).toBe(true);
    expect(canOpenLookIn(link, 'someone-else', T(17, 5), true).reason).toBe('not_recipient');
    expect(canOpenLookIn(link, 'ankita', T(17, 15), true).reason).toBe('expired');
    expect(canOpenLookIn(link, 'ankita', T(17, 5), false).reason).toBe('revoked');
  });
});

describe('covered care day (PS-111) — #12, #24', () => {
  const out = (petId: string, state: string, extra: Partial<TaskOutcome> = {}): TaskOutcome => ({ taskId: petId + state, petId, ev: { state: state as never, label: state, reasons: [], ruleSet: 'v1', needsEscalation: false }, esc: null, trusted: false, ...extra });
  it('Confirmed + Likely + Matched → Covered; verified only without Matched', () => {
    const r = coveredDay({ petIds: ['bruno'], outcomes: [out('bruno', 'Confirmed'), out('bruno', 'Likely'), out('bruno', 'Matched')], trustedCoveredTap: false, dayClosed: true });
    expect(r.household).toBe('Covered'); expect(r.verified).toBe(false);
  });
  it('missed but escalated and resolved by midnight → Covered; open escalation → Not covered', () => {
    const resolved = { open: false, resolved: true, acknowledged: true, steps: [] };
    const open = { open: true, resolved: false, acknowledged: true, steps: [] };
    expect(coveredDay({ petIds: ['b'], outcomes: [out('b', 'Missed', { esc: resolved })], trustedCoveredTap: false, dayClosed: true }).household).toBe('Covered');
    expect(coveredDay({ petIds: ['b'], outcomes: [out('b', 'Missed', { esc: open })], trustedCoveredTap: false, dayClosed: true }).household).toBe('Not covered');
  });
  it('Trusted Helper: tap = Covered, no tap = Unknown', () => {
    const o = [out('b', 'Trusted', { trusted: true })];
    expect(coveredDay({ petIds: ['b'], outcomes: o, trustedCoveredTap: true, dayClosed: true }).household).toBe('Covered');
    expect(coveredDay({ petIds: ['b'], outcomes: o, trustedCoveredTap: false, dayClosed: true }).household).toBe('Unknown');
  });
  it('household covered only if every pet is; cancelled tasks and no-task pets excluded', () => {
    const r = coveredDay({ petIds: ['bruno', 'misty', 'fish'], outcomes: [out('bruno', 'Confirmed'), out('misty', 'Not confirmed'), out('misty', 'Cancelled')], trustedCoveredTap: false, dayClosed: true });
    expect(r.pets.find(p => p.petId === 'fish')!.status).toBe('Excluded');
    expect(r.household).toBe('Not covered');
  });
});

describe('emergency severity (PS-124) — #9, #22', () => {
  it('maps categories to S1/S2/S3', () => {
    expect(severityOf('bite')).toBe('S1'); expect(severityOf('vomiting')).toBe('S2'); expect(severityOf('water_out')).toBe('S3');
  });
  it('#22 S1 with no answer: repeat calls at 5/10/15, all circle at 15, ops case at once', () => {
    const inc = { id: 'i', severity: 'S1' as const, category: 'pet_hurt', reportedAt: T(13) };
    const purposes = dueSteps(inc, T(13, 15)).map(s => s.step.purpose);
    expect(purposes).toEqual(['alert', 'emergency_card', 'open_case', 'repeat_call_1', 'repeat_call_2', 'repeat_call_3', 'call_everyone', 'call_vet_directly']);
  });
  it('acknowledgement stops repeats; closing needs a note', () => {
    const inc = { id: 'i', severity: 'S1' as const, category: 'pet_hurt', reportedAt: T(13), ackAt: T(13, 3) };
    expect(dueSteps(inc, T(13, 20)).map(s => s.step.purpose)).toEqual(['alert', 'emergency_card', 'open_case']);
    expect(() => resolveIncident(inc, T(14), ' ')).toThrow();
    expect(dueSteps(resolveIncident(inc, T(14), 'Vet checked, fine'), T(15))).toEqual([]);
  });
  it('S2: backup at 15, calls + ops review at 30', () => {
    const inc = { id: 'i', severity: 'S2' as const, category: 'vomiting', reportedAt: T(13) };
    expect(dueSteps(inc, T(13, 14)).length).toBe(1);
    expect(dueSteps(inc, T(13, 30)).map(s => s.step.purpose)).toEqual(['alert', 'alert_backup', 'call', 'review']);
  });
});

describe('permissions and tenant isolation (§5)', () => {
  it('no cross-household access for any household role', () => {
    expect(can('owner', 'pet', 'read', { sameHousehold: false })).toBe(false);
    expect(can('helper', 'task', 'read', { sameHousehold: false })).toBe(false);
  });
  it('backup sees pet and card only through a valid look-in link; address only if authorised', () => {
    expect(can('backup', 'emergency_card', 'read', { sameHousehold: true, linkValid: false })).toBe(false);
    expect(can('backup', 'emergency_card', 'read', { sameHousehold: true, linkValid: true })).toBe(true);
    expect(canSeeAddress('backup', { sameHousehold: true, linkValid: true, backupAuthorisedForAddress: false })).toBe(false);
  });
  it('#25 unaccepted friend cannot see access details or emergency card', () => {
    expect(can('friend', 'access_details', 'read', { sameHousehold: true, requestAccepted: false })).toBe(false);
    expect(can('friend', 'access_details', 'read', { sameHousehold: true, requestAccepted: true, ownerAuthorisedDisclosure: true })).toBe(true);
  });
  it('nearby members have no access while the switch is OFF', () => {
    expect(can('nearby_member', 'friend_request', 'read', { sameHousehold: true })).toBe(false);
  });
});
