import { describe, it, expect } from 'vitest';
import { newRequest, reduce, TransitionError, type FFEvent, type FriendRequest } from '../src/index.js';
import { T } from './helpers.js';

const run = (steps: [FFEvent, number][], start: FriendRequest = newRequest('r1', T(15, 30))) => steps.reduce((acc, [ev, at]) => reduce(acc.req, ev, at), { req: start, effects: [] as ReturnType<typeof reduce>['effects'] });
const ready: [FFEvent, number][] = [[{ type: 'parse_confirmed', taskTime: T(17) }, T(15, 30)], [{ type: 'suggestions_shown' }, T(15, 30)]];
const confirmed: [FFEvent, number][] = [...ready, [{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(15, 30)], [{ type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(15, 31)], [{ type: 'owner_confirm', friendId: 'priya' }, T(15, 32)]];

describe('Friend Finder cutoff (PS-131) and the v1.1.0 cutoff-confirm fix', () => {
  it('a friend cancelling before the cutoff still reopens the search (v1.3 rule kept)', () => {
    const c = run(confirmed).req, r = reduce(c, { type: 'friend_cancel' }, T(16, 29));
    expect(r.effects.map(e => e.type)).toContain('reopen_search'); expect(r.effects.map(e => e.type)).not.toContain('backup_runner');
  });
  it('a friend cancelling at or after the cutoff goes to the backup runner, not a new search', () => {
    for (const at of [T(16, 30), T(16, 45)]) {
      const r = reduce(run(confirmed).req, { type: 'friend_cancel' }, at);
      expect(r.req.state).toBe('Cancelled by friend');
      expect(r.effects).toEqual(expect.arrayContaining([{ type: 'revoke_access', friendId: 'priya' }, { type: 'backup_runner', friendId: 'priya' }, { type: 'notify_owner', template: 'friend_cancelled_after_cutoff', friendId: 'priya' }]));
      expect(r.effects.map(e => e.type)).not.toContain('reopen_search');
    }
  });
  it('blocks a new request at or after the cutoff with a clear message', () => {
    const r = run(ready).req;
    expect(() => reduce(r, { type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(16, 30))).toThrow(TransitionError);
    expect(() => reduce(r, { type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(16, 30))).toThrow(/Too close to the task for Friend Finder/);
    expect(reduce(r, { type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(16, 29)).req.state).toBe('Sent');
  });
  it('honours a Yes received before the cutoff: the owner can still confirm after it', () => {
    const sent = run([...ready, [{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(16, 20)], [{ type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(16, 28)]]).req;
    const after = reduce(sent, { type: 'tick' }, T(16, 35)).req;
    expect(after.state).toBe('Accepted - pending owner confirmation'); // v1.0.1 expired it here and then said "nobody accepted"
    expect(reduce(after, { type: 'owner_confirm', friendId: 'priya' }, T(16, 36)).req.state).toBe('Confirmed');
    expect(reduce(after, { type: 'tick' }, T(17)).req.state).toBe('Expired'); // unconfirmed by the task time
  });
  it('a provisional hold that started before the cutoff runs its full 10 minutes', () => {
    const held = run([...ready, [{ type: 'owner_approved_send', friendIds: ['priya', 'arjun'], mode: 'all3' }, T(16, 20)], [{ type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(16, 27)]]).req;
    expect(reduce(held, { type: 'tick' }, T(16, 33)).req.state).toBe('Provisional hold');
    expect(reduce(held, { type: 'owner_confirm', friendId: 'priya' }, T(16, 34)).req.state).toBe('Confirmed');
    const released = reduce(held, { type: 'tick' }, T(16, 37));
    expect(released.effects).toEqual(expect.arrayContaining([{ type: 'message_friend', friendId: 'priya', template: 'released' }]));
    expect(released.req.state).toBe('Expired'); // hold over, everyone else timed out, and it is past the cutoff
  });
  it('a request that nobody has answered still closes at the cutoff', () => {
    const sent = run([...ready, [{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(16, 20)]]).req;
    expect(reduce(sent, { type: 'tick' }, T(16, 30)).req.state).toBe('Expired');
  });
  it('a wide ask (PS-134) keeps the request open for 60 minutes with a reminder half-way', () => {
    const base = run([[{ type: 'parse_confirmed', taskTime: T(13) }, T(9)], [{ type: 'suggestions_shown' }, T(9)]], { ...newRequest('r2', T(9)), windowMin: 60 }).req;
    const sent = reduce(base, { type: 'owner_approved_send', friendIds: ['kavya'], mode: 'one' }, T(9)).req;
    expect(reduce(sent, { type: 'tick' }, T(9, 20)).req.state).toBe('Sent');
    expect(reduce(sent, { type: 'tick' }, T(9, 30)).effects).toEqual([{ type: 'send_request', friendId: 'kavya', reminder: true }]);
    expect(reduce(sent, { type: 'tick' }, T(10)).req.state).toBe('Expired');
  });
});
