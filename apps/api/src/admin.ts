/**
 * Phase 4 — operations console API (PS-070–072, PS-111, PS-117, PS-119, PS-120, PS-126, §13.2).
 * Staff sign in with OTP like everyone else; a staff_roles row grants a role. Every view is role-checked and audited.
 * No raw phone numbers, media or addresses in staff views; reporting cuts under 5 are suppressed; no helper ranking.
 */
import type { Hono, Context } from 'hono';
import { z } from 'zod';
import { uid, type Db } from '@pawsure/db';
import { assignArms, releaseCheck, can, safeCuts, maskPhone, decideHold, rightsDue, boardReportDue, wallet, streak, MIN_GROUP, type Role, type Resource, type Action, type LedgerEntry } from '@pawsure/domain';
import type { Deps } from './app.js';
import { istDate, minutesOnDay, atMinute } from './clock.js';
import { audit, loadDay } from './care.js';
import { serviceChecks, RETENTION, type Monitor } from './ops.js';

type Env = { Variables: { userId: string } };
const STAFF: Role[] = ['ops', 'ops_lead', 'privacy_lead', 'tech_lead', 'auditor'];

export function registerAdmin(app: Hono<Env>, d: Deps, mon: Monitor, cover?: import('./cover.js').CoverService) {
  const db = d.db; const now = () => d.clock.now(); const A = d.adapters;
  const staffRole = async (c: Context<Env>) => (await db.query<{ role: Role }>(`select role from staff_roles where user_id=$1 and active`, [c.get('userId')]))[0]?.role ?? null;
  async function gate(c: Context<Env>, resource: Resource, action: Action): Promise<Role | null> {
    const role = await staffRole(c);
    const ok = !!role && STAFF.includes(role) && can(role, resource, action, { sameHousehold: false });
    await audit(db, 'staff:' + c.get('userId'), null, ok ? 'admin.' + (action === 'read' ? 'view' : action) : 'admin.access.denied', { resource, role, path: c.req.path });
    return ok ? role : null;
  }
  const deny = (c: Context<Env>) => c.json({ error: 'forbidden', note: 'Your staff role can’t open this. The attempt was logged.' }, 403);
  const households = () => db.query<{ id: string; society: string; tower: string; cohort: string; rewards_arm: boolean; gate_app: boolean }>(`select id, society, tower, cohort, rewards_arm, gate_app from households order by id`);
  const pct = (a: number, b: number) => b ? Math.round((a / b) * 1000) / 10 : null;

  app.get('/admin/me', async (c) => { const role = await staffRole(c); return role ? c.json({ role }) : c.json({ error: 'not_staff' }, 403); });

  /* Overview: live pilot metrics against the PRD's proposed gates (targets, not proven benchmarks). */
  app.get('/admin/overview', async (c) => {
    if (!(await gate(c, 'metrics', 'read'))) return deny(c);
    const hhs = await households(), date = istDate(now());
    const days = await db.query<{ status: string }>(`select status from care_days where status <> 'Excluded'`);
    let tasks = 0, confLikely = 0;
    for (const h of hhs) { const day = await loadDay(db, h.id, date, now()); day.tasks.filter(t => t.ev.state !== 'Cancelled' && t.ev.state !== 'Pending' && t.ev.state !== 'Trusted').forEach(t => { tasks++; if (t.ev.state === 'Confirmed' || t.ev.state === 'Likely') confLikely++; }); }
    const reqs = await db.query<{ state: string; parser: string | null; corrected_fields: string[]; doc: { recipients: { state: string }[] } }>(`select state, parser, corrected_fields, doc from friend_requests`);
    const qualified = reqs.filter(r => r.doc.recipients.length > 0), fulfilled = qualified.filter(r => r.state === 'Completed');
    const recips = reqs.flatMap(r => r.doc.recipients), replied = recips.filter(x => !['sent', 'expired'].includes(x.state));
    const llm = reqs.filter(r => r.parser === 'llm'), corrected = llm.filter(r => r.corrected_fields.length > 0);
    const helpers = await db.query<{ id: string }>(`select id from memberships where role='helper'`);
    const consented = (await db.query<{ n: number }>(`select count(distinct m.id)::int as n from memberships m join consent_records c on c.user_id=m.user_id and c.household_id=m.household_id and c.kind='helper_monitoring' and c.granted where m.role='helper'`))[0]!.n;
    const m = (label: string, value: number | null, n: number, target: string, ok: (v: number) => boolean) => ({ label, value, n, target, status: value == null ? 'no data' : n < MIN_GROUP ? 'too few to judge' : ok(value) ? 'on track' : 'below' });
    return c.json({
      note: 'Live from this database. Gates are proposed targets, not proven benchmarks. Statuses need at least 5 cases.',
      households: hhs.length, staffedHours: '8 AM–10 PM IST, 7 days; automated alerts 24x7', noEmergencyPromise: 'Pawsure does not provide emergency or veterinary services and does not promise a response.',
      metrics: [
        m('Covered care days (pet-days closed)', pct(days.filter(x => x.status === 'Covered').length, days.length), days.length, '≥ 80%', v => v >= 80),
        m('Tasks Confirmed or Likely (today, due so far)', pct(confLikely, tasks), tasks, '≥ 60%', v => v >= 60),
        m('Helpers who consented', pct(consented, helpers.length), helpers.length, '≥ 70% within 7 days', v => v >= 70),
        m('Friend Finder fulfilment (qualified requests)', pct(fulfilled.length, qualified.length), qualified.length, '≥ 50%', v => v >= 50),
        m('Friend replies (any answer)', pct(replied.length, recips.length), recips.length, '≥ 50% within 15 min', v => v >= 50),
        m('AI critical-field correction rate', pct(corrected.length, llm.length), llm.length, '≤ 10% (above blocks rollout)', v => v <= 10)
      ]
    });
  });

  /* Service health (Phase 5 monitoring plan): checks, recent deliveries (masked), retention runs, vendor status. */
  app.get('/admin/service', async (c) => {
    if (!(await gate(c, 'metrics', 'read'))) return deny(c);
    return c.json({
      checks: await serviceChecks(db, mon, now(), d.demoMode),
      states: await db.query(`select key, status, since, case_id from service_checks`),
      deliveries: await db.query(`select at, channel, recipient_masked, template, status, attempt, error, latency_ms, fallback_of from delivery_log order by id desc limit 40`),
      retention: { policy: RETENTION, runs: await db.query(`select run_date::text, ran_at, counts from retention_runs order by run_date desc limit 7`) },
      vendors: [['SMS OTP', 'sms'], ['WhatsApp BSP', 'whatsapp'], ['Voice / IVR', 'call'], ['Push', 'push']].map(([name, ch]) => ({ name, adapter: 'mock (no contract yet)', simulatedOutage: d.adapters.outage.has(ch as 'sms') })),
      uptimeSec: Math.round((Date.now() - mon.started) / 1000)
    });
  });

  app.get('/admin/households', async (c) => {
    if (!(await gate(c, 'household', 'read'))) return deny(c);
    const out = [];
    for (const h of await households()) {
      const owner = (await db.query<{ phone_e164: string }>(`select u.phone_e164 from memberships m join users u on u.id=m.user_id where m.household_id=$1 and m.role='owner' limit 1`, [h.id]))[0];
      const helper = (await db.query<{ method: string | null }>(`select method from memberships where household_id=$1 and role='helper' and status='active' limit 1`, [h.id]))[0];
      const day = await loadDay(db, h.id, istDate(now()), now());
      out.push({ id: h.id, society: h.society.split(',')[0], cohort: h.cohort, rewardsArm: h.rewards_arm ? 'ON' : 'OFF', gateApp: h.gate_app, helperMethod: helper?.method ?? '—', today: day.covered.household, ownerPhone: owner ? maskPhone(owner.phone_e164) : '—' });
    }
    return c.json(out);
  });

  /* Queues: ops cases + open escalations + open incidents. Closing needs a reason; nothing is auto-decided about a person. */
  app.get('/admin/queues', async (c) => {
    if (!(await gate(c, 'ops_queue', 'read'))) return deny(c);
    const cases = await db.query(`select id, household_id, kind, title, severity, state, created_at, notes from ops_cases order by (state='open') desc, created_at desc limit 100`);
    const escalations: unknown[] = [];
    for (const h of await households()) { const day = await loadDay(db, h.id, istDate(now()), now()); day.tasks.filter(t => t.esc?.open && !t.esc.resolved).forEach(t => escalations.push({ household: h.id, task: t.title, state: t.ev.label, acknowledged: t.esc!.acknowledged, stepsSent: t.esc!.steps.filter(s => s.fired).length })); }
    const incidents = await db.query(`select id, household_id, severity, category, reported_at, ack_at from incidents where resolved_at is null order by reported_at`);
    return c.json({ cases, escalations, incidents, targets: { S1: 'watch within 15 min (staffed hours)', support: 'first reply within 2 h', abuse: 'act within 24 h', disputes: 'decide within 7 days' } });
  });
  app.post('/admin/cases/:id', async (c) => {
    const role = await gate(c, 'ops_queue', 'update'); if (!role) return deny(c);
    const b = z.object({ action: z.enum(['assign', 'note', 'close']), note: z.string().max(500).optional() }).parse(await c.req.json());
    if (b.action === 'close' && (b.note ?? '').trim().length < 5) return c.json({ error: 'reason_required' }, 400);
    const entry = `${now().toISOString()} ${role}: ${b.action}${b.note ? ' — ' + b.note : ''}`;
    const state = b.action === 'close' ? 'closed' : b.action === 'assign' ? 'assigned' : undefined;
    await db.query(`update ops_cases set notes = notes || $2::jsonb ${state ? `, state='${state}'` : ''} where id=$1`, [c.req.param('id'), JSON.stringify([entry])]);
    await audit(db, 'staff:' + c.get('userId'), null, 'ops.case.' + b.action, { case: c.req.param('id') });
    return c.json({ ok: true });
  });

  /* Method mix (PS-117): helper methods and Confirmed/Likely by cut, groups < 5 suppressed, no individual ranking. */
  app.get('/admin/method-mix', async (c) => {
    if (!(await gate(c, 'metrics', 'read'))) return deny(c);
    const helpers = await db.query<{ id: string; household_id: string; method: string | null; language: string; gate_app: boolean; consent: boolean | null }>(`select m.id, m.household_id, coalesce(m.method,'not chosen') as method, coalesce(m.invite_language, u.language) as language, h.gate_app,
      (select c.granted from consent_records c where c.user_id=m.user_id and c.household_id=m.household_id and c.kind in ('helper_monitoring','helper_withdrawal') order by c.recorded_at desc limit 1) as consent
      from memberships m join users u on u.id=m.user_id join households h on h.id=m.household_id where m.role='helper'`);
    const rows: { method: string; language: string; gate: string; ok: boolean }[] = [];
    for (const h of await households()) {
      const day = await loadDay(db, h.id, istDate(now()), now());
      for (const t of day.tasks) { const hp = helpers.find(x => x.id === t.assignee); if (!hp || ['Pending', 'Cancelled', 'Trusted'].includes(t.ev.state)) continue; rows.push({ method: hp.method ?? 'not chosen', language: hp.language, gate: hp.gate_app ? 'Gate app' : 'No gate app', ok: ['Confirmed', 'Likely'].includes(t.ev.state) }); }
    }
    const count = (k: 'method' | 'language') => safeCuts(helpers.map(h => ({ group: (h[k] as string) ?? '—', ok: true }))).map(x => ({ group: x.group, n: x.suppressed ? null : x.n, suppressed: x.suppressed }));
    return c.json({ minGroup: MIN_GROUP, helpersByMethod: count('method'), helpersByLanguage: count('language'), consentGiven: helpers.filter(h => h.consent).length, helpersInvited: helpers.length,
      confirmedLikelyBy: { method: safeCuts(rows.map(r => ({ group: r.method, ok: r.ok }))), language: safeCuts(rows.map(r => ({ group: r.language, ok: r.ok }))), gateApp: safeCuts(rows.map(r => ({ group: r.gate, ok: r.ok }))) },
      note: 'Cuts with fewer than 5 are suppressed. Helpers are never listed or ranked here.' });
  });

  app.get('/admin/signals', async (c) => {
    if (!(await gate(c, 'metrics', 'read'))) return deny(c);
    const dist: Record<string, number> = {};
    for (const h of await households()) (await loadDay(db, h.id, istDate(now()), now())).tasks.forEach(t => { dist[t.ev.state] = (dist[t.ev.state] ?? 0) + 1; });
    const events = await db.query(`select at, action, household_id, detail from audit_log where action like 'signal.%' or action like 'task.%' or action like 'alert.%' order by id desc limit 50`);
    return c.json({ ruleSet: 'confidence-v1', distribution: dist, events });
  });

  app.get('/admin/friend-finder', async (c) => {
    if (!(await gate(c, 'friend_request', 'read'))) return deny(c);
    const reqs = await db.query<{ id: string; state: string; parser: string | null; corrected_fields: string[]; updated_at: string; doc: { mode: string | null; recipients: { state: string }[] } }>(`select id, state, parser, corrected_fields, updated_at, doc from friend_requests order by updated_at desc`);
    const counts: Record<string, number> = {}; reqs.forEach(r => { counts[r.state] = (counts[r.state] ?? 0) + 1; });
    const stuck = reqs.filter(r => ['Sent', 'Provisional hold', 'Accepted - pending owner confirmation'].includes(r.state) && now().getTime() - new Date(r.updated_at).getTime() > 10 * 60000);
    const llmLog = await db.query(`select at, action, detail from audit_log where action like 'llm.%' or action like 'webhook%' or action like 'request.late%' order by id desc limit 30`);
    const llm = reqs.filter(r => r.parser === 'llm');
    return c.json({ aiConnected: d.adapters.llm.connected, counts, stuck: stuck.map(r => ({ id: r.id, state: r.state, minutes: Math.round((now().getTime() - new Date(r.updated_at).getTime()) / 60000) })), correctionRate: { corrected: llm.filter(r => r.corrected_fields.length).length, parsed: llm.length }, recent: reqs.slice(0, 20).map(r => ({ id: r.id, state: r.state, mode: r.doc.mode, parser: r.parser, corrected: r.corrected_fields, recipients: r.doc.recipients.map(x => x.state) })), llmLog });
  });

  /* Feature flags by cohort / household (PS-071). Locked switches can’t be changed here. */
  app.get('/admin/flags', async (c) => {
    if (!(await gate(c, 'feature_flag', 'read'))) return deny(c);
    return c.json({ flags: await db.query(`select key, default_value, locked, note from feature_flags order by key`), overrides: await db.query(`select household_id, key, value from household_flags`), rewardsArms: (await households()).map(h => ({ household: h.id, rewardsArm: h.rewards_arm })) });
  });
  app.put('/admin/flags', async (c) => {
    if (!(await gate(c, 'feature_flag', 'update'))) return deny(c);
    const b = z.object({ key: z.string(), value: z.union([z.boolean(), z.string()]), householdId: z.string().optional() }).parse(await c.req.json());
    const f = (await db.query<{ locked: boolean }>(`select locked from feature_flags where key=$1`, [b.key]))[0];
    if (!f) return c.json({ error: 'unknown_flag' }, 404);
    if (f.locked) return c.json({ error: 'locked', note: 'This switch needs an approval outside the console (for example, ID checks for nearby members).' }, 409);
    if (b.key === 'helperRewards' && b.householdId) await db.query(`update households set rewards_arm=$2 where id=$1`, [b.householdId, b.value === true]);
    else if (b.householdId) await db.query(`insert into household_flags(household_id, key, value) values ($1,$2,$3) on conflict (household_id, key) do update set value=$3`, [b.householdId, b.key, JSON.stringify(b.value)]);
    else { await db.query(`update feature_flags set default_value=$2 where key=$1`, [b.key, JSON.stringify(b.value)]); if (b.key === 'helperRewards' && b.value === false) await db.query(`update households set rewards_arm=false`); }
    await audit(db, 'staff:' + c.get('userId'), b.householdId ?? null, 'flag.changed', b);
    return c.json({ ok: true });
  });

  /* Pilot readiness (§4.2, §18): switch check and the 10-of-20 rewards arm assignment, reproducible from a seed. */
  const releaseItems = async () => {
    const flags = Object.fromEntries((await db.query<{ key: string; default_value: unknown; locked: boolean }>(`select key, default_value, locked from feature_flags`)).map(f => [f.key, { value: f.default_value, locked: f.locked }]));
    const hh = await households();
    return releaseCheck(flags, hh.map(h => h.rewards_arm));
  };
  app.get('/admin/release-check', async (c) => {
    if (!(await gate(c, 'feature_flag', 'read'))) return deny(c);
    const items = await releaseItems();
    const lastAssign = (await db.query(`select at, detail from audit_log where action='cohort.assigned' order by id desc limit 1`))[0] ?? null;
    return c.json({ ready: items.every(i => i.ok), items, lastAssignment: lastAssign, households: (await households()).length, note: 'Release also needs the non-software gates in §14 and §18 (legal review, helper tests, ops rota). This check covers the switches only.' });
  });
  app.post('/admin/cohort/assign', async (c) => {
    if (!(await gate(c, 'feature_flag', 'update'))) return deny(c);
    const b = z.object({ cohort: z.string().default('pilot-1'), seed: z.number().int().optional(), confirm: z.literal(true) }).parse(await c.req.json());
    const homes = (await households()).filter(h => h.cohort === b.cohort);
    if (homes.length < 2) return c.json({ error: 'too_few_households', homes: homes.length }, 400);
    const seed = b.seed ?? Math.floor(Math.random() * 2 ** 31);
    const arms = assignArms(homes.map(h => ({ id: h.id, stratum: h.gate_app ? 'gate app' : 'no gate app' })), seed);
    for (const [id, on] of Object.entries(arms)) await db.query(`update households set rewards_arm=$2 where id=$1`, [id, on]);
    await audit(db, 'staff:' + c.get('userId'), null, 'cohort.assigned', { cohort: b.cohort, seed, on: Object.values(arms).filter(Boolean).length, of: homes.length });
    return c.json({ seed, arms, on: Object.values(arms).filter(Boolean).length, of: homes.length });
  });

  /* Rewards: holds are decided by a person within 7 days, with a reason the helper can read (PS-044, PS-126). */
  app.get('/admin/rewards', async (c) => {
    if (!(await gate(c, 'wallet', 'read'))) return deny(c);
    const held = await db.query<{ id: string; household_id: string; task_id: string; points: number; reason: string; created_at: string; expires_at: string }>(`select id, household_id, task_id, points, reason, created_at, expires_at from reward_ledger where state='held' order by created_at`);
    const totals = await db.query(`select state, sum(points)::int as points, count(*)::int as entries from reward_ledger group by state`);
    return c.json({ policy: { perTask: 5, monthlyCapPerHelperPerHousehold: 125, rupeesCap: 5, couponPoints: 500, couponRupees: 20, expiryMonths: 6, holdDays: 7, cash: 'never' }, held: held.map(h => ({ ...h, decideBy: h.expires_at })), totals, experiment: 'ON for 10 of 20 homes; keep only if on-time check-ins improve by ≥ 10 points' });
  });
  app.post('/admin/rewards/:id/decide', async (c) => {
    if (!(await gate(c, 'wallet', 'approve'))) return deny(c);
    const b = z.object({ decision: z.enum(['release', 'reverse']), note: z.string() }).parse(await c.req.json());
    let state; try { state = decideHold(b.decision, b.note); } catch (e) { return c.json({ error: 'reason_required', message: (e as Error).message }, 400); }
    const r = await db.query<{ helper_user_id: string }>(`update reward_ledger set state=$2, decided_at=$3, decided_by=$4, decision_note=$5 where id=$1 and state='held' returning helper_user_id`, [c.req.param('id'), state, now().toISOString(), c.get('userId'), b.note]);
    if (!r.length) return c.json({ error: 'not_found' }, 404);
    const u = (await db.query<{ phone_e164: string; language: string }>(`select phone_e164, language from users where id=$1`, [r[0]!.helper_user_id]))[0]!;
    await A.whatsapp.sendTemplate(u.phone_e164, 'W_HOLD_DECIDED', (u.language ?? 'en') as 'en', { decision: b.decision, reason: b.note });
    await audit(db, 'staff:' + c.get('userId'), null, 'reward.' + state, { entry: c.req.param('id'), note: b.note });
    return c.json({ ok: true, state });
  });

  app.get('/admin/audit', async (c) => {
    const role = await gate(c, 'audit_log', 'read'); if (!role) return deny(c);
    const action = c.req.query('action'), hh = c.req.query('household');
    const rows = await db.query(`select id, at, actor, household_id, action, detail from audit_log where ($1::text is null or action like $1 || '%') and ($2::text is null or household_id=$2) order by id desc limit 200`, [action ?? null, hh ?? null]);
    return c.json({ appendOnly: true, rows });
  });

  /* Rights and grievance (PS-119): target 7 days, legal limit 90; withdrawal stops future processing. */
  app.get('/admin/rights', async (c) => {
    if (!(await gate(c, 'rights_request', 'read'))) return deny(c);
    const rows = await db.query<{ id: string; user_id: string; kind: string; channel: string; state: string; due_at: string; legal_due_at: string; created_at: string; detail: string | null; reply: string | null }>(`select * from rights_requests order by created_at desc`);
    const phones = Object.fromEntries((await db.query<{ id: string; phone_e164: string }>(`select id, phone_e164 from users`)).map(u => [u.id, maskPhone(u.phone_e164)]));
    return c.json(rows.map(r => ({ ...r, user: phones[r.user_id], overdue: r.state !== 'closed' && new Date(r.due_at) < now() })));
  });
  app.put('/admin/rights/:id', async (c) => {
    if (!(await gate(c, 'rights_request', 'update'))) return deny(c);
    const b = z.object({ state: z.enum(['in_review', 'closed']), reply: z.string().max(2000).optional() }).parse(await c.req.json());
    if (b.state === 'closed' && (b.reply ?? '').trim().length < 5) return c.json({ error: 'reply_required' }, 400);
    await db.query(`update rights_requests set state=$2, reply=coalesce($3, reply), handled_by=$4, closed_at=case when $2='closed' then now() else closed_at end where id=$1`, [c.req.param('id'), b.state, b.reply ?? null, c.get('userId')]);
    await audit(db, 'staff:' + c.get('userId'), null, 'rights.' + b.state, { id: c.req.param('id') });
    return c.json({ ok: true });
  });

  /* Breach runbook (PS-120): readiness checklist, rehearsal / incident with the 72 h Board clock. */
  app.get('/admin/breach', async (c) => {
    if (!(await gate(c, 'breach', 'read'))) return deny(c);
    return c.json({ checklist: await db.query(`select item, done, done_at from breach_checklist order by item`), events: (await db.query<{ board_due_at: string }>(`select * from breach_events order by aware_at desc`)).map(e => ({ ...e, hours_left: Math.round((new Date(e.board_due_at).getTime() - now().getTime()) / 3600000) })), rule: 'Notify affected people without delay; Data Protection Board report within 72 h of becoming aware (once the DPDP Rules provision is in force).' });
  });
  app.put('/admin/breach/checklist', async (c) => {
    if (!(await gate(c, 'breach', 'update'))) return deny(c);
    const b = z.object({ item: z.string(), done: z.boolean() }).parse(await c.req.json());
    await db.query(`update breach_checklist set done=$2, done_by=$3, done_at=case when $2 then now() else null end where item=$1`, [b.item, b.done, c.get('userId')]);
    await audit(db, 'staff:' + c.get('userId'), null, 'breach.checklist', b); return c.json({ ok: true });
  });
  app.post('/admin/breach/events', async (c) => {
    if (!(await gate(c, 'breach', 'create'))) return deny(c);
    const b = z.object({ kind: z.enum(['rehearsal', 'incident']), summary: z.string().max(1000).optional() }).parse(await c.req.json());
    const aware = now().toISOString(), id = uid('br');
    await db.query(`insert into breach_events(id, kind, aware_at, board_due_at, summary) values ($1,$2,$3,$4,$5)`, [id, b.kind, aware, boardReportDue(aware), b.summary ?? null]);
    await audit(db, 'staff:' + c.get('userId'), null, 'breach.' + b.kind + '.started', { id });
    return c.json({ id, boardDueAt: boardReportDue(aware) }, 201);
  });
  app.put('/admin/breach/events/:id', async (c) => {
    if (!(await gate(c, 'breach', 'update'))) return deny(c);
    const b = z.object({ step: z.enum(['users_notified', 'board_reported', 'closed']) }).parse(await c.req.json());
    await db.query(`update breach_events set ${b.step}_at=$2 where id=$1`, [c.req.param('id'), now().toISOString()]);
    await audit(db, 'staff:' + c.get('userId'), null, 'breach.' + b.step, { id: c.req.param('id') }); return c.json({ ok: true });
  });

  /* ---------- Owner side: data rights, export, wallet (PS-119, PS-042) ---------- */
  app.get('/v1/me/rights', async (c) => c.json(await db.query(`select id, kind, channel, state, due_at, legal_due_at, created_at, reply from rights_requests where user_id=$1 order by created_at desc`, [c.get('userId')])));
  app.post('/v1/me/rights', async (c) => {
    const b = z.object({ kind: z.enum(['access', 'correction', 'withdrawal', 'erasure', 'grievance']), detail: z.string().max(1000).optional() }).parse(await c.req.json());
    const id = 'DR-' + uid('x').slice(2, 8).toUpperCase(), due = rightsDue(now().toISOString());
    await db.query(`insert into rights_requests(id, user_id, kind, channel, due_at, legal_due_at, detail) values ($1,$2,$3,'app',$4,$5,$6)`, [id, c.get('userId'), b.kind, due.target, due.legalLimit, b.detail ?? null]);
    await db.query(`insert into ops_cases(id, kind, title) values ($1,'rights',$2)`, [uid('case'), `${id} ${b.kind} request`]);
    if (b.kind === 'withdrawal') await db.query(`insert into consent_records(id, user_id, kind, version, language, granted) values ($1,$2,'optional_processing','C-1.0','en',false)`, [uid('cr'), c.get('userId')]);
    await audit(db, c.get('userId'), null, 'rights.request', { id, kind: b.kind });
    return c.json({ id, dueAt: due.target, legalLimit: due.legalLimit, note: b.kind === 'erasure' ? 'Records other people rely on, such as an incident log, are kept only as long as the law requires.' : undefined }, 201);
  });
  /** Access request preview: what Pawsure holds about you (no other person’s data). */
  app.get('/v1/me/export', async (c) => {
    const uidv = c.get('userId');
    const data = {
      generatedAt: now().toISOString(),
      profile: (await db.query(`select display_name, phone_e164, language, created_at from users where id=$1`, [uidv]))[0],
      memberships: await db.query(`select household_id, role, status, invited_at, accepted_at from memberships where user_id=$1`, [uidv]),
      consents: await db.query(`select kind, version, language, granted, recorded_at from consent_records where user_id=$1 order by recorded_at`, [uidv]),
      pets: await db.query(`select p.name, p.species, p.breed, p.allergies, p.medicines, p.updated_at from pets p join memberships m on m.household_id=p.household_id where m.user_id=$1 and m.role in ('owner','co_owner')`, [uidv]),
      friendProfile: (await db.query(`select discoverable, paused, windows, capabilities, key_mode, live_location_allowed, nearby_opt_in, updated_at from friend_profiles where user_id=$1`, [uidv]))[0] ?? null,
      rewardLedger: await db.query(`select household_id, points, state, reason, month, expires_at from reward_ledger where helper_user_id=$1`, [uidv]),
      rightsRequests: await db.query(`select id, kind, state, created_at from rights_requests where user_id=$1`, [uidv])
    };
    await audit(db, uidv, null, 'rights.export', {});
    return c.json(data);
  });
  app.get('/v1/households/:hh/wallet', async (c) => {
    const role = (await db.query<{ role: string }>(`select role from memberships where household_id=$1 and user_id=$2 and status='active'`, [c.req.param('hh'), c.get('userId')]))[0]?.role;
    if (!role || !['owner', 'co_owner'].includes(role)) return c.json({ error: 'forbidden' }, 403);
    const hh = c.req.param('hh'), date = istDate(now());
    const arm = (await db.query<{ rewards_arm: boolean }>(`select rewards_arm from households where id=$1`, [hh]))[0]?.rewards_arm;
    const helpers = await db.query<{ user_id: string; name: string }>(`select m.user_id, coalesce(m.display_label, u.display_name) as name from memberships m join users u on u.id=m.user_id where m.household_id=$1 and m.role='helper'`, [hh]);
    const out = [];
    for (const h of helpers) {
      // Only this household’s entries — another household’s points are never shown to this owner (PS-029).
      const rows = await db.query<{ points: number; state: string; month: string; created_at: string; expires_at: string | null; reason: string; decision_note: string | null }>(`select points, state, month, created_at, expires_at, reason, decision_note from reward_ledger where helper_user_id=$1 and household_id=$2 order by created_at desc`, [h.user_id, hh]);
      const w = wallet(rows.map(r => ({ points: r.points, state: r.state as LedgerEntry['state'], month: r.month, createdAt: r.created_at, expiresAt: r.expires_at, householdId: hh })), date);
      out.push({ name: h.name, thisMonth: w.earnedThisMonthByHousehold[hh] ?? 0, cap: 125, held: w.held, history: rows.slice(0, 10) });
    }
    return c.json({ rewardsArm: !!arm, helpers: out, policy: '5 points per Confirmed or Likely task · up to 125 per month from your home (₹5) · 500 points = ₹20 coupon · no cash · expire after 6 months', friendThankYouPoints: 'Switched off until funding is approved' });
  });

  /* Helper-owned shareable record (PS-104): counts only, no household names, addresses, pets or disputes. */
  app.get('/r/:token', async (c) => {
    const { createHash } = await import('node:crypto');
    const link = (await db.query<{ helper_user_id: string; revoked_at: string | null }>(`select helper_user_id, revoked_at from share_links where token_hash=$1`, [createHash('sha256').update(c.req.param('token')).digest('hex')]))[0];
    if (!link || link.revoked_at) return c.json({ error: 'not_available' }, 410);
    const flag = (await db.query<{ default_value: unknown }>(`select default_value from feature_flags where key='helperShareRecord'`))[0]?.default_value;
    if (flag !== true) return c.json({ error: 'not_available' }, 410);
    const verified = (await db.query<{ n: number }>(`select count(*)::int as n from reward_ledger where helper_user_id=$1 and state in ('earned','released')`, [link.helper_user_id]))[0]!.n;
    const days = (await db.query<{ d: string }>(`select distinct to_char(created_at,'YYYY-MM-DD') as d from reward_ledger where helper_user_id=$1 and state in ('earned','released')`, [link.helper_user_id])).map(r => r.d);
    const since = (await db.query<{ m: string }>(`select min(month) as m from reward_ledger where helper_user_id=$1`, [link.helper_user_id]))[0]?.m;
    return c.json({ verifiedVisitRecords: verified, streakDays: streak(days, istDate(now())), activeSince: since, note: 'Counts only. No household names, addresses, pets, or anything under review.' });
  });

  /* ================= v1.1.0 cover continuity (PS-135, PRD 16.3, PS-118) ================= */
  app.get('/admin/cover-metrics', async (c) => {
    if (!(await gate(c, 'metrics', 'read')) || !cover) return deny(c);
    return c.json({ pilot: await cover.metrics(), reviewLine: 0.10, note: 'Cover-not-found above 10% of at-risk tasks: review that cluster (PRD 16.3).' });
  });
  app.get('/admin/templates', async (c) => {
    if (!(await gate(c, 'metrics', 'read'))) return deny(c);
    const { templateCatalogue } = await import('./coverTemplates.js');
    return c.json(templateCatalogue());
  });
  app.get('/admin/advisories', async (c) => {
    if (!(await gate(c, 'cluster_advisory', 'read'))) return deny(c);
    const clusters = (await db.query<{ cluster: string | null; n: number }>(`select cluster, count(*)::int as n from households group by cluster order by cluster`)).filter(r => r.cluster);
    return c.json({ clusters, sent: await db.query(`select id, cluster, reason, body, sent_by, sent_at, remind_at, for_date::text as for_date from cluster_advisory order by sent_at desc limit 20`) });
  });
  /** Evening-before advisory: owners are told, and tomorrow's reminders go out that evening (PS-135, PS-127). */
  app.post('/admin/advisories', async (c) => {
    const role = await gate(c, 'cluster_advisory', 'create'); if (!role) return deny(c);
    const b = z.object({ cluster: z.string().min(1).max(80), reason: z.enum(['red rain alert', 'strike', 'festival day', 'other']), note: z.string().max(120).optional() }).parse(await c.req.json());
    const { renderCover } = await import('./coverTemplates.js');
    const nowD = now(), date = istDate(nowD), minute = minutesOnDay(nowD, date), at = minute >= 1080 ? nowD : atMinute(date, 1080);
    const forDate = istDate(new Date(Date.parse(date + 'T12:00:00+05:30') + 86400000));
    const reason = b.reason === 'other' ? (b.note || 'local disruption') : b.reason, id = uid('adv');
    await db.query(`insert into cluster_advisory(id, cluster, reason, body, sent_by, sent_at, remind_at, for_date) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, b.cluster, reason, renderCover('cluster_advisory', 'en', { reason }), 'staff:' + c.get('userId'), nowD.toISOString(), at.toISOString(), forDate]);
    await audit(db, 'staff:' + c.get('userId'), null, 'advisory.sent', { id, cluster: b.cluster, reason, role, remindAt: at.toISOString() });
    return c.json({ id, remindAt: at.toISOString(), forDate, households: (await db.query(`select id from households where cluster=$1 or $1='All clusters'`, [b.cluster])).length }, 201);
  });
}
