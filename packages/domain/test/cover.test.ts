import { describe, it, expect } from 'vitest';
import {
  COVER_V1, COVER_STATES, COVER_EVENTS, coverConfig, coverTransition, canCover, nextSteps, coverSettled, coverBlocksDay, CoverError,
  planReminder, reminderDeadline, atRiskReason, isCantCome, parseSubstitute, orderBackups, nextBackupAction, jobMode, thinCircle, checklistReminderDue,
  friendFinderOpen, afterFriendCancel, defaultUrgency, alertGrace, notFoundOptions, circleCallDue, preDepartureCheck, planDelay, splitExtension, coverMetrics,
  coveredDay, COVERED_DAY_RULE, can, canSeeAddress, outreachAllowed, evaluateTask, escalationState,
  type BackupContact, type BackupJob, type CoverState, type CoverTaskView, type OwnerRoutineTask, type TaskOutcome, type Urgency
} from '../src/index.js';
import { T, task } from './helpers.js';

const g = (friendFinderOpen = true, urgency: Urgency = 'TimeSensitive') => ({ friendFinderOpen, urgency });
const B = (id: string, rank: number, holdsKey: boolean, canGiveMedicine = false, firstTime = false): BackupContact => ({ id, rank, holdsKey, canGiveMedicine, ownerArranged: id === 'vikram', firstTime });
const LIST = [B('desai', 1, true, false, true), B('ritu', 2, false, false, true), B('ankita', 3, true), B('rohan', 4, true, true), B('vikram', 5, false)];
const job = (p: Partial<BackupJob> = {}): BackupJob => ({ mode: 'pairs', startedAt: T(15, 15), firstDue: T(16), needsAccess: true, medicineOnly: false, urgencies: ['TimeSensitive'], standingApproval: true, ownerSent: false, asks: [], round: 0, roundAt: null, hold: null, excluded: [], ...p });

describe('cover state machine (PRD 9.6)', () => {
  it('Assigned → Confirmed by caregiver on Yes; a Yes is a plan, not evidence', () => {
    expect(coverTransition('Assigned', 'caregiver_yes', g()).state).toBe('ConfirmedByCaregiver');
    const ev = evaluateTask(task({ due: T(16) }), { now: T(15), visit: null, trustedHelperDay: false, trustedCovered: false });
    expect(ev.state).toBe('Pending'); // confirming cover leaves the evidence state untouched
  });
  it('At risk on can’t make it, can’t come, friend cancel and no reply, each with its reason code', () => {
    expect(coverTransition('Assigned', 'caregiver_cant', g())).toEqual({ state: 'AtRisk', reason: expect.stringContaining('R-COVER-CANT') });
    expect(coverTransition('ConfirmedByCaregiver', 'caregiver_cant', g()).state).toBe('AtRisk');
    expect(coverTransition('Assigned', 'no_reply', g()).reason).toContain('NO-REPLY');
    expect(coverTransition('CoveredByReplacement', 'friend_cancelled', g()).reason).toContain('FRIEND-CANCEL');
  });
  it('substitute: approved → covered; declined or timed out → At risk', () => {
    expect(coverTransition('Assigned', 'substitute_named', g()).state).toBe('SubstituteProposed');
    expect(coverTransition('SubstituteProposed', 'substitute_approved', g()).state).toBe('CoveredByReplacement');
    expect(coverTransition('SubstituteProposed', 'substitute_declined', g()).state).toBe('AtRisk');
    expect(coverTransition('SubstituteProposed', 'substitute_timeout', g()).state).toBe('AtRisk');
  });
  it('backups exhausted → Friend Finder before the cutoff, Cover not found after it (PS-131)', () => {
    expect(coverTransition('AskingBackups', 'backups_exhausted', g(true)).state).toBe('FriendFinder');
    const closed = coverTransition('AskingBackups', 'backups_exhausted', g(false));
    expect(closed.state).toBe('CoverNotFound'); expect(closed.reason).toContain('FF-SKIPPED');
    expect(() => coverTransition('CoverNotFound', 'friend_finder_started', g(false))).toThrow(/Too close to the task for Friend Finder/);
  });
  it('urgency guards: must-happen can’t be moved or skipped; time-sensitive can be moved, not skipped; can-wait both', () => {
    expect(canCover('CoverNotFound', 'owner_moves', g(false, 'MustHappen'))).toBe(false);
    expect(canCover('CoverNotFound', 'owner_skips', g(false, 'MustHappen'))).toBe(false);
    expect(canCover('CoverNotFound', 'owner_moves', g(false, 'TimeSensitive'))).toBe(true);
    expect(canCover('CoverNotFound', 'owner_skips', g(false, 'TimeSensitive'))).toBe(false);
    expect(canCover('CoverNotFound', 'owner_skips', g(false, 'CanWait'))).toBe(true);
    expect(canCover('CoverNotFound', 'owner_handles', g(false, 'MustHappen'))).toBe(true);
  });
  it('rejects transitions the PRD does not allow', () => {
    expect(() => coverTransition('ConfirmedByCaregiver', 'backups_asked', g())).toThrow(CoverError);
    expect(() => coverTransition('Assigned', 'replacement_confirmed', g())).toThrow(CoverError);
  });
  it('property: every state, under every guard, has a next step (no dead ends)', () => {
    for (const s of COVER_STATES) for (const ff of [true, false]) for (const u of ['CanWait', 'TimeSensitive', 'MustHappen'] as Urgency[])
      expect(nextSteps(s, g(ff, u)).length, `${s} ff=${ff} ${u}`).toBeGreaterThan(0);
  });
  it('property: from any state a settled state (someone named) or an explicit owner decision is reachable', () => {
    for (const start of COVER_STATES) for (const ff of [true, false]) for (const u of ['CanWait', 'MustHappen'] as Urgency[]) {
      const seen = new Set<CoverState>([start]); const queue: CoverState[] = [start]; let ok = coverSettled(start);
      while (queue.length && !ok) { const s = queue.shift()!; for (const e of COVER_EVENTS) { if (!canCover(s, e, g(ff, u))) continue; const n = coverTransition(s, e, g(ff, u)).state; if (coverSettled(n)) ok = true; if (!seen.has(n)) { seen.add(n); queue.push(n); } } }
      expect(ok, `${start} ff=${ff} ${u}`).toBe(true);
    }
  });
  it('property: random walks never throw anything but CoverError and always land in a known state', () => {
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 300; i++) { let s: CoverState = 'Assigned'; for (let k = 0; k < 25; k++) { const e = COVER_EVENTS[Math.floor(rnd() * COVER_EVENTS.length)]!; try { s = coverTransition(s, e, g(rnd() > 0.5, (['CanWait', 'TimeSensitive', 'MustHappen'] as Urgency[])[Math.floor(rnd() * 3)]!)).state; } catch (err) { expect(err).toBeInstanceOf(CoverError); } expect(COVER_STATES).toContain(s); } }
  });
});

describe('reminder planner (PS-127)', () => {
  const base = { assignee: 'helper' as const, reachable: true };
  it('one reminder 90 min before the first task of the visit; deadline at task − 45', () => {
    expect(planReminder({ ...base, firstDue: T(16) })).toMatchObject({ send: true, at: T(14, 30), deadline: T(15, 15), evening: false });
  });
  it('tasks before 10:00 are reminded at 20:00 the evening before', () => {
    expect(planReminder({ ...base, firstDue: 1440 + T(8) })).toMatchObject({ send: true, at: T(20), deadline: T(20, 45), evening: true });
    expect(planReminder({ ...base, firstDue: T(8) })).toMatchObject({ at: T(20) - 1440, deadline: T(20, 45) - 1440 }); // same rule in the task day frame
    expect(planReminder({ ...base, firstDue: T(9, 59) }).at).toBe(T(20) - 1440);
    expect(planReminder({ ...base, firstDue: T(10) }).at).toBe(T(8, 30)); // exactly 10:00 is not "before 10"
  });
  it('Trusted helpers only when the owner turns it on; never without consent or when marked unavailable', () => {
    expect(planReminder({ ...base, firstDue: T(16), trustedMode: true }).send).toBe(false);
    expect(planReminder({ ...base, firstDue: T(16), trustedMode: true, remindTrusted: true }).send).toBe(true);
    expect(planReminder({ ...base, firstDue: T(16), reachable: false }).send).toBe(false);
    expect(planReminder({ ...base, firstDue: T(16), helperUnavailable: true }).send).toBe(false);
    expect(planReminder({ firstDue: T(19, 30), assignee: 'owner', reachable: true }).send).toBe(false);
  });
  it('co-owners and confirmed friend or backup cover are included, unless they said yes inside the reminder window', () => {
    expect(planReminder({ firstDue: T(16), assignee: 'co_owner', reachable: true }).send).toBe(true);
    expect(planReminder({ firstDue: T(17), assignee: 'friend', reachable: true, confirmedAt: T(11) }).send).toBe(true);
    expect(planReminder({ firstDue: T(17), assignee: 'friend', reachable: true, confirmedAt: T(15, 40) }).send).toBe(false);
    expect(planReminder({ firstDue: T(16), assignee: 'backup', reachable: true, confirmedAt: T(14, 40) }).send).toBe(false);
  });
  it('a cluster advisory pulls tomorrow’s reminders to this evening', () => {
    // In the task day's own minute frame, 6:40 PM the evening before is 18:40 minus 24 h.
    const p = planReminder({ ...base, firstDue: T(13), advisoryAt: T(18, 40) - 1440 });
    expect(p).toMatchObject({ send: true, at: T(18, 40) - 1440, deadline: T(19, 25) - 1440, evening: true, why: 'cluster advisory' });
    expect(planReminder({ ...base, firstDue: T(13), advisoryAt: T(12) }).at).toBe(T(11, 30)); // an advisory after the normal reminder time changes nothing
  });
  it('timings are configuration', () => {
    const c = coverConfig({ reminderLeadMin: 120, confirmDeadlineMin: 60 }, null, { bogus: 5 } as never);
    expect(planReminder({ ...base, firstDue: T(16) }, c)).toMatchObject({ at: T(14), deadline: T(15) });
    expect(coverConfig({ pairWindowMin: -3 }).pairWindowMin).toBe(COVER_V1.pairWindowMin);
  });
  it('a late-sent reminder gets 15 minutes to reply, never past the task', () => {
    const p = planReminder({ firstDue: T(16), assignee: 'co_owner', reachable: true });
    expect(reminderDeadline(p, T(15, 40), T(16))).toBe(T(15, 55)); expect(reminderDeadline(p, T(15, 50), T(16))).toBe(T(16)); expect(reminderDeadline(p, T(14, 30), T(16))).toBe(T(15, 15));
  });
});

describe('at-risk evaluator (PS-129)', () => {
  const d = { reminderSent: true, deadline: T(15, 15) };
  it('no reply: not at 3:14, at risk exactly at 3:15 (task time − 45)', () => {
    expect(atRiskReason({ ...d, reply: null, now: T(15, 14) })).toBeNull();
    expect(atRiskReason({ ...d, reply: null, now: T(15, 15) })).toBe('no_reply');
  });
  it('can’t make it, can’t come at any time and friend cancel are at risk at once; a Yes is not', () => {
    expect(atRiskReason({ ...d, reply: 'cant', now: T(14, 31) })).toBe('cant_make_it');
    expect(atRiskReason({ reminderSent: false, deadline: T(12, 15), reply: null, saidCantCome: true, now: T(11) })).toBe('cant_come');
    expect(atRiskReason({ ...d, reply: 'yes', friendCancelled: true, now: T(15, 45) })).toBe('friend_cancelled');
    expect(atRiskReason({ ...d, reply: 'yes', now: T(15, 50) })).toBeNull();
    expect(atRiskReason({ reminderSent: false, deadline: T(15, 15), reply: null, now: T(15, 30) })).toBeNull(); // no reminder, no "no reply"
  });
});

describe('backup runner (PS-130)', () => {
  it('orders by rank, caps at five, key holders first when access is needed', () => {
    expect(orderBackups(LIST, { needsAccess: false, medicineOnly: false }).map(b => b.id)).toEqual(['desai', 'ritu', 'ankita', 'rohan', 'vikram']);
    expect(orderBackups(LIST, { needsAccess: true, medicineOnly: false }).map(b => b.id)).toEqual(['desai', 'ankita', 'rohan', 'ritu', 'vikram']);
    expect(orderBackups([...LIST, B('extra', 6, true)], { needsAccess: false, medicineOnly: false })).toHaveLength(5);
    expect(orderBackups(LIST, { needsAccess: true, medicineOnly: true }).map(b => b.id)).toEqual(['rohan']);
  });
  it('without standing approval the owner must send; one tap stands in for it', () => {
    expect(nextBackupAction(job({ standingApproval: false }), LIST, T(15, 15))).toEqual({ kind: 'owner_must_send', candidates: ['desai', 'ankita', 'rohan', 'ritu', 'vikram'] });
    expect(nextBackupAction(job({ standingApproval: false, ownerSent: true }), LIST, T(15, 15)).kind).toBe('ask');
  });
  it('asks two at a time, 10 minutes per pair, then the next pair', () => {
    const a1 = nextBackupAction(job(), LIST, T(15, 15));
    expect(a1).toEqual({ kind: 'ask', personIds: ['desai', 'ankita'], windowMin: 10, round: 1 });
    const j = job({ round: 1, roundAt: T(15, 15), asks: [{ personId: 'desai', round: 1, at: T(15, 15), state: 'asked' }, { personId: 'ankita', round: 1, at: T(15, 15), state: 'asked' }] });
    expect(nextBackupAction(j, LIST, T(15, 24))).toEqual({ kind: 'wait', until: T(15, 25) });
    expect(nextBackupAction(j, LIST, T(15, 25))).toEqual({ kind: 'close_round', personIds: ['desai', 'ankita'] });
    const j2 = { ...j, asks: j.asks.map(a => ({ ...a, state: 'noreply' as const })) };
    expect(nextBackupAction(j2, LIST, T(15, 25))).toEqual({ kind: 'ask', personIds: ['rohan', 'ritu'], windowMin: 10, round: 2 });
  });
  it('moves on at once when both people in a pair say no', () => {
    const j = job({ round: 1, roundAt: T(15, 15), asks: [{ personId: 'desai', round: 1, at: T(15, 15), state: 'no' }, { personId: 'ankita', round: 1, at: T(15, 15), state: 'no' }] });
    expect(nextBackupAction(j, LIST, T(15, 17))).toMatchObject({ kind: 'ask', personIds: ['rohan', 'ritu'] });
  });
  it('exhausted: Friend Finder if before the cutoff, otherwise not', () => {
    const all = LIST.map((b, i) => ({ personId: b.id, round: Math.floor(i / 2) + 1, at: T(14, 30), state: 'noreply' as const }));
    expect(nextBackupAction(job({ round: 3, asks: all }), LIST, T(15))).toEqual({ kind: 'exhausted', friendFinder: true });
    expect(nextBackupAction(job({ round: 3, asks: all }), LIST, T(15, 30))).toEqual({ kind: 'exhausted', friendFinder: false }); // exactly at the cutoff
  });
  it('hold: reminder at 5 min; at 10 min release, or auto-confirm for must-happen from a pre-approved backup', () => {
    const hold = { personId: 'desai', at: T(15, 20), reminded: false, preApproved: true };
    expect(nextBackupAction(job({ hold }), LIST, T(15, 24))).toEqual({ kind: 'wait', until: T(15, 25) });
    expect(nextBackupAction(job({ hold }), LIST, T(15, 25))).toEqual({ kind: 'hold_remind', personId: 'desai' });
    expect(nextBackupAction(job({ hold: { ...hold, reminded: true } }), LIST, T(15, 29))).toEqual({ kind: 'wait', until: T(15, 30) });
    expect(nextBackupAction(job({ hold: { ...hold, reminded: true } }), LIST, T(15, 30))).toEqual({ kind: 'release_hold', personId: 'desai' });
    expect(nextBackupAction(job({ hold: { ...hold, reminded: true }, urgencies: ['MustHappen'] }), LIST, T(15, 30))).toEqual({ kind: 'auto_confirm', personId: 'desai' });
    expect(nextBackupAction(job({ hold: { ...hold, reminded: true, preApproved: false }, urgencies: ['MustHappen'] }), LIST, T(15, 30)).kind).toBe('release_hold'); // an ad-hoc number is never auto-confirmed
  });
  it('wide ask (more than 3 h): everyone together, 60-minute window', () => {
    expect(jobMode(T(9), T(13))).toBe('wide'); expect(jobMode(T(10), T(13))).toBe('pairs'); // exactly 3 h is not "more than"
    expect(nextBackupAction(job({ mode: 'wide', startedAt: T(9), firstDue: T(13) }), LIST, T(9))).toMatchObject({ kind: 'ask', windowMin: 60, personIds: expect.arrayContaining(['vikram']) });
  });
  it('whole circle: re-asks everyone who has not said no, once', () => {
    const asks = [{ personId: 'desai', round: 1, at: T(15, 15), state: 'no' as const }, { personId: 'ankita', round: 1, at: T(15, 15), state: 'noreply' as const }];
    const a = nextBackupAction(job({ mode: 'circle', round: 1, asks }), LIST, T(15, 45));
    expect(a).toMatchObject({ kind: 'ask', round: 2 }); if (a.kind === 'ask') { expect(a.personIds).not.toContain('desai'); expect(a.personIds).toContain('ankita'); }
    const after = job({ mode: 'circle', round: 2, circleRound: 2, roundAt: T(15, 45), asks: [...asks, { personId: 'ankita', round: 2, at: T(15, 45), state: 'noreply' }] });
    expect(nextBackupAction(after, LIST, T(15, 56)).kind).toBe('exhausted');
  });
  it('thin circle below two key holders; checklist reminder at task − 15', () => {
    expect(thinCircle(LIST)).toEqual({ keyHolders: 3, thin: false }); expect(thinCircle([B('a', 1, true), B('b', 2, false)]).thin).toBe(true);
    const k = { gateApproved: false, keyPlan: null, reminded: false };
    expect(checklistReminderDue(k, T(16), T(15, 44))).toBe(false); expect(checklistReminderDue(k, T(16), T(15, 45))).toBe(true);
    expect(checklistReminderDue({ gateApproved: true, keyPlan: 'lockbox', reminded: false }, T(16), T(15, 50))).toBe(false); expect(checklistReminderDue(null, T(16), T(15, 50))).toBe(false);
  });
});

describe('Friend Finder gate (PS-131)', () => {
  it('open before task − 30, closed at and after it', () => {
    expect(friendFinderOpen(T(16, 29), T(17))).toBe(true); expect(friendFinderOpen(T(16, 30), T(17))).toBe(false);
    expect(afterFriendCancel(T(16, 10), T(17))).toBe('reopen_search'); expect(afterFriendCancel(T(16, 45), T(17))).toBe('backup_runner');
  });
});

describe('urgency and cover not found (PS-132, PS-133)', () => {
  it('defaults by task type; water must happen on hot days', () => {
    expect(defaultUrgency('walk')).toBe('CanWait'); expect(defaultUrgency('feeding')).toBe('TimeSensitive'); expect(defaultUrgency('medicine')).toBe('MustHappen');
    expect(defaultUrgency('water')).toBe('TimeSensitive'); expect(defaultUrgency('water', { hotDay: true })).toBe('MustHappen');
  });
  it('must-happen uses the due + 15 min alert', () => { expect(alertGrace('MustHappen', 30)).toBe(15); expect(alertGrace('TimeSensitive', 30)).toBe(30); expect(alertGrace('CanWait', 45)).toBe(45); });
  const o = { now: T(15, 45), firstDue: T(16), notFoundAt: T(15, 45), acknowledged: false, circleAsked: false, circleCalled: false };
  it('options follow urgency', () => {
    expect(notFoundOptions(['CanWait'], o)).toMatchObject({ handle: true, askSomeone: true, askCircle: true, move: true, moveWarning: false, skip: true, friendFinder: false, circleCallAt: null });
    expect(notFoundOptions(['TimeSensitive'], o)).toMatchObject({ move: true, moveWarning: true, skip: false });
    expect(notFoundOptions(['TimeSensitive', 'MustHappen'], o)).toMatchObject({ move: false, skip: false, circleCallAt: T(16) });
    expect(notFoundOptions(['CanWait'], { ...o, now: T(13), firstDue: T(16), circleAsked: true })).toMatchObject({ friendFinder: true, askCircle: false });
  });
  it('care circle is called 15 min after cover not found for a must-happen task, unless the owner acknowledged', () => {
    const c = { urgencies: ['MustHappen'] as Urgency[], notFoundAt: T(12, 30), acknowledged: false, circleCalled: false };
    expect(circleCallDue({ ...c, now: T(12, 44) })).toBe(false); expect(circleCallDue({ ...c, now: T(12, 45) })).toBe(true);
    expect(circleCallDue({ ...c, acknowledged: true, now: T(13) })).toBe(false); expect(circleCallDue({ ...c, circleCalled: true, now: T(13) })).toBe(false);
    expect(circleCallDue({ ...c, urgencies: ['CanWait'], now: T(13) })).toBe(false);
  });
});

describe('pre-departure check (PS-134)', () => {
  const v = (p: Partial<CoverTaskView>): CoverTaskView => ({ id: 'a', title: 'Lunch + fresh water', petName: 'Bruno', due: T(13), cover: 'Assigned', urgency: 'TimeSensitive', done: false, cancelled: false, ...p });
  it('warns with the PRD wording and six options when nobody has accepted', () => {
    const r = preDepartureCheck([v({ cover: 'AtRisk' }), v({ id: 'b', due: T(16), cover: 'ConfirmedByCaregiver' })], T(9));
    expect(r.warn).toBe(true); expect(r.messages).toEqual(['Nobody has accepted Bruno’s 1:00 PM lunch + fresh water yet.']); expect(r.options).toHaveLength(6); expect(r.options).toContain('leave_anyway');
  });
  it('more than 3 h before the task → backups and friends together with a 60-minute window', () => {
    expect(preDepartureCheck([v({ cover: 'CoverNotFound' })], T(9))).toMatchObject({ wideAsk: true, wideWindowMin: 60 });
    expect(preDepartureCheck([v({ cover: 'CoverNotFound' })], T(10, 30)).wideAsk).toBe(false);
  });
  it('does not warn for a regular helper whose reminder is not due yet, but does when she is marked unavailable', () => {
    expect(preDepartureCheck([v({})], T(9)).warn).toBe(false);
    expect(preDepartureCheck([v({ helperUnavailable: true })], T(9)).warn).toBe(true);
    expect(preDepartureCheck([v({ cover: 'AtRisk', done: true }), v({ cover: 'AtRisk', due: T(8) })], T(9)).warn).toBe(false);
  });
});

describe('delay planner (PS-136)', () => {
  const R = (id: string, title: string, due: number, type: OwnerRoutineTask['type'] = 'feeding', urgency: Urgency = 'TimeSensitive', minMinutes = 10): OwnerRoutineTask => ({ id, title, type, due, minMinutes, urgency });
  const own = [R('walk', 'Evening walk', T(19, 30), 'walk', 'CanWait', 15), R('dinner', 'Dinner + water', T(20, 30)), R('late', 'Night pad', T(22))];
  const base = { oldReturn: T(19), newReturn: T(21), outFrom: T(9), ownerTasks: own, alreadyPlanned: [], visitTimes: [T(13), T(16)], aloneLimitHours: 6, hasCurrentCaregiver: true };
  it('adds only the tasks inside the extra time, recomputes the alone window and asks the current caregiver first', () => {
    const p = planDelay(base);
    expect(p.added.map(t => t.id)).toEqual(['walk', 'dinner']); expect(p.planOnly).toBe(false); expect(p.ask.first).toBe('current_caregiver'); expect(p.ask.replies).toEqual(['yes', 'only_until', 'cannot']);
    expect(p.alone.longestMinutes).toBe(240); expect(p.medicine).toEqual([]);
  });
  it('nothing new due → plan and return time only', () => { expect(planDelay({ ...base, newReturn: T(19, 20) }).planOnly).toBe(true); });
  it('repeatable: a second delay does not add the same task twice', () => { expect(planDelay({ ...base, oldReturn: T(21), newReturn: T(22, 30), alreadyPlanned: ['walk', 'dinner'] }).added.map(t => t.id)).toEqual(['late']); });
  it('flags medicine in the extra time and an alone-window breach', () => {
    const p = planDelay({ ...base, ownerTasks: [R('med', 'Night tablet', T(20), 'medicine', 'MustHappen', 3)], visitTimes: [] });
    expect(p.medicine.map(t => t.id)).toEqual(['med']); expect(p.alone.exceeds).toBe(true);
  });
  it('Only until 8 → the caregiver takes what finishes by 8; the rest is a part-only request', () => {
    const p = planDelay(base);
    expect(splitExtension(p.added, { kind: 'only_until', until: T(20) })).toMatchObject({ caregiver: [{ id: 'walk' }], uncovered: [{ id: 'dinner' }] });
    expect(splitExtension(p.added, { kind: 'yes' }).uncovered).toEqual([]); expect(splitExtension(p.added, { kind: 'cannot' }).uncovered).toHaveLength(2); expect(splitExtension(p.added, { kind: 'no_reply' }).caregiver).toEqual([]);
  });
  it('rejects a return time that is not later', () => { expect(() => planDelay({ ...base, newReturn: T(19) })).toThrow(RangeError); });
});

describe('covered day with cover states (PS-111 v1.4, PS-133, PS-134)', () => {
  const t = task({ id: 'x', due: T(16) });
  const outcome = (now: number, p: Partial<TaskOutcome>, tk = t): TaskOutcome => { const ev = evaluateTask(tk, { now, visit: null, trustedHelperDay: false, trustedCovered: false }); return { taskId: tk.id, petId: 'bruno', ev, esc: escalationState(tk, ev, now), trusted: false, ...p }; };
  const day = (o: TaskOutcome, dayClosed = true) => coveredDay({ petIds: ['bruno'], outcomes: [o], trustedCoveredTap: false, dayClosed });
  it('bumps the stored rule version', () => { expect(COVERED_DAY_RULE).toBe('covered-day-v1.4'); expect(day(outcome(T(23, 59), {})).rule).toBe('covered-day-v1.4'); });
  it('No cover planned and unresolved Cover not found are not covered, even if the escalation was resolved', () => {
    const resolved = task({ id: 'x', due: T(16), escalation: { ackAt: T(16, 40), resolvedAt: T(17), resolvedNote: 'ok' } });
    expect(day(outcome(T(23, 59), {}, resolved)).household).toBe('Covered'); // v1.3 behaviour without a cover problem
    expect(day(outcome(T(23, 59), { cover: 'NoCoverPlanned' }, resolved)).household).toBe('Not covered');
    expect(day(outcome(T(23, 59), { cover: 'CoverNotFound' }, resolved)).household).toBe('Not covered');
    expect(day(outcome(T(23, 59), { cover: 'OwnerHandling', coverSkipped: true }, resolved)).household).toBe('Not covered');
  });
  it('…unless the task is later matched by the return check or done with evidence', () => {
    const matched = task({ id: 'x', due: T(16), returnCheck: { at: T(19, 5), matched: true } });
    expect(day(outcome(T(23, 59), { cover: 'NoCoverPlanned' }, matched)).household).toBe('Covered');
    expect(coverBlocksDay('OwnerHandling')).toBe(false); expect(day(outcome(T(23, 59), { cover: 'OwnerHandling' }, matched)).household).toBe('Covered');
  });
  it('shows At risk during the day', () => { expect(day(outcome(T(10), { cover: 'NoCoverPlanned' }), false).household).toBe('At risk'); });
});

describe('permissions for one-time visitors and standing approval (PRD 9.5 v1.4)', () => {
  const link = { sameHousehold: true, taskLinkValid: true, forThisTask: true };
  it('a substitute or ad-hoc visitor sees the task before accepting, but no address, key or emergency card', () => {
    for (const r of ['substitute', 'adhoc_visitor'] as const) {
      expect(can(r, 'task', 'read', link)).toBe(true); expect(can(r, 'access_details', 'read', link)).toBe(false); expect(canSeeAddress(r, link)).toBe(false);
      expect(can(r, 'access_details', 'read', { ...link, accepted: true })).toBe(false); // owner has not approved yet
      expect(can(r, 'access_details', 'read', { ...link, accepted: true, ownerApproved: true })).toBe(true); expect(canSeeAddress(r, { ...link, accepted: true, ownerApproved: true })).toBe(true);
    }
  });
  it('the link is task-scoped and expiring; nothing else in the household is readable', () => {
    expect(can('substitute', 'task', 'read', { ...link, forThisTask: false })).toBe(false); expect(can('adhoc_visitor', 'task', 'read', { ...link, taskLinkValid: false })).toBe(false);
    expect(can('substitute', 'timeline', 'read', { ...link, accepted: true, ownerApproved: true })).toBe(false); expect(can('adhoc_visitor', 'pet', 'read', { ...link, accepted: true, ownerApproved: true })).toBe(false);
    expect(can('substitute', 'task', 'read', { ...link, sameHousehold: false })).toBe(false);
  });
  it('standing approval applies to the backup list only', () => {
    expect(outreachAllowed('backup_list', { standingApproval: true, ownerApprovedThisSend: false })).toBe(true); expect(outreachAllowed('backup_list', { standingApproval: false, ownerApprovedThisSend: false })).toBe(false);
    for (const t of ['friend', 'adhoc_number', 'substitute'] as const) { expect(outreachAllowed(t, { standingApproval: true, ownerApprovedThisSend: false })).toBe(false); expect(outreachAllowed(t, { standingApproval: false, ownerApprovedThisSend: true })).toBe(true); }
    expect(outreachAllowed('nearby_member', { standingApproval: true, ownerApprovedThisSend: true })).toBe(false);
    expect(outreachAllowed('care_circle_call', { standingApproval: false, ownerApprovedThisSend: false, mustHappenUnacknowledged: true })).toBe(true);
  });
  it('owners manage backups and cover; co-owners can act on cover but not edit the list', () => {
    expect(can('owner', 'backup_list', 'update', { sameHousehold: true })).toBe(true); expect(can('co_owner', 'backup_list', 'update', { sameHousehold: true })).toBe(false);
    expect(can('co_owner', 'cover', 'update', { sameHousehold: true })).toBe(true); expect(can('family', 'cover', 'update', { sameHousehold: true })).toBe(false); expect(can('ops', 'cluster_advisory', 'create', { sameHousehold: false })).toBe(true); expect(can('auditor', 'cluster_advisory', 'create', { sameHousehold: false })).toBe(false);
  });
});

describe('cover metrics (PRD 16.3)', () => {
  it('computes the six metrics and the 10% review line', () => {
    const m = coverMetrics({
      reminders: [{ reply: 'yes', replyAt: T(14, 34), deadline: T(15, 15) }, { reply: 'cant', replyAt: T(14, 40), deadline: T(15, 15) }, { reply: null, replyAt: null, deadline: T(15, 15) }, { reply: 'yes', replyAt: T(15, 40), deadline: T(15, 15) }],
      jobs: [{ startedAt: T(14, 40), firstDue: T(16), outcome: 'covered', resolvedAt: T(14, 52), everNotFound: false }, { startedAt: T(15, 15), firstDue: T(16), outcome: 'owner', resolvedAt: T(15, 50), everNotFound: true }, { startedAt: T(15, 15), firstDue: T(16), outcome: 'not_found', resolvedAt: null, everNotFound: true }, { startedAt: T(11), firstDue: T(13), outcome: 'covered', resolvedAt: T(11, 30), everNotFound: false }],
      noCoverPlannedDays: 1, petDays: 40, householdsWithTwoKeys: 13, newHouseholds: 20
    });
    expect(m.preTaskConfirmationRate).toBe(0.5); expect(m.atRiskRescueRate).toBe(0.75); expect(m.coverNotFoundRate).toBe(0.5); expect(m.coverNotFoundReview).toBe(true);
    expect(m.timeToCoverMedian).toBe(12); expect(m.noCoverPlannedDayRate).toBe(0.025); expect(m.circleDepth).toBe(0.65);
  });
  it('is null, not zero, with no data; exactly 10% does not trip the review', () => {
    const e = coverMetrics({ reminders: [], jobs: [], noCoverPlannedDays: 0, petDays: 0, householdsWithTwoKeys: 0, newHouseholds: 0 });
    expect(e.atRiskRescueRate).toBeNull(); expect(e.timeToCoverMedian).toBeNull(); expect(e.coverNotFoundReview).toBe(false);
    const jobs = Array.from({ length: 10 }, (_, i) => ({ startedAt: 0, firstDue: 60, outcome: 'covered' as const, resolvedAt: 10, everNotFound: i === 0 }));
    expect(coverMetrics({ reminders: [], jobs, noCoverPlannedDays: 0, petDays: 1, householdsWithTwoKeys: 0, newHouseholds: 1 }).coverNotFoundReview).toBe(false);
  });
});

describe('v1.4 changes to existing rules', () => {
  it('must-happen grace override moves the owner alert to due + 15 (PS-132)', () => {
    const t = task({ due: T(16), profile: 'standard', graceOverride: 15 });
    expect(evaluateTask(t, { now: T(16, 14), visit: null, trustedHelperDay: false, trustedCovered: false }).state).toBe('Pending');
    expect(evaluateTask(t, { now: T(16, 15), visit: null, trustedHelperDay: false, trustedCovered: false }).state).toBe('Missed');
  });
  it('after cover continuity ran, the ladder alerts the owner but does not repeat the backup and cover steps (PRD 10.4)', () => {
    const t = task({ due: T(16), escalation: { coverHandled: true } }), ev = evaluateTask(t, { now: T(17, 30), visit: null, trustedHelperDay: false, trustedCovered: false });
    const es = escalationState(t, ev, T(17, 30))!;
    expect(es.steps.map(s => s.fired)).toEqual([true, false, false]); expect(es.steps[1]!.notRepeated).toBe(true); expect(es.open).toBe(true);
    const plain = escalationState(task({ due: T(16) }), ev, T(17, 30))!; expect(plain.steps.map(s => s.fired)).toEqual([true, true, true]);
  });
});

describe('caregiver replies (PS-128)', () => {
  it('recognises can’t come in English, Hindi and Marathi, and nothing else', () => {
    for (const t of ['can’t come', "I can't come today", 'cannot make it', 'not coming', 'Sorry, won’t come', '\u092f\u0947\u090a \u0936\u0915\u0924 \u0928\u093e\u0939\u0940', '\u0906\u091c \u091c\u092e\u0923\u093e\u0930 \u0928\u093e\u0939\u0940', '\u0928\u0939\u0940\u0902 \u0906 \u092a\u093e\u090a\u0901\u0917\u0940', 'yeu shakat nahi']) expect(isCantCome(t), t).toBe(true);
    for (const t of ['done', 'yes', 'I can come', 'points', 'change', 'coming at 4']) expect(isCantCome(t), t).toBe(false);
  });
  it('reads a substitute’s name and number', () => {
    expect(parseSubstitute('Lata Pawar 90000 00077')).toEqual({ name: 'Lata Pawar', phone: '+919000000077' });
    expect(parseSubstitute('+91 98200-00055, Sneha')).toEqual({ name: 'Sneha', phone: '+919820000055' });
    expect(parseSubstitute('my sister')).toBeNull(); expect(parseSubstitute('Lata 12345')).toBeNull();
  });
  it('the owner can move or skip straight from At risk after stopping the list, under the same urgency guards', () => {
    expect(coverTransition('AtRisk', 'owner_moves', g(false, 'TimeSensitive')).state).toBe('OwnerHandling');
    expect(canCover('AtRisk', 'owner_skips', g(false, 'TimeSensitive'))).toBe(false); expect(canCover('AtRisk', 'owner_moves', g(false, 'MustHappen'))).toBe(false);
    expect(coverTransition('AtRisk', 'restored', g()).state).toBe('Assigned');
  });
});
