/**
 * Login isolation and hardening (security round 2): what every kind of login can reach, sessions after sign-out,
 * production-mode lock-downs (no demo codes, job runner and webhooks fail closed), body limits, headers, stored XSS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, migrate, seedDemo, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';

type App = ReturnType<typeof createApp>;
const mk = (app: App) => ({
  call: async <T = any>(m: string, p: string, b?: unknown, t?: string, h: Record<string, string> = {}) => {
    const r = await app.request(p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}), ...h }, body: b === undefined ? undefined : typeof b === 'string' ? b : JSON.stringify(b) });
    const text = await r.text(); let body: T; try { body = JSON.parse(text); } catch { body = text as T; }
    return { status: r.status, body, text, headers: r.headers };
  }
});
const WHO = { owner: '+919800000021', coowner: '+919800000022', backup: '+919700000008', helper: '+919000000035', friend: '+919900000012', stranger: '+919811222333', ops: '+919811000001' } as const;
const HH_ROUTES = ['today', 'pets', 'circle', 'code-cards/current', 'day/timeline', 'day/report', 'friends', 'friends/u_priya', 'health', 'helpers', 'incidents', 'privacy', 'requests', 'routine', 'wallet'];
const ALLOWED: Record<keyof typeof WHO, string[]> = {
  owner: HH_ROUTES,
  coowner: HH_ROUTES.filter(r => !['code-cards/current'].includes(r)), // co-owners see the helper list (names and consent, no phone numbers)
  backup: ['today', 'day/timeline', 'day/report', 'incidents'],
  helper: ['helpers'],
  friend: [], stranger: [], ops: []
};

let db: Db, app: App, clock: ReturnType<typeof demoClock>, api: ReturnType<typeof mk>, tok: Record<string, string> = {};
const signIn = async (phone: string) => { const r = await api.call('POST', '/auth/otp/request', { phone }); return (await api.call('POST', '/auth/otp/verify', { phone, code: r.body.demoCode })).body.token as string; };

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  clock = demoClock('2026-11-06T14:05:00+05:30');
  app = createApp({ db, adapters: mockAdapters(), clock, pepper: 'test', demoMode: true }); api = mk(app);
  await api.call('POST', '/jobs/tick');
  for (const [k, p] of Object.entries(WHO)) tok[k] = await signIn(p);
}, 90000);

describe('what each login can see', () => {
  for (const who of Object.keys(WHO) as (keyof typeof WHO)[]) {
    it(`${who}: reaches exactly its allowed household data and never another person’s phone or the flat number`, async () => {
      const reached: string[] = [];
      for (const r of HH_ROUTES) {
        const res = await api.call('GET', '/v1/households/hh_demo/' + r, undefined, tok[who]);
        if (res.status === 200) reached.push(r); else expect([403, 404]).toContain(res.status);
        const phones = [...new Set(res.text.match(/\+91\d{10}/g) ?? [])].filter(p => p !== WHO[who]);
        expect(phones, `${who} ${r} leaked phones`).toEqual([]);
        expect(res.text, `${who} ${r} leaked the flat`).not.toContain('B-1104');
      }
      expect(reached.sort()).toEqual([...ALLOWED[who]].sort());
      for (const p of ['/v1/me', '/v1/me/friend', '/v1/me/export', '/v1/me/rights']) {
        const res = await api.call('GET', p, undefined, tok[who]);
        expect(res.status).toBe(200);
        expect([...new Set(res.text.match(/\+91\d{10}/g) ?? [])].filter(x => x !== WHO[who]), `${who} ${p}`).toEqual([]);
      }
    });
  }
  it('code-card codes are visible to the owner only', async () => {
    for (const who of Object.keys(WHO)) expect((await api.call('GET', '/v1/households/hh_demo/code-cards/current', undefined, tok[who])).status === 200).toBe(who === 'owner');
  });
  it('a helper sees only their own helper record, not other helpers in the home', async () => {
    await db.query(`insert into users(id, phone_e164, display_name) values ('u_h2','+919811000777','Second Helper')`);
    await db.query(`insert into memberships(id, household_id, user_id, role, status) values ('m_h2','hh_demo','u_h2','helper','active')`);
    const mine = (await api.call<{ id: string }[]>('GET', '/v1/households/hh_demo/helpers', undefined, tok.helper)).body;
    expect(mine.map(h => h.id)).toEqual(['m_sunita']);
    const all = (await api.call<{ id: string }[]>('GET', '/v1/households/hh_demo/helpers', undefined, tok.owner)).body;
    expect(all.map(h => h.id).sort()).toEqual(['m_h2', 'm_sunita']);
  });
  it('a friend cannot read a request sent to someone else', async () => {
    const r = await api.call<{ id: string }>('POST', '/v1/households/hh_demo/requests', { text: 'Can someone feed Bruno at 5 pm?' }, tok.owner);
    await api.call('POST', `/v1/households/hh_demo/requests/${r.body.id}/search`, {}, tok.owner);
    await api.call('POST', `/v1/households/hh_demo/requests/${r.body.id}/approve`, { friendIds: ['u_arjun'], mode: 'one', approved: true }, tok.owner);
    const priya = (await api.call<{ requests: { id: string }[] }>('GET', '/v1/me/friend', undefined, tok.friend)).body;
    expect(priya.requests.map(x => x.id)).not.toContain(r.body.id);
    expect([403, 404]).toContain((await api.call('GET', `/v1/me/requests/${r.body.id}/access`, undefined, tok.friend)).status);
    expect([403, 404, 409]).toContain((await api.call('POST', `/v1/me/requests/${r.body.id}/reply`, { reply: 'yes' }, tok.friend)).status);
  });
});

describe('sessions', () => {
  it('sign-out ends the session on the server; the old token no longer works', async () => {
    const t = await (async () => { clock.advance(2); return signIn(WHO.coowner); })();
    expect((await api.call('GET', '/v1/me', undefined, t)).status).toBe(200);
    await api.call('POST', '/v1/auth/logout', {}, t);
    expect((await api.call('GET', '/v1/me', undefined, t)).status).toBe(401);
  });
  it('sign out of all devices ends every session of that person only', async () => {
    clock.advance(2); const a = await signIn(WHO.stranger); clock.advance(2); const b = await signIn(WHO.stranger);
    await api.call('POST', '/v1/auth/logout-all', {}, a);
    expect((await api.call('GET', '/v1/me', undefined, b)).status).toBe(401);
    expect((await api.call('GET', '/v1/me', undefined, tok.owner)).status).toBe(200); // other people unaffected
  });
  it('sessions expire after 30 days', async () => {
    clock.advance(2); const t = await signIn(WHO.ops);
    clock.advance(31 * 24 * 60);
    expect((await api.call('GET', '/v1/me', undefined, t)).status).toBe(401);
    clock.advance(-31 * 24 * 60);
  });
  it('a token for one person never opens another person’s data (no shared or guessable tokens)', async () => {
    expect(tok.owner).not.toBe(tok.coowner);
    expect(tok.owner.length).toBeGreaterThanOrEqual(43); // 256-bit random, base64url
    const me = (await api.call<{ user: { id: string } }>('GET', '/v1/me', undefined, tok.friend)).body;
    expect(me.user.id).toBe('u_priya');
  });
});

describe('hardening', () => {
  it('security headers are sent', async () => {
    const r = await api.call('GET', '/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('oversized request bodies are refused (413)', async () => {
    const r = await api.call('POST', '/v1/households/hh_demo/requests', JSON.stringify({ text: 'x'.repeat(70 * 1024) }), tok.owner);
    expect(r.status).toBe(413);
  });
  it('HTML in user text is stored and returned as plain text', async () => {
    const r = await api.call<{ id: string }>('POST', '/v1/households/hh_demo/pets', { name: '<img src=x onerror=alert(1)>', food: 'Dry food 150 g at 8 AM and 7 PM', allergies: 'None known', medicines: 'None', vet_name: 'Dr. Rao', vet_phone: '+91 22 5555 0101' }, tok.owner);
    const pets = (await api.call<{ id: string; name: string }[]>('GET', '/v1/households/hh_demo/pets', undefined, tok.owner)).body;
    expect(pets.find(p => p.id === r.body.id)!.name).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('production mode (DEMO_MODE off)', () => {
  let prod: ReturnType<typeof mk>; const saved = { ...process.env };
  beforeAll(async () => {
    const pdb = await openDb({ dataDir: 'memory' }); await migrate(pdb); await seedDemo(pdb);
    delete process.env.JOB_SECRET; delete process.env.WEBHOOK_SECRET;
    prod = mk(createApp({ db: pdb, adapters: mockAdapters(), clock: demoClock('2026-11-06T14:05:00+05:30'), pepper: 'prod-test', demoMode: false }));
  }, 60000);
  afterAll(() => { process.env = saved; });
  it('the sign-in code is never returned in the response', async () => {
    const r = await prod.call('POST', '/auth/otp/request', { phone: WHO.owner });
    expect(r.status).toBe(200); expect(r.body.demoCode).toBeUndefined();
  });
  it('demo routes do not exist', async () => {
    for (const p of ['/demo/outbox', '/demo/helper-thread/m_sunita', '/demo/friend-thread/u_priya']) expect((await prod.call('GET', p)).status).toBe(404);
    expect((await prod.call('POST', '/demo/clock', { advance: 5 })).status).toBe(404);
  });
  it('the job runner refuses to run without its secret, even when the secret is not configured', async () => {
    expect((await prod.call('POST', '/jobs/tick')).status).toBe(403);
    process.env.JOB_SECRET = 'job-secret-123';
    expect((await prod.call('POST', '/jobs/tick', undefined, undefined, { 'x-job-secret': 'wrong' })).status).toBe(403);
    expect((await prod.call('POST', '/jobs/tick', undefined, undefined, { 'x-job-secret': 'job-secret-123' })).status).toBe(200);
  });
  it('webhooks refuse unsigned calls, so nobody can post fake helper evidence', async () => {
    const msg = { messageId: 'p-1', from: WHO.helper, type: 'text', text: 'points' };
    expect((await prod.call('POST', '/webhooks/whatsapp', msg)).status).toBe(401);
    expect((await prod.call('POST', '/webhooks/ivr', { callId: 'c1', from: WHO.helper, event: 'arrive' })).status).toBe(401);
    process.env.WEBHOOK_SECRET = 'hook-secret-456';
    expect((await prod.call('POST', '/webhooks/whatsapp', msg, undefined, { 'x-webhook-secret': 'nope' })).status).toBe(401);
    expect((await prod.call('POST', '/webhooks/whatsapp', { ...msg, messageId: 'p-2' }, undefined, { 'x-webhook-secret': 'hook-secret-456' })).status).toBe(200);
  });
});
