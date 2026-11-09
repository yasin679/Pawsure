import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, migrate, seedDemo, backup, unseal, verifyRestore, fingerprint, type Db } from '@pawsure/db';
import { createApp } from '../src/app.js';
import { mockAdapters } from '../src/adapters.js';
import { demoClock } from '../src/clock.js';
import { routeKey, p95 } from '../src/ops.js';

let db: Db, app: ReturnType<typeof createApp>, adapters: ReturnType<typeof mockAdapters>, clock: ReturnType<typeof demoClock>;
let owner: string, ops: string, auditor: string;
const DAY = '2026-11-08', at = (hm: string, d = DAY) => `${d}T${hm}:00+05:30`, HH = '/v1/households/hh_demo';
const KEY = Buffer.alloc(32, 7);
const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as T };
};
const signIn = async (phone: string) => { const r = await call<{ demoCode: string }>('POST', '/auth/otp/request', { phone }); return (await call<{ token: string }>('POST', '/auth/otp/verify', { phone, code: r.body.demoCode })).body.token; };
const tick = () => call<{ sent: string[] }>('POST', '/jobs/tick');
type Check = { key: string; status: string; value: string };

beforeAll(async () => {
  db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  adapters = mockAdapters(); clock = demoClock(at('09:00'));
  app = createApp({ db, adapters, clock, pepper: 'test', demoMode: true });
  owner = await signIn('+919800000021'); ops = await signIn('+919811000001'); auditor = await signIn('+919811000004');
  await tick();
}, 60000);

describe('vendor failover and delivery log', () => {
  it('WhatsApp outage: retried once, then sent by SMS fallback; recipients masked in the log', async () => {
    await call('POST', '/demo/outage', { channel: 'whatsapp', down: true });
    await call('POST', '/webhooks/whatsapp', { from: '+919000000035', messageId: 'f5-1', type: 'text', text: 'points' });
    const rows = await db.query<{ channel: string; status: string; recipient_masked: string; fallback_of: string | null }>(`select channel, status, recipient_masked, fallback_of from delivery_log order by id desc limit 3`);
    expect(rows.map(r => `${r.channel}:${r.status}`)).toEqual(['sms:fallback_sent', 'sms:sent', 'whatsapp:failed']);
    expect(rows[0]!.fallback_of).toBe('whatsapp');
    expect(JSON.stringify(rows)).not.toMatch(/\+91\d{10}/);
    expect(adapters.outbox.at(-1)!.channel).toBe('sms');
  });
  it('WhatsApp and SMS both down: logged as undelivered and the delivery check alerts on-call once', async () => {
    await call('POST', '/demo/outage', { channel: 'sms', down: true });
    await call('POST', '/webhooks/whatsapp', { from: '+919000000035', messageId: 'f5-2', type: 'text', text: 'points' });
    expect((await db.query(`select 1 from delivery_log where status='gave_up'`)).length).toBeGreaterThan(0);
    await call('POST', '/demo/outage', { channel: 'push', down: false });
    await tick(); await tick();
    const cases = await db.query<{ title: string }>(`select title from ops_cases where kind='monitoring' and title like 'Message delivery%'`);
    expect(cases.length).toBe(1);
    expect(adapters.outbox.some(o => o.to === 'oncall' && o.channel === 'push')).toBe(true);
    await call('POST', '/demo/outage', { channel: 'whatsapp', down: false }); await call('POST', '/demo/outage', { channel: 'sms', down: false });
  });
  it('OTP has no silent fallback: an SMS outage returns an error, not a fake success', async () => {
    await call('POST', '/demo/outage', { channel: 'sms', down: true });
    const r = await call('POST', '/auth/otp/request', { phone: '+919811000003' });
    expect(r.status).toBe(503); expect(r.body.error).toBe('sms_unavailable');
    await call('POST', '/demo/outage', { channel: 'sms', down: false });
  });
});

describe('service monitoring (§16 monitoring plan)', () => {
  it('readiness and the service view; checks cover the monitoring plan', async () => {
    expect((await call<{ ok: boolean }>('GET', '/ready')).body.ok).toBe(true);
    expect((await call('GET', '/admin/service', undefined, owner)).status).toBe(403);
    const s = await call<{ checks: Check[]; deliveries: unknown[]; vendors: { adapter: string }[] }>('GET', '/admin/service', undefined, ops);
    expect(s.status).toBe(200);
    expect(s.body.checks.map(c => c.key)).toEqual(expect.arrayContaining(['jobs_tick', 'alert_delay', 'delivery', 'webhooks', 'otp', 'api_latency', 'stuck_requests', 'open_s1', 'rights_age', 'llm', 'retention']));
    expect(s.body.vendors.every(v => v.adapter.startsWith('mock'))).toBe(true);
    expect(JSON.stringify(s.body.deliveries)).not.toMatch(/\+91\d{10}/);
  });
  it('an S1 emergency unacknowledged for 15 minutes opens one monitoring case', async () => {
    await db.query(`insert into incidents(id, household_id, severity, category, reporter, reported_at) values ('inc_mon','hh_demo','S1','injury','helper:m_sunita',$1)`, [new Date(clock.now().getTime() - 20 * 60000).toISOString()]);
    await tick(); await tick();
    expect((await db.query(`select 1 from ops_cases where kind='monitoring' and title like 'S1 emergencies%'`)).length).toBe(1);
    const chk = (await call<{ checks: Check[] }>('GET', '/admin/service', undefined, auditor)).body.checks.find(c => c.key === 'open_s1')!;
    expect(chk.status).toBe('alert');
  });
  it('escalation steps record how late the alert was queued', async () => {
    clock.set(at('13:40')); await tick();
    const d = await db.query<{ d: number }>(`select (detail->>'delaySec')::int as d from audit_log where action='escalation.step'`);
    expect(d.length).toBeGreaterThan(0); d.forEach(x => expect(x.d).toBeGreaterThanOrEqual(0));
  });
  it('route keys collapse ids; p95 works', () => {
    expect(routeKey('GET', '/v1/households/hh_demo/tasks/r1_2026-11-06')).toBe('GET /v1/households/:id/tasks/:id');
    expect(p95([1, 2, 3, 4, 100])).toBe(100); expect(p95([])).toBeNull();
  });
});

describe('retention (§9)', () => {
  it('runs once a day and clears only what the schedule says', async () => {
    const old = '2026-07-01T10:00:00+05:30';
    await db.query(`insert into friend_requests(id, household_id, state, parse, parser, doc, created_at, updated_at) values ('req_old','hh_demo','Completed','{"x":1}','rules','{"text":"feed Bruno","recipients":[]}',$1,$1)`, [old]);
    await db.query(`insert into checkin_signals(id, household_id, kind, channel, image_hash, evidence_ref, event_time, received_time, idempotency_key) values ('sig_old','hh_demo','photo','whatsapp','hash-old','media/old.jpg',$1,$1,'k-old'),('sig_new','hh_demo','photo','whatsapp','hash-new','media/new.jpg',$2,$2,'k-new')`, [old, at('09:00')]);
    await db.query(`insert into otp_challenges(id, phone_e164, code_hash, created_at, expires_at) values ('otp_old','+919800000099','x',$1,$1)`, [old]);
    clock.set(at('03:00', '2026-11-09')); await tick(); await tick();
    const req = (await db.query<{ parse: unknown; doc: Record<string, unknown> }>(`select parse, doc from friend_requests where id='req_old'`))[0]!;
    expect(req.parse).toBeNull(); expect(req.doc.text).toBeUndefined(); expect(req.doc.recipients).toEqual([]);
    const sig = await db.query<{ id: string; evidence_ref: string | null; image_hash: string }>(`select id, evidence_ref, image_hash from checkin_signals where id in ('sig_old','sig_new') order by id`);
    expect(sig.find(s => s.id === 'sig_new')!.evidence_ref).toBe('media/new.jpg');
    expect(sig.find(s => s.id === 'sig_old')!.evidence_ref).toBeNull();
    expect(sig.find(s => s.id === 'sig_old')!.image_hash).toBe('hash-old'); // hash kept so a reused photo is still caught
    expect((await db.query(`select 1 from otp_challenges where id='otp_old'`)).length).toBe(0);
    expect((await db.query(`select 1 from retention_runs where run_date='2026-11-09'`)).length).toBe(1);
  });
});

describe('encrypted backup and restore', () => {
  it('restores into a fresh database with identical row counts and an append-only audit log', async () => {
    const fp = await fingerprint(db);
    const b = await backup(db, KEY);
    expect(b.data.subarray(0, 5).toString()).toBe('PSBK1');
    const restored = await openDb({ dataDir: 'memory', loadFrom: unseal(b.data, KEY) });
    const v = await verifyRestore(fp, restored);
    expect(v.mismatches).toEqual([]); expect(v.appendOnly).toBe(true); expect(v.ok).toBe(true);
    await restored.close();
  }, 60000);
  it('a tampered file or the wrong key is refused', async () => {
    const b = await backup(db, KEY);
    const bad = Buffer.from(b.data); bad[bad.length - 1] ^= 1;
    expect(() => unseal(bad, KEY)).toThrow();
    expect(() => unseal(b.data, Buffer.alloc(32, 9))).toThrow();
  }, 60000);
});
