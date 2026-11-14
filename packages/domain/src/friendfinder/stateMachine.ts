/**
 * Friend Finder request state machine — PRD 9.4, PS-059–061, PS-067, PS-068, PS-123.
 * Pure reducer: (request, event, now) → (request, effects). The API persists the request and executes effects
 * (WhatsApp sends, owner notifications, access disclosure/revocation) through adapters, keyed for idempotency.
 */
import type { Minutes } from '../types.js';

export type RequestState =
  | 'Draft' | 'Ready for search' | 'Awaiting owner approval' | 'Sent' | 'Accepted - pending owner confirmation'
  | 'Provisional hold' | 'Confirmed' | 'Completed' | 'Declined' | 'Expired' | 'Cancelled' | 'Cancelled by friend' | 'No-show' | 'Task changed'
  /** PAW-056: the friend had an emergency and left before finishing; never shown as Completed. */
  | 'Interrupted';
export type RecipientState = 'sent' | 'accepted' | 'waiting' | 'proposed' | 'unclear' | 'declined' | 'expired' | 'withdrawn' | 'released' | 'confirmed' | 'cancelled';

export interface Recipient { friendId: string; state: RecipientState; sentAt: Minutes; reminded: boolean; proposal?: Minutes }
export interface FriendRequest {
  id: string; state: RequestState; taskTime: Minutes | null; mode: 'one' | 'all3' | null;
  recipients: Recipient[]; holdFriendId?: string; holdAt?: Minutes; holdReminded?: boolean; confirmedFriendId?: string;
  friendSignalAt?: Minutes; exclude: string[]; processedMessageIds: string[];
  /** v1.4: reply window in minutes when the request is part of a wide ask (PS-134); default is the 15-minute expiry. */
  windowMin?: number;
  /** v1.4: the at-risk cover job this request was started from, and the line shown to the owner. */
  origin?: { jobId: string; text: string };
  /** v1.4 PS-138: first-time carers who ticked "I have read this" on the handling note. */
  noteReadBy?: string[];
  /** PAW-041: the friend said they are running late by this many minutes (arrival = taskTime + lateMin). */
  lateMin?: Minutes;
  /** PAW-060: what the friend finished before an emergency exit. */
  doneTasks?: string[];
  /** `at` is the minute of the care day; `ts` is the exact time the API recorded it (PAW-012). */
  history: { at: Minutes; state: RequestState; note: string; ts?: string }[];
}

export interface FFTimers { expiry: number; reminder: number; hold: number; holdReminder: number; closeBeforeTask: number; noShowAfter: number }
export const FF_TIMERS_V1: FFTimers = { expiry: 15, reminder: 8, hold: 10, holdReminder: 5, closeBeforeTask: 30, noShowAfter: 20 };

export type Effect =
  | { type: 'send_request'; friendId: string; reminder?: boolean }
  | { type: 'message_friend'; friendId: string; template: 'waiting_for_owner' | 'closed_covered' | 'already_covered' | 'request_closed' | 'released' | 'ask_time_again' | 'declined_ack' | 'reconfirm' | 'cancelled_by_owner' | 'access_removed' }
  | { type: 'notify_owner'; template: 'friend_yes' | 'friend_declined' | 'friend_proposed' | 'hold_reminder' | 'none_accepted' | 'friend_cancelled' | 'no_show' | 'search_closed' | 'friend_cancelled_after_cutoff' | 'friend_late' | 'friend_emergency'; friendId?: string; minutes?: Minutes }
  | { type: 'disclose_access'; friendId: string }
  | { type: 'revoke_access'; friendId: string }
  | { type: 'create_cover_task'; friendId: string; time: Minutes }
  | { type: 'resume_escalation_backup' }
  | { type: 'reopen_search'; exclude: string[] }
  /** v1.4 PS-131: after the search cutoff a cancelled cover goes to the ordered backup list instead of a new search. */
  | { type: 'backup_runner'; friendId: string; reason?: 'cancelled' | 'emergency' }
  /** PAW-060: record what was finished before an emergency exit; the rest stays open. */
  | { type: 'partial_done'; friendId: string; done: string[] };

export type FFEvent =
  | { type: 'parse_confirmed'; taskTime: Minutes }
  | { type: 'suggestions_shown' }
  | { type: 'owner_approved_send'; friendIds: string[]; mode: 'one' | 'all3' }
  | { type: 'friend_reply'; friendId: string; messageId: string; reply: 'yes' | 'no' | 'propose'; proposedTime?: Minutes | null }
  | { type: 'owner_confirm'; friendId: string }
  | { type: 'owner_cancel' }
  | { type: 'owner_change_time'; time: Minutes }
  | { type: 'friend_cancel' }
  | { type: 'friend_arrived' }
  | { type: 'friend_late'; minutes: Minutes }
  | { type: 'friend_emergency_leave'; done: string[] }
  | { type: 'completed' }
  | { type: 'tick' };

export class TransitionError extends Error {}
const OPEN: RequestState[] = ['Sent', 'Accepted - pending owner confirmation', 'Provisional hold'];
const CLOSED: RequestState[] = ['Confirmed', 'Completed', 'Declined', 'Expired', 'Cancelled', 'Cancelled by friend', 'No-show', 'Interrupted'];

export function newRequest(id: string, now: Minutes): FriendRequest {
  return { id, state: 'Draft', taskTime: null, mode: null, recipients: [], exclude: [], processedMessageIds: [], history: [{ at: now, state: 'Draft', note: 'Owner started Ask Pawsure' }] };
}

export function reduce(req0: FriendRequest, ev: FFEvent, now: Minutes, t: FFTimers = FF_TIMERS_V1): { req: FriendRequest; effects: Effect[] } {
  const req: FriendRequest = structuredClone(req0);
  const fx: Effect[] = [];
  const go = (s: RequestState, note: string) => { req.state = s; req.history.push({ at: now, state: s, note }); };
  const rec = (id: string) => req.recipients.find(r => r.friendId === id);

  switch (ev.type) {
    case 'parse_confirmed':
      if (req.state !== 'Draft') throw new TransitionError('parse already confirmed');
      req.taskTime = ev.taskTime; go('Ready for search', 'Owner confirmed the summary'); break;
    case 'suggestions_shown':
      if (req.state !== 'Ready for search') throw new TransitionError('not ready for search');
      go('Awaiting owner approval', 'Suggestions shown'); break;
    case 'owner_approved_send': {
      // PAW-014: the same Send arriving twice (double tap, network retry) is ignored rather than refused.
      if (req.state !== 'Awaiting owner approval' && req.recipients.length && req.recipients.length === ev.friendIds.length && ev.friendIds.every(f => rec(f)) && req.mode === ev.mode) return { req: req0, effects: [] };
      if (req.state !== 'Awaiting owner approval') throw new TransitionError('owner approval is only possible after suggestions');
      if (!ev.friendIds.length || (ev.mode === 'one' && ev.friendIds.length !== 1) || ev.friendIds.length > 3) throw new TransitionError('invalid recipients');
      // PS-131: no new request at or after the search cutoff. The owner is told why and the backup list is used instead.
      if (req.taskTime != null && now >= req.taskTime - t.closeBeforeTask) throw new TransitionError(`Too close to the task for Friend Finder: the search closes ${t.closeBeforeTask} minutes before the task. Ask your backups instead.`);
      req.mode = ev.mode;
      req.recipients = ev.friendIds.map(friendId => ({ friendId, state: 'sent' as RecipientState, sentAt: now, reminded: false }));
      ev.friendIds.forEach(friendId => fx.push({ type: 'send_request', friendId }));
      go('Sent', ev.mode === 'all3' ? `Ask all ${ev.friendIds.length}` : 'Sent to one friend'); break;
    }
    case 'friend_reply': {
      if (req.processedMessageIds.includes(ev.messageId)) return { req: req0, effects: [] }; // idempotent webhook (PS-123)
      req.processedMessageIds.push(ev.messageId);
      const r = rec(ev.friendId);
      if (!r) break;
      const closed = CLOSED.includes(req.state) || ['expired', 'withdrawn', 'released'].includes(r.state);
      if (closed && ev.reply !== 'no') {
        fx.push({ type: 'message_friend', friendId: r.friendId, template: req.state === 'Confirmed' || req.state === 'Completed' ? 'already_covered' : 'request_closed' });
        req.history.push({ at: now, state: req.state, note: `Late reply from ${r.friendId}: no state change` });
        break;
      }
      if (ev.reply === 'no') {
        r.state = 'declined'; fx.push({ type: 'message_friend', friendId: r.friendId, template: 'declined_ack' }, { type: 'notify_owner', template: 'friend_declined', friendId: r.friendId });
        req.history.push({ at: now, state: req.state, note: `${r.friendId} declined` });
        if (req.recipients.every(x => ['declined', 'expired', 'withdrawn', 'released'].includes(x.state))) { go('Declined', 'Nobody selected can help'); fx.push({ type: 'notify_owner', template: 'none_accepted' }); }
        break;
      }
      if (ev.reply === 'propose') {
        if (ev.proposedTime == null) { r.state = 'unclear'; fx.push({ type: 'message_friend', friendId: r.friendId, template: 'ask_time_again' }); req.history.push({ at: now, state: req.state, note: `${r.friendId}: unclear reply, still pending` }); break; }
        r.state = 'proposed'; r.proposal = ev.proposedTime;
        fx.push({ type: 'message_friend', friendId: r.friendId, template: 'waiting_for_owner' }, { type: 'notify_owner', template: 'friend_proposed', friendId: r.friendId });
        go('Accepted - pending owner confirmation', `${r.friendId} proposed ${ev.proposedTime}; owner must confirm before the schedule changes`); break;
      }
      // yes. PAW-054: a second Yes from the same friend (app and WhatsApp together, or a retry) changes nothing.
      if (['accepted', 'waiting', 'confirmed'].includes(r.state)) return { req: req0, effects: [] };
      if (req.mode === 'all3') {
        if (req.holdFriendId && req.holdFriendId !== r.friendId) { r.state = 'waiting'; fx.push({ type: 'message_friend', friendId: r.friendId, template: 'waiting_for_owner' }); req.history.push({ at: now, state: req.state, note: `${r.friendId} also said yes, no duplicate cover` }); break; }
        r.state = 'accepted'; req.holdFriendId = r.friendId; req.holdAt = now; req.holdReminded = false;
        req.recipients.filter(x => x.friendId !== r.friendId && x.state === 'sent').forEach(x => fx.push({ type: 'message_friend', friendId: x.friendId, template: 'waiting_for_owner' }));
        fx.push({ type: 'notify_owner', template: 'friend_yes', friendId: r.friendId });
        go('Provisional hold', `${r.friendId} said yes first, hold ${t.hold} min`);
      } else {
        r.state = 'accepted'; fx.push({ type: 'message_friend', friendId: r.friendId, template: 'waiting_for_owner' }, { type: 'notify_owner', template: 'friend_yes', friendId: r.friendId });
        go('Accepted - pending owner confirmation', `${r.friendId} said yes`);
      }
      break;
    }
    case 'owner_confirm': {
      const r = rec(ev.friendId);
      if (req.confirmedFriendId === ev.friendId && r?.state === 'confirmed') return { req: req0, effects: [] }; // PAW-014: repeated Confirm
      if (!r || !['accepted', 'proposed'].includes(r.state) || !OPEN.includes(req.state)) throw new TransitionError('nothing to confirm for this friend');
      if (r.proposal != null) req.taskTime = r.proposal;
      r.state = 'confirmed'; req.confirmedFriendId = r.friendId;
      req.recipients.filter(x => x !== r && !['declined', 'expired'].includes(x.state)).forEach(x => { x.state = 'withdrawn'; fx.push({ type: 'message_friend', friendId: x.friendId, template: 'closed_covered' }); });
      fx.push({ type: 'disclose_access', friendId: r.friendId }, { type: 'create_cover_task', friendId: r.friendId, time: req.taskTime! });
      go('Confirmed', `Owner confirmed ${r.friendId}`); break;
    }
    case 'owner_cancel':
      if (req.state === 'Cancelled') return { req: req0, effects: [] }; // PAW-014: repeated Cancel
      if (CLOSED.includes(req.state) && req.state !== 'Confirmed') throw new TransitionError('already closed');
      req.recipients.filter(x => !['declined', 'expired', 'withdrawn'].includes(x.state)).forEach(x => { fx.push({ type: 'message_friend', friendId: x.friendId, template: 'cancelled_by_owner' }); if (x.state === 'confirmed') fx.push({ type: 'revoke_access', friendId: x.friendId }); x.state = 'withdrawn'; });
      go('Cancelled', 'Owner cancelled'); break;
    case 'owner_change_time': {
      const fid = req.confirmedFriendId ?? req.holdFriendId ?? req.recipients.find(x => x.state === 'accepted')?.friendId;
      if (!fid || !(['Confirmed', ...OPEN] as RequestState[]).includes(req.state)) throw new TransitionError('time can only change on an accepted request');
      req.taskTime = ev.time;
      const r = rec(fid)!; r.state = 'sent'; r.sentAt = now; r.reminded = false;
      if (req.confirmedFriendId) fx.push({ type: 'revoke_access', friendId: fid });
      req.confirmedFriendId = undefined; req.holdFriendId = undefined; req.holdAt = undefined;
      fx.push({ type: 'message_friend', friendId: fid, template: 'reconfirm' });
      go('Task changed', `Time changed to ${ev.time}; friend must reconfirm`); go('Sent', 'Re-sent for reconfirmation'); break;
    }
    case 'friend_cancel': {
      if (req.state !== 'Confirmed' || !req.confirmedFriendId) throw new TransitionError('friend can only cancel a confirmed request');
      const fid = req.confirmedFriendId; rec(fid)!.state = 'cancelled';
      fx.push({ type: 'notify_owner', template: 'friend_cancelled', friendId: fid }, { type: 'revoke_access', friendId: fid }, { type: 'message_friend', friendId: fid, template: 'access_removed' });
      const afterCutoff = req.taskTime != null && now >= req.taskTime - t.closeBeforeTask;
      if (afterCutoff) fx.push({ type: 'notify_owner', template: 'friend_cancelled_after_cutoff', friendId: fid }, { type: 'backup_runner', friendId: fid });
      else fx.push({ type: 'reopen_search', exclude: [...req.exclude, fid] });
      go('Cancelled by friend', afterCutoff ? `${fid} cancelled after the search cutoff: backup list asked instead (PS-131)` : `${fid} cancelled after confirming`); break;
    }
    case 'friend_arrived':
      if (req.friendSignalAt != null) return { req: req0, effects: [] }; // PAW-047: a second check-in changes nothing
      req.friendSignalAt = now; req.history.push({ at: now, state: req.state, note: 'Friend checked in' }); break;
    case 'friend_late': {
      // PAW-041 / PAW-051: owner gets the new arrival time; the no-show alarm moves with it (capped, see tick).
      if (req.state !== 'Confirmed' || !req.confirmedFriendId) throw new TransitionError('only a confirmed friend can report a delay');
      if (req.friendSignalAt != null) throw new TransitionError('already checked in');
      if (req.lateMin === ev.minutes) return { req: req0, effects: [] };
      req.lateMin = ev.minutes;
      fx.push({ type: 'notify_owner', template: 'friend_late', friendId: req.confirmedFriendId, minutes: ev.minutes });
      req.history.push({ at: now, state: req.state, note: `${req.confirmedFriendId} running about ${ev.minutes} min late` }); break;
    }
    case 'friend_emergency_leave': {
      // PAW-056 to PAW-060: an emergency exit is Interrupted, never Completed. What was done is recorded, access ends,
      // and the ordered backup list is asked for the rest at once (a new friend search would be too slow mid-visit).
      if (req.state === 'Interrupted') return { req: req0, effects: [] };
      if (req.state !== 'Confirmed' || !req.confirmedFriendId) throw new TransitionError('only a confirmed visit can be interrupted');
      const fid = req.confirmedFriendId; rec(fid)!.state = 'cancelled'; req.doneTasks = ev.done;
      fx.push({ type: 'notify_owner', template: 'friend_emergency', friendId: fid }, { type: 'partial_done', friendId: fid, done: ev.done }, { type: 'revoke_access', friendId: fid }, { type: 'message_friend', friendId: fid, template: 'access_removed' }, { type: 'backup_runner', friendId: fid, reason: 'emergency' });
      go('Interrupted', `${fid} had an emergency and left${ev.done.length ? ' after: ' + ev.done.join(', ') : ' before starting'}`); break;
    }
    case 'completed':
      if (req.state !== 'Confirmed') throw new TransitionError('only a confirmed request can complete');
      fx.push({ type: 'revoke_access', friendId: req.confirmedFriendId! }); go('Completed', 'Friend finished'); break;
    case 'tick': {
      if (OPEN.includes(req.state)) {
        for (const r of req.recipients) {
          if (r.state !== 'sent') continue;
          const expiry = req.windowMin ?? t.expiry, reminder = req.windowMin ? Math.round(req.windowMin / 2) : t.reminder;
          if (!r.reminded && now >= r.sentAt + reminder) { r.reminded = true; fx.push({ type: 'send_request', friendId: r.friendId, reminder: true }); }
          if (now >= r.sentAt + expiry) { r.state = 'expired'; req.history.push({ at: now, state: req.state, note: `${r.friendId}: no reply in ${expiry} min` }); }
        }
        if (req.state === 'Provisional hold' && req.holdAt != null) {
          if (!req.holdReminded && now >= req.holdAt + t.holdReminder) { req.holdReminded = true; fx.push({ type: 'notify_owner', template: 'hold_reminder', friendId: req.holdFriendId }); }
          if (now >= req.holdAt + t.hold) {
            const r = rec(req.holdFriendId!)!; r.state = 'released'; fx.push({ type: 'message_friend', friendId: r.friendId, template: 'released' });
            req.holdFriendId = undefined; req.holdAt = undefined; go('Sent', `Hold released after ${t.hold} min without owner confirmation`);
          }
        }
        if (req.recipients.length && req.recipients.every(x => ['declined', 'expired', 'withdrawn', 'released'].includes(x.state))) { go('Expired', 'No acceptance'); fx.push({ type: 'notify_owner', template: 'none_accepted' }); }
        // v1.1.0 fix: a Yes received before the cutoff is honoured until its hold ends (or, for one friend, until the task time).
        else if (req.taskTime != null && req.state === 'Accepted - pending owner confirmation' && now >= req.taskTime) { go('Expired', 'Not confirmed by the task time'); fx.push({ type: 'notify_owner', template: 'none_accepted' }); }
        else if (req.taskTime != null && now >= req.taskTime - t.closeBeforeTask && req.state === 'Sent') { go('Expired', `Search closed ${t.closeBeforeTask} min before the task`); fx.push({ type: 'notify_owner', template: 'search_closed' }); }
      }
      if (req.state === 'Confirmed' && req.taskTime != null && req.friendSignalAt == null && now >= req.taskTime + Math.max(t.noShowAfter, Math.min((req.lateMin ?? 0) + 10, t.noShowAfter + 60))) {
        fx.push({ type: 'notify_owner', template: 'no_show', friendId: req.confirmedFriendId }, { type: 'resume_escalation_backup' });
        go('No-show', `No friend signal by task time + ${t.noShowAfter} min (private record)`);
      }
      break;
    }
  }
  return { req, effects: fx };
}
