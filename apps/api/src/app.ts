/** Pawsure API (Hono). Authorisation is enforced here, per household, using the domain permission matrix. */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '@pawsure/db';
import { uid } from '@pawsure/db';
import { can, transition, severityOf, dueSteps, type Role, type Resource, type Action, type LifecycleState } from '@pawsure/domain';
import type { Adapters } from './adapters.js';
import { type Clock, istDate, minutesOnDay } from './clock.js';
import { audit, loadDay, ingestSignal } from './care.js';
import { registerDaily } from './daily.js';
import { makeFriendFinder, registerFriends } from './friends.js';
import { registerAdmin } from './admin.js';
import { withFailover } from './delivery.js';
import { createMonitor, serviceChecks, type Monitor } from './ops.js';

export interface Deps { db: Db; adapters: Adapters; clock: Clock; pepper: string; demoMode: boolean; monitor?: Monitor; limits?: { requestsPerHour?: number; invitesPerDay?: number } }
type Env = { Variables: { userId: string } };

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const E164_IN = /^\+91[6-9]\d{9}$/;

export function createApp(input: Deps) {
  // Every outbound message goes through retry + fallback and the delivery log (Phase 5).
  const d: Deps = { ...input, adapters: withFailover(input.adapters, input.db), monitor: input.monitor ?? createMonitor() };
  const mon = d.monitor!;
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { const t0 = performance.now(); await next(); mon.record(c.req.path, c.req.method, c.res.status, performance.now() - t0); });
  const { db } = d;
  const now = () => d.clock.now();

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: 'invalid_input', issues: err.issues.map(i => i.path.join('.') + ': ' + i.message) }, 400);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'otp_delivery_failed') return c.json({ error: 'sms_unavailable', message: 'We could not send the code. Please try again in a few minutes.' }, 503);
    if (/needs a reason|Cannot move|required/.test(msg)) return c.json({ error: 'invalid_transition', message: msg }, 409);
    console.error(err);
    return c.json({ error: 'server_error' }, 500);
  });

  /** Readiness: the database answers and migrations are applied. Used by the host's health check and uptime monitor. */
  app.get('/ready', async (c) => { try { const m = await db.query<{ n: number }>('select count(*)::int as n from schema_migrations'); return c.json({ ok: true, migrations: m[0]!.n }); } catch { return c.json({ ok: false }, 503); } });
  app.get('/health', (c) => c.json({ ok: true, db: db.kind, demoMode: d.demoMode, time: now().toISOString() }));

  /* ---------- Auth: OTP (PS-001). Same response whether or not the number exists (enumeration resistance). ---------- */
  app.post('/auth/otp/request', async (c) => {
    const { phone } = z.object({ phone: z.string().regex(E164_IN, 'Use an Indian mobile number in +91 format') }).parse(await c.req.json());
    const recent = await db.query<{ n: number }>(`select count(*)::int as n from otp_challenges where phone_e164=$1 and created_at > $2`, [phone, new Date(now().getTime() - 15 * 60000).toISOString()]);
    if ((recent[0]?.n ?? 0) >= 3) return c.json({ error: 'rate_limited', retryAfterSeconds: 900 }, 429);
    const last = await db.query<{ created_at: string }>(`select created_at from otp_challenges where phone_e164=$1 order by created_at desc limit 1`, [phone]);
    if (last[0] && now().getTime() - new Date(last[0].created_at).getTime() < 30000) return c.json({ error: 'too_soon', retryAfterSeconds: 30 }, 429);
    const code = String(randomInt(100000, 1000000));
    await db.query(`insert into otp_challenges(id, phone_e164, code_hash, created_at, expires_at) values ($1,$2,$3,$4,$5)`, [uid('otp'), phone, sha(d.pepper + phone + code), now().toISOString(), new Date(now().getTime() + 5 * 60000).toISOString()]);
    await d.adapters.sms.send(phone, code);
    return c.json({ sent: true, expiresInSeconds: 300, ...(d.demoMode ? { demoCode: code } : {}) });
  });

  app.post('/auth/otp/verify', async (c) => {
    const { phone, code } = z.object({ phone: z.string().regex(E164_IN), code: z.string().regex(/^\d{6}$/) }).parse(await c.req.json());
    const ch = (await db.query<{ id: string; code_hash: string; expires_at: string; attempts: number; consumed_at: string | null }>(`select * from otp_challenges where phone_e164=$1 order by created_at desc limit 1`, [phone]))[0];
    if (!ch || ch.consumed_at) return c.json({ error: 'invalid_code' }, 400);
    if (new Date(ch.expires_at) < now()) return c.json({ error: 'expired_code' }, 400);
    if (ch.attempts >= 5) return c.json({ error: 'too_many_attempts' }, 429);
    const ok = timingSafeEqual(Buffer.from(ch.code_hash), Buffer.from(sha(d.pepper + phone + code)));
    if (!ok) { await db.query('update otp_challenges set attempts=attempts+1 where id=$1', [ch.id]); return c.json({ error: 'invalid_code', attemptsLeft: Math.max(0, 4 - ch.attempts) }, 400); }
    await db.query('update otp_challenges set consumed_at=$2 where id=$1', [ch.id, now().toISOString()]);
    let user = (await db.query<{ id: string }>('select id from users where phone_e164=$1 and deleted_at is null', [phone]))[0];
    const isNew = !user;
    if (!user) { user = { id: uid('u') }; await db.query('insert into users(id, phone_e164) values ($1,$2)', [user.id, phone]); }
    const token = randomBytes(32).toString('base64url');
    await db.query('insert into sessions(token_hash, user_id, expires_at) values ($1,$2,$3)', [sha(token), user.id, new Date(now().getTime() + 30 * 86400000).toISOString()]);
    await audit(db, user.id, null, 'auth.signin', { isNew });
    return c.json({ token, userId: user.id, isNew });
  });

  /* ---------- Session + per-household authorisation ---------- */
  const requireSession = async (c: Context<Env>, next: () => Promise<void>) => {
    const h = c.req.header('authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const s = token ? (await db.query<{ user_id: string }>(`select user_id from sessions where token_hash=$1 and revoked_at is null and expires_at > $2`, [sha(token), now().toISOString()]))[0] : undefined;
    if (!s) return c.json({ error: 'unauthenticated' }, 401);
    c.set('userId', s.user_id);
    await next();
  };
  app.use('/v1/*', requireSession);
  app.use('/admin/*', requireSession);

  async function roleIn(c: Context<Env>, householdId: string): Promise<Role | null> {
    const r = await db.query<{ role: Role }>(`select role from memberships where household_id=$1 and user_id=$2 and status='active'`, [householdId, c.get('userId')]);
    const order: Role[] = ['owner', 'co_owner', 'backup', 'family', 'viewer', 'helper', 'friend'];
    return order.find(x => r.some(m => m.role === x)) ?? null;
  }
  async function guard(c: Context<Env>, householdId: string, resource: Resource, action: Action) {
    const role = await roleIn(c, householdId);
    if (!role || !can(role, resource, action, { sameHousehold: true })) {
      await audit(db, c.get('userId'), householdId, 'access.denied', { resource, action });
      return null;
    }
    return role;
  }
  const deny = (c: Context<Env>) => c.json({ error: 'forbidden' }, 403);
  const careDate = (c: Context<Env>) => c.req.query('date') ?? istDate(now());

  /* Session management (§9): sign out here, or everywhere (e.g. a lost phone). */
  app.post('/v1/auth/logout', async (c) => {
    const token = (c.req.header('authorization') ?? '').slice(7);
    await db.query('update sessions set revoked_at=$2 where token_hash=$1 and revoked_at is null', [sha(token), now().toISOString()]);
    await audit(db, c.get('userId'), null, 'auth.signout', {}); return c.json({ ok: true });
  });
  app.post('/v1/auth/logout-all', async (c) => {
    const r = await db.query('update sessions set revoked_at=$2 where user_id=$1 and revoked_at is null returning 1', [c.get('userId'), now().toISOString()]);
    await audit(db, c.get('userId'), null, 'auth.signout_all', { sessions: r.length }); return c.json({ ok: true, signedOut: r.length });
  });
  app.get('/v1/me', async (c) => {
    const u = (await db.query(`select id, display_name, language, phone_e164 from users where id=$1`, [c.get('userId')]))[0];
    const memberships = await db.query(`select m.household_id, m.role, h.society, h.tower from memberships m join households h on h.id=m.household_id where m.user_id=$1 and m.status='active'`, [c.get('userId')]);
    const consents = await db.query(`select kind, version, granted, recorded_at from consent_records where user_id=$1 order by recorded_at`, [c.get('userId')]);
    return c.json({ user: u, memberships, consents });
  });

  app.post('/v1/consents', async (c) => {
    const b = z.object({ items: z.array(z.object({ kind: z.string(), version: z.string(), granted: z.boolean() })), language: z.enum(['en', 'hi', 'mr']) }).parse(await c.req.json());
    if (!b.items.some(i => i.kind === 'terms' && i.granted) || !b.items.some(i => i.kind === 'privacy' && i.granted)) return c.json({ error: 'terms_and_privacy_required' }, 400);
    for (const i of b.items) await db.query(`insert into consent_records(id, user_id, kind, version, language, granted) values ($1,$2,$3,$4,$5,$6)`, [uid('cr'), c.get('userId'), i.kind, i.version, b.language, i.granted]);
    await audit(db, c.get('userId'), null, 'consent.recorded', b);
    return c.json({ ok: true });
  });

  app.post('/v1/households', async (c) => {
    const b = z.object({ displayName: z.string().min(1).max(80), language: z.enum(['en', 'hi', 'mr']), society: z.string().min(2).max(120), tower: z.string().max(40).optional(), flat: z.string().max(20).optional() }).parse(await c.req.json());
    const id = uid('hh');
    await db.tx(async (t) => {
      await t.query(`update users set display_name=$2, language=$3 where id=$1`, [c.get('userId'), b.displayName, b.language]);
      await t.query(`insert into households(id, society, tower, flat_private) values ($1,$2,$3,$4)`, [id, b.society, b.tower ?? null, b.flat ?? null]);
      await t.query(`insert into memberships(id, household_id, user_id, role, status, accepted_at) values ($1,$2,$3,'owner','active',now())`, [uid('m'), id, c.get('userId')]);
    });
    await audit(db, c.get('userId'), id, 'household.created', { society: b.society });
    return c.json({ id }, 201);
  });

  /* ---------- Pets (PS-003, PS-004) ---------- */
  const PetIn = z.object({ name: z.string().min(1).max(40), species: z.enum(['Dog', 'Cat', 'Other']).default('Dog'), breed: z.string().max(60).optional(), age: z.string().max(30).optional(), food: z.string().max(300).optional(), allergies: z.string().max(200).optional(), medicines: z.string().max(300).optional(), fears: z.string().max(300).optional(), notes: z.string().max(500).optional(), vet_name: z.string().max(120).optional(), vet_phone: z.string().max(30).optional(), clinic24_name: z.string().max(120).optional(), clinic24_phone: z.string().max(30).optional(), backup_name: z.string().max(80).optional(), backup_phone: z.string().max(30).optional() });
  app.get('/v1/households/:hh/pets', async (c) => {
    const hh = c.req.param('hh'); if (!(await guard(c, hh, 'pet', 'read'))) return deny(c);
    return c.json(await db.query('select * from pets where household_id=$1 order by name', [hh]));
  });
  app.post('/v1/households/:hh/pets', async (c) => {
    const hh = c.req.param('hh'); if (!(await guard(c, hh, 'pet', 'create'))) return deny(c);
    const p = PetIn.parse(await c.req.json()); const id = uid('pet');
    const cols = Object.keys(p);
    await db.query(`insert into pets(id, household_id, ${cols.join(',')}) values ($1,$2,${cols.map((_, i) => '$' + (i + 3)).join(',')})`, [id, hh, ...cols.map(k => (p as Record<string, unknown>)[k])]);
    await audit(db, c.get('userId'), hh, 'pet.created', { id });
    return c.json({ id }, 201);
  });
  app.patch('/v1/households/:hh/pets/:id', async (c) => {
    const hh = c.req.param('hh'); if (!(await guard(c, hh, 'pet', 'update'))) return deny(c);
    const p = PetIn.partial().parse(await c.req.json()); const cols = Object.keys(p);
    if (!cols.length) return c.json({ ok: true });
    const r = await db.query(`update pets set ${cols.map((k, i) => `${k}=$${i + 3}`).join(',')}, updated_at=now() where id=$1 and household_id=$2 returning id`, [c.req.param('id'), hh, ...cols.map(k => (p as Record<string, unknown>)[k])]);
    if (!r.length) return c.json({ error: 'not_found' }, 404);
    await audit(db, c.get('userId'), hh, 'pet.updated', { id: c.req.param('id'), fields: cols });
    return c.json({ ok: true });
  });

  /* ---------- Today: evaluated tasks, visits, escalation, covered day (PS-013–016, PS-030, PS-111, PS-122) ---------- */
  app.get('/v1/households/:hh/today', async (c) => {
    const hh = c.req.param('hh'); if (!(await guard(c, hh, 'timeline', 'read'))) return deny(c);
    return c.json(await loadDay(db, hh, careDate(c), now()));
  });
  app.post('/v1/households/:hh/tasks/:id/ack', async (c) => {
    const hh = c.req.param('hh'); if (!(await guard(c, hh, 'alert', 'acknowledge'))) return deny(c);
    const r = await db.query(`update care_tasks set ack_at=coalesce(ack_at,$3), ack_by=coalesce(ack_by,$4) where id=$1 and household_id=$2 returning id`, [c.req.param('id'), hh, now().toISOString(), c.get('userId')]);
    if (!r.length) return c.json({ error: 'not_found' }, 404);
    await audit(db, c.get('userId'), hh, 'alert.acknowledged', { task: c.req.param('id') });
    return c.json({ ok: true });
  });
  app.post('/v1/households/:hh/tasks/:id/resolve', async (c) => {
    const hh = c.req.param('hh'); if (!(await guard(c, hh, 'alert', 'acknowledge'))) return deny(c);
    const { note } = z.object({ note: z.string().trim().min(3, 'A short note is required') }).parse(await c.req.json());
    await db.query(`update care_tasks set ack_at=coalesce(ack_at,$3), ack_by=coalesce(ack_by,$4), resolved_at=$3, resolved_note=$5 where id=$1 and household_id=$2`, [c.req.param('id'), hh, now().toISOString(), c.get('userId'), note]);
    await audit(db, c.get('userId'), hh, 'alert.resolved', { task: c.req.param('id'), note });
    return c.json({ ok: true });
  });
  app.post('/v1/households/:hh/tasks/:id/lifecycle', async (c) => {
    const hh = c.req.param('hh'); if (!(await guard(c, hh, 'task', 'update'))) return deny(c);
    const b = z.object({ state: z.enum(['Cancelled by owner', 'Partly done', 'Skipped with reason', 'Reassigned']), note: z.string().optional() }).parse(await c.req.json());
    const day = await loadDay(db, hh, careDate(c), now());
    const t = day.tasks.find(x => x.id === c.req.param('id')); if (!t) return c.json({ error: 'not_found' }, 404);
    transition(t, b.state as LifecycleState, c.get('userId'), day.now, b.note); // validates; throws on illegal moves
    await db.query(`insert into task_events(task_id, household_id, state, actor, note) values ($1,$2,$3,$4,$5)`, [t.id, hh, b.state, c.get('userId'), b.note ?? null]);
    await audit(db, c.get('userId'), hh, 'task.lifecycle', { task: t.id, ...b });
    return c.json({ ok: true });
  });
  app.post('/v1/households/:hh/visits/:visitId/gate', async (c) => {
    const hh = c.req.param('hh'); if (!(await guard(c, hh, 'task', 'update'))) return deny(c);
    const r = await ingestSignal(db, { householdId: hh, idempotencyKey: `gate:${c.req.param('visitId')}:${now().getTime()}`, kind: 'gate', visitId: c.req.param('visitId'), channel: 'owner', ownerProvided: true, eventTime: now(), receivedTime: now(), actor: c.get('userId') });
    return c.json(r);
  });

  /* ---------- Incidents (PS-027, PS-036, PS-124) ---------- */
  app.post('/v1/households/:hh/incidents', async (c) => {
    const hh = c.req.param('hh'); if (!(await guard(c, hh, 'incident', 'create'))) return deny(c);
    const b = z.object({ category: z.string(), petId: z.string().optional(), note: z.string().max(1000).optional() }).parse(await c.req.json());
    const id = uid('inc'), sev = severityOf(b.category);
    await db.query(`insert into incidents(id, household_id, pet_id, severity, category, reporter, note, reported_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, hh, b.petId ?? null, sev, b.category, c.get('userId'), b.note ?? null, now().toISOString()]);
    if (sev === 'S1') await db.query(`insert into ops_cases(id, household_id, kind, title, severity) values ($1,$2,'emergency',$3,'S1')`, [uid('case'), hh, `${id} ${b.category}`]);
    await audit(db, c.get('userId'), hh, 'incident.reported', { id, severity: sev });
    return c.json({ id, severity: sev, plan: dueSteps({ id, severity: sev, category: b.category, reportedAt: 0 }, 1e9).map(s => ({ offsetMin: s.step.offset, to: s.step.to, channels: s.step.channels, purpose: s.step.purpose })) }, 201);
  });

  /* ---------- Demo controls (DEMO_MODE only) ---------- */
  if (d.demoMode) {
    app.get('/demo/outbox', (c) => c.json(d.adapters.outbox.slice(-50).reverse()));
    /** Drill: simulate a vendor outage on one channel. */
    app.post('/demo/outage', async (c) => {
      const b = z.object({ channel: z.enum(['sms', 'whatsapp', 'call', 'push']), down: z.boolean() }).parse(await c.req.json());
      if (b.down) d.adapters.outage.add(b.channel); else d.adapters.outage.delete(b.channel);
      return c.json({ down: [...d.adapters.outage] });
    });
    app.get('/demo/service', async (c) => c.json(await serviceChecks(db, mon, now(), true)));
    app.post('/demo/clock', async (c) => {
      const b = z.object({ set: z.string().optional(), advance: z.number().optional() }).parse(await c.req.json());
      const ck = d.clock as Clock & { set?: (s: string) => void; advance?: (m: number) => void };
      if (b.set && ck.set) ck.set(b.set); if (b.advance && ck.advance) ck.advance(b.advance);
      return c.json({ now: now().toISOString(), minute: minutesOnDay(now(), istDate(now())) });
    });
  }
  const ff = makeFriendFinder(d);
  const ctx = { d, guard, deny, careDate, ff, mon };
  registerDaily(app, ctx);
  registerFriends(app, ctx, ff);
  registerAdmin(app, d, mon);
  return app;
}
