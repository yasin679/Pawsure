/**
 * Phase 5 security / privacy red-team (master prompt §13, §18): tenant isolation, IDOR across every household route,
 * enumeration, OTP abuse, signed links, staff vs household data, session revocation, webhook spoofing, spam limits,
 * injection, media and code leakage, audit immutability.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

let db: Db, app: ReturnType<typeof createApp>, clock: ReturnType<typeof demoClock>;
let neha: string, eve: string, eveHh: string, ops: string, priya: string;
const DAY = '2026-11-08', at = (hm: string) => `${DAY}T${hm}:00+05:30`;
const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) as T };
};
const signIn = async (phone: string) => { const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone }); return (await call<{ token: string }>('POST', '/auth/otp/verify', { phone, code: r.body.demoCode })).body.token; };

// Every household-scoped route, with a plausible id from the victim household.
const ROUTES: [string, string, unknown?][] = [
  ['GET', 'circle'], ['GET', 'code-cards/current'], ['GET', 'day/report'], ['GET', 'day/timeline'], ['GET', 'friends'], ['GET', 'friends/u_priya'], ['GET', 'health'], ['GET', 'helpers'],
  ['GET', 'incidents'], ['GET', 'pets'], ['GET', 'privacy'], ['GET', 'requests'], ['GET', 'routine'], ['GET', 'today'], ['GET', 'wallet'],
  ['PATCH', 'pets/bruno', { name: 'X' }], ['POST', 'circle/m_ankita/revoke', {}], ['POST', 'circle/invite', { phone: '+919800000099', role: 'family' }], ['POST', 'code-cards', { reason: 'x' }],
  ['POST', 'day/back', {}], ['POST', 'day/leaving', { checklist: null, returnAt: 1200 }], ['POST', 'day/trusted-covered', {}], ['POST', 'friends/u_priya/block', {}], ['POST', 'friends/invite', { name: 'X', phone: '+919800000098', language: 'en' }],
  ['POST', 'health', { petId: 'bruno', kind: 'vaccine', label: 'x' }], ['POST', 'helpers/invite', { name: 'X', phone: '+919800000097', language: 'en' }], ['POST', 'incidents', { category: 'injury' }],
  ['POST', 'pets', { name: 'X' }], ['POST', 'requests', { text: 'feed Bruno at 6 pm' }], ['POST', 'routine', { petId: 'bruno', title: 'X', type: 'feeding', due: 600, assignee: 'owner' }],
  ['POST', `tasks/r1_${DAY}/ack`, {}], ['POST', `tasks/r1_${DAY}/lifecycle`, { state: 'Cancelled', note: 'x' }], ['POST', `tasks/r1_${DAY}/resolve`, { note: 'x' }],
  ['PUT', 'day', { mode: 'trusted' }], ['PUT', 'privacy', { locShare: 'tower' }]
];

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  clock = demoClock(at('12:00'));
  app = createApp({ db, adapters: mockAdapters(), clock, pepper: 'test', demoMode: true });
  neha = await signIn('+919800000021'); ops = await signIn('+919811000001'); priya = await signIn('+919900000012');
  eve = await signIn('+919811222333');
  await call('POST', '/v1/consents', { items: [{ kind: 'terms', version: 'T-1.0', granted: true }, { kind: 'privacy', version: 'PN-1.0', granted: true }], language: 'en' }, eve);
  eveHh = (await call<{ id: string }>('POST', '/v1/households', { displayName: 'Eve', language: 'en', society: 'Hiranandani Gardens, Powai' }, eve)).body.id;
  await call('POST', '/jobs/tick');
}, 60000);

describe('tenant isolation and IDOR', () => {
  it('another household owner gets 403/404 on every route of hh_demo, and nothing changes', async () => {
    const before = JSON.stringify(await db.query(`select name from pets where household_id='hh_demo' order by id`));
    for (const [m, p, b] of ROUTES) {
      const r = await call(m, `/v1/households/hh_demo/${p}`, b, eve);
      expect([403, 404], `${m} ${p} → ${r.status}`).toContain(r.status);
    }
    expect(JSON.stringify(await db.query(`select name from pets where household_id='hh_demo' order by id`))).toBe(before);
  });
  it('a victim’s object id under the attacker’s own household is not found', async () => {
    for (const p of [`tasks/r1_${DAY}/ack`, 'pets/bruno', 'incidents/inc_x/ack', 'requests/ffr_x']) {
      const m = p.startsWith('pets') ? 'PATCH' : p.startsWith('requests') ? 'GET' : 'POST';
      const r = await call(m, `/v1/households/${eveHh}/${p}`, m === 'GET' ? undefined : { name: 'X' }, eve);
      expect([400, 403, 404, 409], p + ' → ' + r.status).toContain(r.status);
    }
    expect((await db.query<{ name: string }>(`select name from pets where id='bruno'`))[0]!.name).toBe('Bruno');
  });
  it('staff roles cannot read household data through the owner API', async () => {
    for (const p of ['pets', 'today', 'code-cards/current', 'day/timeline']) expect((await call('GET', `/v1/households/hh_demo/${p}`, undefined, ops)).status).toBe(403);
  });
  it('a friend cannot open another request’s access details', async () => {
    expect([403, 404]).toContain((await call('GET', '/v1/me/requests/ffr_not_mine/access', undefined, priya)).status);
  });
});

describe('authentication abuse', () => {
  it('OTP request looks the same for a known and an unknown number (no enumeration)', async () => {
    clock.set(at('12:30'));
    const known = await call<Record<string, unknown>>('POST', '/auth/otp/request', { phone: '+919800000021' });
    const unknown = await call<Record<string, unknown>>('POST', '/auth/otp/request', { phone: '+919811999888' });
    expect(known.status).toBe(unknown.status);
    expect(Object.keys(known.body).sort()).toEqual(Object.keys(unknown.body).sort());
  });
  it('five wrong codes lock the challenge', async () => {
    const phone = '+919811777666'; await call('POST', '/auth/otp/request', { phone });
    for (let i = 0; i < 5; i++) await call('POST', '/auth/otp/verify', { phone, code: '000000' });
    expect((await call('POST', '/auth/otp/verify', { phone, code: '000000' })).status).toBe(429);
  });
  it('garbage and missing bearer tokens are refused', async () => {
    expect((await call('GET', '/v1/me')).status).toBe(401);
    expect((await call('GET', '/v1/me', undefined, 'not-a-token')).status).toBe(401);
    expect((await call('GET', '/admin/overview', undefined, 'x'.repeat(43))).status).toBe(401);
  });
  it('sign out ends this session; sign out everywhere ends all of them', async () => {
    clock.set(at('13:00'));
    const a = await signIn('+919811555444'); clock.set(at('13:01')); const b = await signIn('+919811555444');
    await call('POST', '/v1/auth/logout', {}, a);
    expect((await call('GET', '/v1/me', undefined, a)).status).toBe(401);
    expect((await call('GET', '/v1/me', undefined, b)).status).toBe(200);
    clock.set(at('13:02')); const c2 = await signIn('+919811555444');
    expect((await call<{ signedOut: number }>('POST', '/v1/auth/logout-all', {}, b)).body.signedOut).toBe(2);
    expect((await call('GET', '/v1/me', undefined, c2)).status).toBe(401);
  });
});

describe('links, webhooks and leakage', () => {
  it('made-up look-in and share tokens reveal nothing', async () => {
    const l = await call('GET', '/l/' + 'a'.repeat(36)); expect([401, 404, 410]).toContain(l.status);
    const s = await call('GET', '/r/' + 'b'.repeat(24)); expect(s.status).toBe(410);
    expect(JSON.stringify(s.body)).not.toMatch(/Bruno|Powai|Sunita/);
  });
  it('a helper cannot post evidence onto another household’s task', async () => {
    await db.query(`insert into users(id, phone_e164, display_name) values ('u_h2','+919811000555','Helper Two')`);
    await db.query(`insert into memberships(id, household_id, user_id, role, status) values ('m_h2',$1,'u_h2','helper','active')`, [eveHh]);
    const r = await call('POST', '/webhooks/whatsapp', { from: '+919811000555', messageId: 'spoof-1', type: 'photo', taskId: `r1_${DAY}`, mediaRef: 'x', caption: '1234' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await db.query(`select 1 from checkin_signals where task_id=$1 and idempotency_key like '%spoof-1%'`, [`r1_${DAY}`])).length).toBe(0);
  });
  it('owner API never returns raw media keys, image hashes or code-card ciphertext', async () => {
    const today = JSON.stringify((await call('GET', '/v1/households/hh_demo/today', undefined, neha)).body);
    expect(today).not.toMatch(/evidence_ref|image_hash|codes_encrypted|media\//);
  });
  it('SQL in free text is stored as text', async () => {
    const r = await call('POST', '/v1/households/hh_demo/requests', { text: "feed Bruno at 6 pm'); drop table users; --" }, neha);
    expect(r.status).toBeLessThan(500);
    expect((await db.query(`select count(*)::int as n from users`))[0]).toBeTruthy();
  });
  it('cover requests are rate limited per household', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await call('POST', '/v1/households/hh_demo/requests', { text: `feed Bruno at 7 pm (${i})` }, neha)).status;
    expect(last).toBe(429);
  });
  it('the audit log refuses updates and deletes', async () => {
    await expect(db.query(`delete from audit_log where id=(select min(id) from audit_log)`)).rejects.toThrow();
    await expect(db.query(`update audit_log set actor='x' where id=(select min(id) from audit_log)`)).rejects.toThrow();
  });
});
