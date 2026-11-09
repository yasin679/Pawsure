import { describe, it, expect } from 'vitest';
import { parseRequestRules, searchBlockedReasons, correctedCriticalFields, parseProposedTime, matchFriends, newRequest, reduce, type FriendProfile, type FriendRequest, type FFEvent } from '../src/index.js';
import { T } from './helpers.js';

const pets = [{ id: 'bruno', name: 'Bruno', species: 'Dog', medsInstructions: '1 chewable with lunch' }, { id: 'misty', name: 'Misty', species: 'Cat', medsInstructions: 'None' }];
const ctx = (now = T(15, 30)) => ({ now, pets, defaultAccess: 'Key handover' as const, defaultAccessLabel: 'from your profile' });
const F = (id: string, p: Partial<FriendProfile> = {}): FriendProfile => ({ id, displayName: id, distanceBand: 1, distanceLabel: 'about 2 min', language: 'en', inviteAccepted: true, discoverable: true, paused: false, blocked: false, windows: [[T(16), T(21)]], windowsLabel: '4–9 PM', capabilities: { feed: true, walk: true }, key: 'handover', stairsOk: true, capacity: 1, activeRequests: 0, helpCount: 6, checkedInCount: 5, responseBand: 'within 10 min', responseRank: 1, updatedLabel: 'today', ...p });

describe('Ask Pawsure parsing (PS-055, PS-056, PS-125) — #13, #23', () => {
  it('parses the PRD example: feed + walk at 5 PM, access from profile, no clarification', () => {
    const r = parseRequestRules('I am stuck in a meeting until 8. Can someone feed Bruno and take him down at 5?', ctx());
    expect(r.parsed.tasks.sort()).toEqual(['feed', 'walk']);
    expect(r.parsed.time).toBe(T(17));
    expect(r.parsed.access).toBe('Key handover');
    expect(r.clarifications).toEqual([]);
    expect(searchBlockedReasons(r.parsed, r.clarifications)).toEqual([]);
  });
  it('ambiguous medicine / time / access blocks search', () => {
    const r = parseRequestRules('Can someone give Bruno his medicine this evening and let themselves in?', ctx());
    expect(r.clarifications.map(c => c.field).sort()).toEqual(['access', 'meds', 'time']);
    expect(searchBlockedReasons(r.parsed, r.clarifications).length).toBeGreaterThan(0);
  });
  it('asks AM or PM when both are still ahead', () => {
    expect(parseRequestRules('feed Bruno at 9', ctx(T(6))).clarifications[0]!.field).toBe('time');
  });
  it('counts owner corrections to critical fields', () => {
    const a = parseRequestRules('feed Bruno at 5', ctx()).parsed;
    expect(correctedCriticalFields(a, { ...a, time: T(18) })).toEqual(['time']);
    expect(correctedCriticalFields(a, { ...a, tasks: [...a.tasks, 'meds'] })).toEqual(['meds']);
  });
  it('#18 friend replies: “5:30 la jamel” → 5:30 PM; vague reply stays pending', () => {
    expect(parseProposedTime('5:30 la jamel')).toBe(T(17, 30));
    expect(parseProposedTime('5 baje')).toBe(T(17));
    expect(parseProposedTime('thoda late')).toBeNull();
  });
});

describe('deterministic matching (PS-057, PS-058) — #13', () => {
  const req = { tasks: ['feed', 'walk'] as const, petId: 'bruno', time: T(17), durationMin: 25, access: 'Key handover' as const, lift: null, urgency: 'Today' as const, medsInstructions: null, sources: {} };
  it('filters, then ranks nearest first; reasons explain each match', () => {
    const r = matchFriends({ ...req, tasks: [...req.tasks] }, [F('kavya', { distanceBand: 3 }), F('priya', { distanceBand: 0 }), F('arjun'), F('farhan', { paused: true }), F('dev', { discoverable: false }), F('meera', { capabilities: { feed: true } })], { maxBand: 3 });
    expect(r.top.map(m => m.friend.id)).toEqual(['priya', 'arjun', 'kavya']);
    expect(r.excludedCounts).toMatchObject({ 'Paused requests': 1, 'Has not opted in to be found': 1, 'Has not chosen walk': 1 });
  });
  it('medicine requests exclude friends who did not choose medicines', () => {
    const r = matchFriends({ ...req, tasks: ['meds'] }, [F('a'), F('b', { capabilities: { feed: true, meds: true } })], { maxBand: 3 });
    expect(r.eligible.map(m => m.friend.id)).toEqual(['b']);
  });
  it('#24 opted-out friend (pending removal) is excluded immediately', () => {
    expect(matchFriends({ ...req, tasks: ['feed'] }, [F('a', { optOutPending: true })], { maxBand: 3 }).eligible).toEqual([]);
  });
  it('#27 no match returns an honest empty result (nearby fallback is OFF)', () => {
    const r = matchFriends({ ...req, tasks: ['walk'], time: T(11) }, [F('a')], { maxBand: 3 });
    expect(r.top).toEqual([]); expect(r.excludedCounts['Not free at that time']).toBe(1);
  });
});

describe('request state machine (PRD 9.4, PS-123)', () => {
  const run = (events: [FFEvent, number][], start = newRequest('r1', T(15, 30))) => {
    let req: FriendRequest = start; const fx: string[] = [];
    for (const [e, at] of events) { const o = reduce(req, e, at); req = o.req; o.effects.forEach(x => fx.push(x.type + ('template' in x ? ':' + x.template : '') + ('friendId' in x ? ':' + x.friendId : ''))); }
    return { req, fx };
  };
  const ready: [FFEvent, number][] = [[{ type: 'parse_confirmed', taskTime: T(17) }, T(15, 30)], [{ type: 'suggestions_shown' }, T(15, 30)]];
  it('nothing is sent before explicit owner approval', () => {
    expect(() => run([[{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(15, 30)]])).toThrow();
  });
  it('#17 one friend: yes → owner confirms → access disclosed + cover task', () => {
    const { req, fx } = run([...ready, [{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(15, 30)], [{ type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(15, 33)], [{ type: 'owner_confirm', friendId: 'priya' }, T(15, 34)]]);
    expect(req.state).toBe('Confirmed');
    expect(fx).toContain('disclose_access:priya'); expect(fx).toContain('create_cover_task:priya');
  });
  it('#18 proposed time needs owner confirmation before the schedule changes', () => {
    const { req } = run([...ready, [{ type: 'owner_approved_send', friendIds: ['arjun'], mode: 'one' }, T(15, 30)], [{ type: 'friend_reply', friendId: 'arjun', messageId: 'm1', reply: 'propose', proposedTime: T(17, 30) }, T(15, 35)]]);
    expect(req.state).toBe('Accepted - pending owner confirmation'); expect(req.taskTime).toBe(T(17));
    const c = reduce(req, { type: 'owner_confirm', friendId: 'arjun' }, T(15, 36)).req;
    expect(c.taskTime).toBe(T(17, 30));
  });
  it('#19 Ask all 3: hold, duplicate webhook ignored, second yes waits, hold released after 10 min', () => {
    const base = [...ready, [{ type: 'owner_approved_send', friendIds: ['priya', 'arjun', 'kavya'], mode: 'all3' }, T(15, 30)] as [FFEvent, number], [{ type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(15, 32)] as [FFEvent, number]];
    const a = run(base);
    expect(a.req.state).toBe('Provisional hold');
    const dup = reduce(a.req, { type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(15, 33));
    expect(dup.effects).toEqual([]);
    const b = reduce(a.req, { type: 'friend_reply', friendId: 'arjun', messageId: 'm2', reply: 'yes' }, T(15, 33)).req;
    expect(b.recipients.find(r => r.friendId === 'arjun')!.state).toBe('waiting');
    expect(b.holdFriendId).toBe('priya');
    const remind = reduce(b, { type: 'tick' }, T(15, 37));
    expect(remind.effects.map(e => e.type + ('template' in e ? ':' + e.template : ''))).toContain('notify_owner:hold_reminder');
    expect(reduce(remind.req, { type: 'tick' }, T(15, 42)).req.state).toBe('Sent');
  });
  it('late yes after confirmation gets “already covered” and no state change', () => {
    const { req } = run([...ready, [{ type: 'owner_approved_send', friendIds: ['priya', 'kavya'], mode: 'all3' }, T(15, 30)], [{ type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(15, 31)], [{ type: 'owner_confirm', friendId: 'priya' }, T(15, 32)]]);
    const late = reduce(req, { type: 'friend_reply', friendId: 'kavya', messageId: 'm9', reply: 'yes' }, T(15, 40));
    expect(late.req.state).toBe('Confirmed');
    expect(late.effects).toEqual([{ type: 'message_friend', friendId: 'kavya', template: 'already_covered' }]);
  });
  it('reminder at 8 min, expiry at 15 min', () => {
    const { req } = run([...ready, [{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(15, 30)]]);
    expect(reduce(req, { type: 'tick' }, T(15, 38)).effects).toEqual([{ type: 'send_request', friendId: 'priya', reminder: true }]);
    expect(reduce(req, { type: 'tick' }, T(15, 45)).req.state).toBe('Expired');
  });
  it('search closes 30 minutes before the task', () => {
    const { req } = run([[{ type: 'parse_confirmed', taskTime: T(16) }, T(15, 20)], [{ type: 'suggestions_shown' }, T(15, 20)], [{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(15, 20)]]);
    expect(reduce(req, { type: 'tick' }, T(15, 30)).req.state).toBe('Expired');
  });
  it('#20 friend cancels after confirming → owner alerted, access revoked, search reopened without them', () => {
    const { req } = run([...ready, [{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(15, 30)], [{ type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(15, 31)], [{ type: 'owner_confirm', friendId: 'priya' }, T(15, 32)]]);
    const c = reduce(req, { type: 'friend_cancel' }, T(16, 10));
    expect(c.req.state).toBe('Cancelled by friend');
    expect(c.effects).toEqual(expect.arrayContaining([{ type: 'revoke_access', friendId: 'priya' }, { type: 'reopen_search', exclude: ['priya'] }]));
  });
  it('#21 no friend signal by task time + 20 → No-show and backup escalation resumes', () => {
    const { req } = run([...ready, [{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(15, 30)], [{ type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(15, 31)], [{ type: 'owner_confirm', friendId: 'priya' }, T(15, 32)]]);
    expect(reduce(req, { type: 'tick' }, T(17, 19)).req.state).toBe('Confirmed');
    const ns = reduce(req, { type: 'tick' }, T(17, 20));
    expect(ns.req.state).toBe('No-show'); expect(ns.effects.map(e => e.type)).toContain('resume_escalation_backup');
  });
  it('owner changing the time after acceptance requires the friend to reconfirm', () => {
    const { req } = run([...ready, [{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(15, 30)], [{ type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(15, 31)], [{ type: 'owner_confirm', friendId: 'priya' }, T(15, 32)]]);
    const ch = reduce(req, { type: 'owner_change_time', time: T(17, 30) }, T(15, 40));
    expect(ch.req.state).toBe('Sent'); expect(ch.req.history.map(h => h.state)).toContain('Task changed');
    expect(ch.effects).toEqual(expect.arrayContaining([{ type: 'revoke_access', friendId: 'priya' }]));
  });
});
