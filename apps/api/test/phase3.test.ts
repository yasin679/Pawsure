import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

let db: Db, app: ReturnType<typeof createApp>, adapters: ReturnType<typeof mockAdapters>, clock: ReturnType<typeof demoClock>, owner: string, priya: string;
const DAY = '2026-11-06', at = (hm: string) => `${DAY}T${hm}:00+05:30`, HH = '/v1/households/hh_demo';
const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as T };
};
const signIn = async (phone: string) => { const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone }); return (await call<{ token: string }>('POST', '/auth/otp/verify', { phone, code: r.body.demoCode })).body.token; };
const tick = () => call<{ sent: string[] }>('POST', '/jobs/tick');
let n = 0;
const reply = (from: string, payload?: string, text?: string, messageId = 'r' + ++n) => call('POST', '/webhooks/whatsapp', { from, messageId, type: payload ? 'button' : 'text', payload, text });
type View = { id: string; state: string; clarifications: { field: string; options: { value: string }[] }[]; blocked: string[]; recipients: { friendId: string; state: string }[]; taskTime: number; correctedFields: string[]; needsManualForm?: boolean };
type Search = { top: { id: string; message: string; reasons: string[] }[]; excludedCounts: Record<string, number>; nearbyFallback: { offered: boolean } };
const ask = async (text: string) => (await call<View>('POST', `${HH}/requests`, { text }, owner)).body;
const search = async (id: string) => call<Search>('POST', `${HH}/requests/${id}/search`, {}, owner);
const PHONE = { priya: '+919900000012', arjun: '+919800000077', kavya: '+919600000045', rahul: '+919300000002' };
const EXAMPLE = 'I am stuck in a meeting until 8. Can someone feed Bruno and take him down at 5?';

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  adapters = mockAdapters(); clock = demoClock(at('15:30'));
  app = createApp({ db, adapters, clock, pepper: 'test', demoMode: true, limits: { requestsPerHour: 1000 } }); // many requests in seconds; the limit itself is tested in security.test
  owner = await signIn('+919800000021'); priya = await signIn(PHONE.priya); await tick();
}, 60000);

describe('F4/F5: parse, search, approve (PS-055–059)', () => {
  let id: string;
  it('parses the PRD example with no clarifications', async () => {
    const r = await ask(EXAMPLE); id = r.id;
    expect(r.state).toBe('Draft'); expect(r.clarifications).toEqual([]); expect(r.blocked).toEqual([]);
  });
  it('friends-first, nearest-first; exclusions shown as counts; no private details in messages', async () => {
    const s = (await search(id)).body;
    expect(s.top.map(t => t.id)).toEqual(['u_priya', 'u_arjun', 'u_kavya']);
    expect(s.excludedCounts).toMatchObject({ 'Has not opted in to be found': 1, 'Paused requests': 1, 'Has not chosen walk': 1, 'Not free at that time': 1 });
    expect(s.top[0]!.message).toContain('feed Bruno and take him for a short walk at 5:00');
    expect(s.top[1]!.message).toContain('ब्रूनो'); // Arjun gets Hindi
    expect(JSON.stringify(s.top)).not.toMatch(/B-1104|1104|Ankita|key with/i); // friend messages carry no flat, key holder or schedule
    expect(s.nearbyFallback.offered).toBe(false);
  });
  it('nothing is sent without explicit approval, and only to eligible friends', async () => {
    expect((await call('POST', `${HH}/requests/${id}/approve`, { friendIds: ['u_priya'], mode: 'one' }, owner)).status).toBe(400);
    expect((await call('POST', `${HH}/requests/${id}/approve`, { friendIds: ['u_meera'], mode: 'one', approved: true }, owner)).status).toBe(409);
    expect(adapters.outbox.filter(o => o.template.startsWith('FF-REQ')).length).toBe(0);
    const r = await call<View>('POST', `${HH}/requests/${id}/approve`, { friendIds: ['u_priya'], mode: 'one', approved: true }, owner);
    expect(r.body.state).toBe('Sent');
    expect((await call('POST', `${HH}/requests/${id}/approve`, { friendIds: ['u_priya'], mode: 'one', approved: true }, owner)).status).toBe(409);
  });
  it('friend Yes is idempotent; access stays hidden until the owner confirms', async () => {
    await reply(PHONE.priya, `ff_yes:${id}`, undefined, 'dup-1');
    expect((await reply(PHONE.priya, `ff_yes:${id}`, undefined, 'dup-1')).body).toEqual({ status: 'duplicate_event' });
    expect((await call<View>('GET', `${HH}/requests/${id}`, undefined, owner)).body.state).toBe('Accepted - pending owner confirmation');
    expect((await call('GET', `/v1/me/requests/${id}/access`, undefined, priya)).status).toBe(403);
  });
  it('owner confirms → minimum access disclosed, cover task on Today; done → completed and access removed', async () => {
    await call('POST', `${HH}/requests/${id}/confirm`, { friendId: 'u_priya' }, owner);
    const acc = await call<{ flat: string; pet: { medicines: string } }>('GET', `/v1/me/requests/${id}/access`, undefined, priya);
    expect(acc.status).toBe(200); expect(acc.body.flat).toBe('B-1104'); expect(acc.body.pet.medicines).toBe('Not part of this visit');
    const today = (await call<{ tasks: { id: string; ev: { state: string } }[] }>('GET', `${HH}/today`, undefined, owner)).body;
    expect(today.tasks.some(t => t.id === 'cover_' + id)).toBe(true);
    clock.set(at('17:02'));
    await call('POST', `/v1/me/requests/${id}/arrived`, {}, priya);
    await call('POST', `/v1/me/requests/${id}/done`, {}, priya);
    expect((await call<View>('GET', `${HH}/requests/${id}`, undefined, owner)).body.state).toBe('Completed');
    expect((await call('GET', `/v1/me/requests/${id}/access`, undefined, priya)).status).toBe(403);
    const t2 = (await call<{ tasks: { id: string; ev: { state: string } }[] }>('GET', `${HH}/today`, undefined, owner)).body;
    expect(t2.tasks.find(t => t.id === 'cover_' + id)!.ev.state).toBe('Likely');
  });
});

describe('Ask all 3 race and proposed times (PS-061, PS-067, PS-068, PS-123)', () => {
  it('first yes holds; second yes waits; hold released after 10 min', async () => {
    clock.set(at('17:30'));
    const r = await ask('Can someone feed Bruno and take him down at 7 pm?');
    const s = (await search(r.id)).body;
    await call('POST', `${HH}/requests/${r.id}/approve`, { friendIds: s.top.map(t => t.id), mode: 'all3', approved: true }, owner);
    await reply(PHONE.arjun, undefined, 'haan');
    expect(s.top.map(t => t.id)).toEqual(['u_priya', 'u_arjun', 'u_rahul']); // at 7 PM Rahul (5 min, free 7–10) outranks Kavya (next society)
    await reply(PHONE.rahul, `ff_yes:${r.id}`);
    let v = (await call<View & { holdFriendId: string }>('GET', `${HH}/requests/${r.id}`, undefined, owner)).body;
    expect(v.state).toBe('Provisional hold'); expect(v.holdFriendId).toBe('u_arjun');
    expect(v.recipients.find(x => x.friendId === 'u_rahul')!.state).toBe('waiting');
    clock.set(at('17:41')); await tick();
    v = (await call<View & { holdFriendId: string }>('GET', `${HH}/requests/${r.id}`, undefined, owner)).body;
    expect(v.state).toBe('Sent');
    expect(adapters.outbox.some(o => o.channel === 'push' && /waiting for you to confirm/.test(o.body))).toBe(true);
  });
  it('a proposed time changes nothing until the owner confirms', async () => {
    clock.set(at('16:00'));
    const r = await ask('Can someone feed Bruno at 6 pm?');
    await search(r.id);
    await call('POST', `${HH}/requests/${r.id}/approve`, { friendIds: ['u_arjun'], mode: 'one', approved: true }, owner);
    await reply(PHONE.arjun, undefined, 'thoda late');
    expect((await call<View>('GET', `${HH}/requests/${r.id}`, undefined, owner)).body.recipients[0]!.state).toBe('unclear');
    await reply(PHONE.arjun, undefined, '6:30 baje kar sakta hoon');
    let v = (await call<View>('GET', `${HH}/requests/${r.id}`, undefined, owner)).body;
    expect([v.state, v.taskTime]).toEqual(['Accepted - pending owner confirmation', 18 * 60]);
    v = (await call<View>('POST', `${HH}/requests/${r.id}/confirm`, { friendId: 'u_arjun' }, owner)).body;
    expect(v.taskTime).toBe(18 * 60 + 30);
  });
});

describe('clarification, AI fallback, correction metric (PS-056, PS-065, PS-125)', () => {
  it('ambiguous medicine / time / access blocks search until answered; medicine limits to capable friends', async () => {
    clock.set(at('15:00'));
    const r = await ask('Can someone give Bruno his medicine this evening and let themselves in?');
    expect(r.clarifications.map(c => c.field).sort()).toEqual(['access', 'meds', 'time']);
    expect((await search(r.id)).status).toBe(409);
    for (const [field, value] of [['time', String(19 * 60)], ['access', 'Key handover'], ['meds', 'profile']]) await call('PATCH', `${HH}/requests/${r.id}`, { clarify: { field, value } }, owner);
    expect((await search(r.id)).body.top.map(t => t.id)).toEqual([]); // Arjun (only medicine-capable) is busy with the 6:30 cover
  });
  it('AI unavailable or low confidence → manual form; the form still matches', async () => {
    adapters.llm.mode = 'down';
    const a = await ask('feed bruno 6pm');
    expect(a.needsManualForm).toBe(true);
    adapters.llm.mode = 'lowconf';
    expect((await ask(EXAMPLE)).needsManualForm).toBe(true);
    adapters.llm.mode = 'ok';
    const m = (await call<View>('POST', `${HH}/requests`, { manual: { tasks: ['feed'], petId: 'bruno', time: 20 * 60, access: 'Key handover' } }, owner)).body;
    expect((await search(m.id)).body.top.length).toBeGreaterThan(0);
  });
  it('owner corrections to critical fields are recorded for the ≤10% gate', async () => {
    const r = await ask(EXAMPLE);
    const v = (await call<View>('PATCH', `${HH}/requests/${r.id}`, { fields: { time: 17 * 60 + 30 } }, owner)).body;
    expect(v.correctedFields).toEqual(['time']);
  });
});

describe('friend controls, cancellation, no-show, block (PS-053, PS-064, PS-123)', () => {
  it('opting out removes a friend from search immediately', async () => {
    clock.set(at('15:30'));
    await call('PUT', '/v1/me/friend', { discoverable: false }, priya);
    const r = await ask(EXAMPLE);
    expect((await search(r.id)).body.top.map(t => t.id)).not.toContain('u_priya');
    await call('PUT', '/v1/me/friend', { discoverable: true }, priya);
  });
  it('friend cancels after confirming → access revoked, search reopened without them', async () => {
    const r = await ask(EXAMPLE); await search(r.id);
    await call('POST', `${HH}/requests/${r.id}/approve`, { friendIds: ['u_priya'], mode: 'one', approved: true }, owner);
    await reply(PHONE.priya, `ff_yes:${r.id}`);
    await call('POST', `${HH}/requests/${r.id}/confirm`, { friendId: 'u_priya' }, owner);
    await call('POST', `/v1/me/requests/${r.id}/cancel`, {}, priya);
    expect((await call<View>('GET', `${HH}/requests/${r.id}`, undefined, owner)).body.state).toBe('Cancelled by friend');
    expect((await call('GET', `/v1/me/requests/${r.id}/access`, undefined, priya)).status).toBe(403);
    const reopened = (await call<(View & { exclude: string[] })[]>('GET', `${HH}/requests`, undefined, owner)).body.find(x => x.exclude?.includes('u_priya'));
    expect(reopened?.state).toBe('Ready for search');
  });
  it('#21 no friend signal by task + 20 min → No-show and backup escalation resumes', async () => {
    const r = await ask(EXAMPLE); await search(r.id);
    await call('POST', `${HH}/requests/${r.id}/approve`, { friendIds: ['u_kavya'], mode: 'one', approved: true }, owner);
    await reply(PHONE.kavya, `ff_yes:${r.id}`);
    await call('POST', `${HH}/requests/${r.id}/confirm`, { friendId: 'u_kavya' }, owner);
    clock.set(at('17:20')); await tick();
    expect((await call<View>('GET', `${HH}/requests/${r.id}`, undefined, owner)).body.state).toBe('No-show');
    await tick();
    expect(adapters.outbox.some(o => o.template.startsWith('LOOKIN-15') && o.body.includes('friend cover'))).toBe(true);
  });
  it('block / report creates an ops case and removes the friend from search', async () => {
    clock.set(at('15:30'));
    await call('POST', `${HH}/friends/u_kavya/report`, { reason: 'Made me uncomfortable', block: true }, owner);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from ops_cases where kind='abuse'`))[0]!.n).toBe(1);
    const r = await ask(EXAMPLE);
    expect((await search(r.id)).body.excludedCounts['Blocked']).toBe(1);
  });
  it('#27 no friend free → honest empty result; nearby fallback stays off', async () => {
    clock.set(at('10:00'));
    const r = await ask('Can someone take Bruno for a walk at 11 am?');
    const s = (await search(r.id)).body;
    expect(s.top).toEqual([]); expect(s.nearbyFallback.offered).toBe(false);
  });
});

describe('F1 privacy and F2 invites (PS-050, PS-051, PS-054)', () => {
  it('privacy panel lists what friends see; nearby fallback is locked off', async () => {
    const p = (await call<{ hiddenUntilConfirmed: string[]; nearbyFallback: { available: boolean } }>('GET', `${HH}/privacy`, undefined, owner)).body;
    expect(p.hiddenUntilConfirmed).toContain('Flat number'); expect(p.nearbyFallback.available).toBe(false);
  });
  it('an invited friend is not findable until they opt in', async () => {
    await call('POST', `${HH}/friends/invite`, { name: 'Zoya', phone: '+919811100000', language: 'en' }, owner);
    const list = (await call<{ name: string; findable: boolean }[]>('GET', `${HH}/friends`, undefined, owner)).body;
    expect(list.find(f => f.name === 'Zoya')!.findable).toBe(false);
  });
});
