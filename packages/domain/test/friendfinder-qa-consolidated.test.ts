/** QA consolidated tracker (14 Nov 2026): pure rules for overnight hours, delays, emergency exits and repeated replies. */
import { describe, it, expect } from 'vitest';
import { newRequest, reduce, windowCovers, type FriendRequest } from '../src/index.js';

const confirmedReq = (): FriendRequest => {
  let r = newRequest('q', 900);
  r = reduce(r, { type: 'parse_confirmed', taskTime: 1080 }, 900).req;
  r = reduce(r, { type: 'suggestions_shown' }, 900).req;
  r = reduce(r, { type: 'owner_approved_send', friendIds: ['p'], mode: 'one' }, 900).req;
  r = reduce(r, { type: 'friend_reply', friendId: 'p', messageId: 'm1', reply: 'yes' }, 905).req;
  return reduce(r, { type: 'owner_confirm', friendId: 'p' }, 906).req;
};

describe('R-13 usually-free windows', () => {
  it('day windows include both exact ends; overnight windows wrap past midnight; empty windows match nothing', () => {
    expect(windowCovers([990, 1260], 990, 1000)).toBe(true);
    expect(windowCovers([990, 1260], 1250, 1260)).toBe(true);
    expect(windowCovers([990, 1260], 1255, 1265)).toBe(false);
    expect(windowCovers([1260, 360], 1270, 1280)).toBe(true);
    expect(windowCovers([1260, 360], 1430, 1450)).toBe(true); // 11:50 PM to 12:10 AM
    expect(windowCovers([1260, 360], 350, 370)).toBe(false);
    expect(windowCovers([600, 600], 600, 610)).toBe(false);
  });
});

describe('PAW-041 delays and PAW-056 emergency exits', () => {
  it('a delay moves the no-show alarm (capped at +80 min); a repeat is ignored; a delay after check-in is refused', () => {
    const r = reduce(confirmedReq(), { type: 'friend_late', minutes: 30 }, 1070);
    expect(r.effects).toEqual([{ type: 'notify_owner', template: 'friend_late', friendId: 'p', minutes: 30 }]);
    expect(reduce(r.req, { type: 'friend_late', minutes: 30 }, 1071).effects).toEqual([]);
    expect(reduce(r.req, { type: 'tick' }, 1100).req.state).toBe('Confirmed');
    expect(reduce(r.req, { type: 'tick' }, 1120).req.state).toBe('No-show');
    const long = reduce(confirmedReq(), { type: 'friend_late', minutes: 120 }, 1070).req;
    expect(reduce(long, { type: 'tick' }, 1159).req.state).toBe('Confirmed');
    expect(reduce(long, { type: 'tick' }, 1160).req.state).toBe('No-show');
    const arrived = reduce(confirmedReq(), { type: 'friend_arrived' }, 1080).req;
    expect(() => reduce(arrived, { type: 'friend_late', minutes: 10 }, 1081)).toThrow();
  });
  it('an emergency exit is Interrupted, never Completed: access revoked, backups asked, work done kept; repeats ignored', () => {
    const r = reduce(confirmedReq(), { type: 'friend_emergency_leave', done: ['feed'] }, 1085);
    expect(r.req.state).toBe('Interrupted'); expect(r.req.doneTasks).toEqual(['feed']);
    expect(r.effects.map(e => e.type)).toEqual(['notify_owner', 'partial_done', 'revoke_access', 'message_friend', 'backup_runner']);
    expect(reduce(r.req, { type: 'friend_emergency_leave', done: [] }, 1086).effects).toEqual([]);
    expect(() => reduce(r.req, { type: 'completed' }, 1090)).toThrow();
    expect(reduce(r.req, { type: 'tick' }, 1200).req.state).toBe('Interrupted'); // no no-show on top
  });
});

describe('PAW-054 / PAW-047 repeated replies and check-ins', () => {
  it('a second Yes and a second check-in from the same friend change nothing', () => {
    let r = newRequest('q', 900);
    r = reduce(r, { type: 'parse_confirmed', taskTime: 1080 }, 900).req;
    r = reduce(r, { type: 'suggestions_shown' }, 900).req;
    r = reduce(r, { type: 'owner_approved_send', friendIds: ['p'], mode: 'one' }, 900).req;
    r = reduce(r, { type: 'friend_reply', friendId: 'p', messageId: 'a', reply: 'yes' }, 901).req;
    const again = reduce(r, { type: 'friend_reply', friendId: 'p', messageId: 'b', reply: 'yes' }, 901);
    expect(again.effects).toEqual([]); expect(again.req.history.length).toBe(r.history.length);
    const c = reduce(reduce(r, { type: 'owner_confirm', friendId: 'p' }, 902).req, { type: 'friend_arrived' }, 1080).req;
    expect(reduce(c, { type: 'friend_arrived' }, 1081).req.history.length).toBe(c.history.length);
  });
});
