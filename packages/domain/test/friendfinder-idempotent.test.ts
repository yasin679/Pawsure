import { describe, it, expect } from 'vitest';
import { newRequest, reduce, TransitionError, type FFEvent, type FriendRequest } from '../src/index.js';
import { T } from './helpers.js';

/** QA tracker PAW-014: a repeated owner action (double tap, retry on a slow network) must not create a second transition. */
const run = (steps: [FFEvent, number][], start: FriendRequest = newRequest('r1', T(15, 30))) => steps.reduce((acc, [ev, at]) => reduce(acc.req, ev, at), { req: start, effects: [] as ReturnType<typeof reduce>['effects'] });
const accepted: [FFEvent, number][] = [[{ type: 'parse_confirmed', taskTime: T(17) }, T(15, 30)], [{ type: 'suggestions_shown' }, T(15, 30)], [{ type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(15, 30)], [{ type: 'friend_reply', friendId: 'priya', messageId: 'm1', reply: 'yes' }, T(15, 31)]];

describe('repeated owner actions are idempotent (PAW-014)', () => {
  it('a second Confirm for the same friend changes nothing and sends nothing', () => {
    const once = run([...accepted, [{ type: 'owner_confirm', friendId: 'priya' }, T(15, 32)]]).req;
    const twice = reduce(once, { type: 'owner_confirm', friendId: 'priya' }, T(15, 32));
    expect(twice.effects).toEqual([]);
    expect(twice.req.history).toHaveLength(once.history.length);
    expect(twice.req.state).toBe('Confirmed');
  });
  it('Confirm for a different friend after confirming is still refused', () => {
    const once = run([...accepted, [{ type: 'owner_confirm', friendId: 'priya' }, T(15, 32)]]).req;
    expect(() => reduce(once, { type: 'owner_confirm', friendId: 'arjun' }, T(15, 32))).toThrow(TransitionError);
  });
  it('a second Cancel changes nothing and messages nobody again', () => {
    const once = run([...accepted, [{ type: 'owner_cancel' }, T(15, 33)]]).req;
    const twice = reduce(once, { type: 'owner_cancel' }, T(15, 33));
    expect(twice.effects).toEqual([]);
    expect(twice.req.history).toHaveLength(once.history.length);
  });
  it('a second identical Send is ignored; a different recipient list is refused', () => {
    const sent = run(accepted.slice(0, 3)).req;
    const again = reduce(sent, { type: 'owner_approved_send', friendIds: ['priya'], mode: 'one' }, T(15, 30));
    expect(again.effects).toEqual([]); expect(again.req.history).toHaveLength(sent.history.length);
    expect(() => reduce(sent, { type: 'owner_approved_send', friendIds: ['arjun'], mode: 'one' }, T(15, 30))).toThrow(TransitionError);
  });
});
