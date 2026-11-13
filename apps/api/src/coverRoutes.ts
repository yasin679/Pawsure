/** v1.1.0 cover continuity endpoints (PRD v1.4, PS-127 to PS-141). Authorisation per household via the permission matrix. */
import type { Hono, Context } from 'hono';
import { z } from 'zod';
import { uid } from '@pawsure/db';
import { COVER_V1 } from '@pawsure/domain';
import type { Ctx } from './daily.js';
import type { CoverService } from './cover.js';
import { audit } from './care.js';
import { istDate } from './clock.js';

type Env = { Variables: { userId: string } };
const PHONE = z.string().regex(/^\+91[6-9]\d{9}$/, 'Use an Indian mobile number in +91 format');

export function registerCover(app: Hono<Env>, x: Ctx, cover: CoverService) {
  const { db } = x.d; const now = () => x.d.clock.now();
  const H = (c: Context<Env>) => c.req.param('hh')!;
  const send = (c: Context<Env>, r: { status: number; body: unknown }) => c.json(r.body as object, r.status as 200);

  /* ---------- Cover status for Today (lines, jobs, substitutes, checklists, pre-departure) ---------- */
  app.get('/v1/households/:hh/cover', async (c) => {
    if (!(await x.guard(c, H(c), 'timeline', 'read'))) return x.deny(c);
    return c.json(await cover.overview(H(c), x.careDate(c)));
  });
  app.get('/v1/households/:hh/cover/jobs/:id', async (c) => {
    if (!(await x.guard(c, H(c), 'timeline', 'read'))) return x.deny(c);
    const j = await cover.getJob(c.req.param('id'), H(c)); if (!j) return c.json({ error: 'not_found' }, 404);
    return c.json(await cover.jobView(j));
  });
  const jobAction = (action: 'start' | 'confirm' | 'stop' | 'handle' | 'circle' | 'skip' | 'move' | 'someone', schema: z.ZodTypeAny) => async (c: Context<Env>) => {
    if (!(await x.guard(c, H(c), 'cover', 'update'))) return x.deny(c);
    const b = schema.parse(await c.req.json().catch(() => ({}))) as { personId?: string; time?: number; name?: string; phone?: string };
    return send(c, await cover.ownerAction(H(c), c.req.param('id')!, action, b, c.get('userId')));
  };
  app.post('/v1/households/:hh/cover/jobs/:id/start', jobAction('start', z.object({})));
  app.post('/v1/households/:hh/cover/jobs/:id/confirm', jobAction('confirm', z.object({ personId: z.string() })));
  app.post('/v1/households/:hh/cover/jobs/:id/stop', jobAction('stop', z.object({})));
  app.post('/v1/households/:hh/cover/jobs/:id/handle', jobAction('handle', z.object({})));
  app.post('/v1/households/:hh/cover/jobs/:id/circle', jobAction('circle', z.object({})));
  app.post('/v1/households/:hh/cover/jobs/:id/skip', jobAction('skip', z.object({})));
  app.post('/v1/households/:hh/cover/jobs/:id/move', jobAction('move', z.object({ time: z.number().int().min(0).max(2879) })));
  app.post('/v1/households/:hh/cover/jobs/:id/ask-someone', jobAction('someone', z.object({ name: z.string().trim().min(1).max(60), phone: PHONE })));
  app.post('/v1/households/:hh/cover/jobs/:id/friend-finder', async (c) => {
    if (!(await x.guard(c, H(c), 'friend_request', 'create'))) return x.deny(c);
    return send(c, await cover.friendFinderFor(H(c), c.req.param('id'), c.get('userId')));
  });
  app.post('/v1/households/:hh/cover/substitutes/:id/:decision{approve|decline}', async (c) => {
    if (!(await x.guard(c, H(c), 'cover', 'update'))) return x.deny(c);
    const r = await cover.decideSubstitute(H(c), c.req.param('id'), c.req.param('decision') === 'approve', c.get('userId'));
    return 'error' in r ? c.json(r, 409) : c.json(r);
  });
  app.post('/v1/households/:hh/cover/checklists/:taskId', async (c) => {
    if (!(await x.guard(c, H(c), 'cover', 'update'))) return x.deny(c);
    const b = z.object({ gateApproved: z.boolean().optional(), keyPlan: z.enum(['helper', 'named_person', 'lockbox', 'owner_returns']).optional(), keyNote: z.string().max(120).optional() }).parse(await c.req.json());
    const r = await cover.tickChecklist(H(c), c.req.param('taskId'), b, c.get('userId'));
    return 'error' in r ? c.json(r, 404) : c.json(r);
  });
  /** Co-owners answer their reminder in the app (PS-139: same confirmation as a helper). */
  app.post('/v1/households/:hh/cover/reminders/:id/reply', async (c) => {
    if (!(await x.guard(c, H(c), 'cover', 'update'))) return x.deny(c);
    const { reply } = z.object({ reply: z.enum(['yes', 'cant']) }).parse(await c.req.json());
    const r = (await db.query<{ recipient_kind: string; recipient_id: string }>(`select recipient_kind, recipient_id from reminder where id=$1 and household_id=$2`, [c.req.param('id'), H(c)]))[0];
    if (!r) return c.json({ error: 'not_found' }, 404);
    const mine = (await db.query(`select 1 from memberships where id=$1 and user_id=$2`, [r.recipient_id, c.get('userId')])).length;
    if (r.recipient_kind !== 'co_owner' || !mine) return c.json({ error: 'forbidden' }, 403);
    return c.json(await cover.reminderReply(c.req.param('id'), reply, 'app'));
  });

  /* ---------- PS-134 pre-departure check, plan B, leave anyway ---------- */
  app.get('/v1/households/:hh/day/pre-departure', async (c) => {
    if (!(await x.guard(c, H(c), 'task', 'read'))) return x.deny(c);
    return c.json(await cover.preDeparture(H(c), x.careDate(c)));
  });
  app.post('/v1/households/:hh/day/pre-departure', async (c) => {
    if (!(await x.guard(c, H(c), 'task', 'update'))) return x.deny(c);
    const b = z.object({ option: z.enum(['do_it_before_leaving', 'leave_later', 'take_the_pet', 'own_paid_provider', 'ask_circle_now', 'leave_anyway']), petId: z.string().optional() }).parse(await c.req.json());
    const r = await cover.preDepartureOption(H(c), x.careDate(c), b.option, c.get('userId'), b);
    return 'error' in r ? c.json(r, 409) : c.json(r);
  });

  /* ---------- PS-136 I'm delayed ---------- */
  app.post('/v1/households/:hh/day/delay', async (c) => {
    if (!(await x.guard(c, H(c), 'task', 'update'))) return x.deny(c);
    const { returnAt } = z.object({ returnAt: z.number().int().min(0).max(1439) }).parse(await c.req.json());
    try { return c.json(await cover.delay(H(c), x.careDate(c), returnAt, c.get('userId')), 201); }
    catch (e) { return c.json({ error: 'invalid_time', message: (e as Error).message }, 400); }
  });
  app.post('/v1/households/:hh/day/delay/:id/ask', async (c) => {
    if (!(await x.guard(c, H(c), 'task', 'update'))) return x.deny(c);
    const r = await cover.askExtension(H(c), c.req.param('id'), c.get('userId'));
    return 'error' in r ? c.json(r, 409) : c.json(r);
  });

  /* ---------- PS-130 backups and settings ---------- */
  const BackupIn = z.object({ name: z.string().trim().min(1).max(60), phone: PHONE, language: z.enum(['en', 'hi', 'mr']).default('en'), relationship: z.string().trim().min(1).max(60), holdsKey: z.boolean().default(false), canGiveMedicine: z.boolean().default(false), ownerArranged: z.boolean().default(false) });
  app.get('/v1/households/:hh/backups', async (c) => {
    if (!(await x.guard(c, H(c), 'backup_list', 'read'))) return x.deny(c);
    const rows = await cover.backups(H(c)), h = await cover.household(H(c));
    return c.json({ backups: rows.map(b => ({ id: b.id, rank: b.rank, name: b.name, phone: b.phone_e164.replace(/^(\+91)(\d{2})\d{6}(\d{2})$/, '$1 $2•••• ••$3'), language: b.language, relationship: b.relationship, holdsKey: b.holds_key, canGiveMedicine: b.can_give_medicine, ownerArranged: b.owner_arranged, caredBefore: b.cared_before })), standingApproval: h.standing_backup_approval, remindTrusted: h.remind_trusted, hotDay: h.hot_day, max: COVER_V1.maxBackups });
  });
  app.post('/v1/households/:hh/backups', async (c) => {
    if (!(await x.guard(c, H(c), 'backup_list', 'create'))) return x.deny(c);
    const b = BackupIn.parse(await c.req.json()), n = (await cover.backups(H(c))).length;
    if (n >= COVER_V1.maxBackups) return c.json({ error: 'max_backups', note: 'Up to 5 backups. Remove someone first.' }, 409);
    const id = uid('bk'), user = (await db.query<{ id: string }>(`select id from users where phone_e164=$1`, [b.phone]))[0]?.id ?? null;
    await db.query(`insert into backup_contact(id, household_id, user_id, name, phone_e164, language, rank, relationship, holds_key, can_give_medicine, owner_arranged) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, H(c), user, b.name, b.phone, b.language, n + 1, b.relationship, b.holdsKey, b.canGiveMedicine, b.ownerArranged]);
    await audit(db, c.get('userId'), H(c), 'backups.added', { id, rank: n + 1, ownerArranged: b.ownerArranged });
    return c.json({ id }, 201);
  });
  app.patch('/v1/households/:hh/backups/:id', async (c) => {
    if (!(await x.guard(c, H(c), 'backup_list', 'update'))) return x.deny(c);
    const b = BackupIn.partial().parse(await c.req.json());
    const map: Record<string, string> = { name: 'name', phone: 'phone_e164', language: 'language', relationship: 'relationship', holdsKey: 'holds_key', canGiveMedicine: 'can_give_medicine', ownerArranged: 'owner_arranged' };
    const keys = Object.keys(b).filter(k => map[k]); if (!keys.length) return c.json({ ok: true });
    const r = await db.query(`update backup_contact set ${keys.map((k, i) => `${map[k]}=$${i + 3}`).join(',')} where id=$1 and household_id=$2 and removed_at is null returning id`, [c.req.param('id'), H(c), ...keys.map(k => (b as Record<string, unknown>)[k])]);
    if (!r.length) return c.json({ error: 'not_found' }, 404);
    await audit(db, c.get('userId'), H(c), 'backups.updated', { id: c.req.param('id'), fields: keys });
    return c.json({ ok: true });
  });
  app.delete('/v1/households/:hh/backups/:id', async (c) => {
    if (!(await x.guard(c, H(c), 'backup_list', 'delete'))) return x.deny(c);
    const r = await db.query(`update backup_contact set removed_at=$3 where id=$1 and household_id=$2 and removed_at is null returning id`, [c.req.param('id'), H(c), now().toISOString()]);
    if (!r.length) return c.json({ error: 'not_found' }, 404);
    const left = await cover.backups(H(c)); for (const [i, b] of left.entries()) await db.query(`update backup_contact set rank=$2 where id=$1`, [b.id, i + 1]);
    await audit(db, c.get('userId'), H(c), 'backups.removed', { id: c.req.param('id') });
    return c.json({ ok: true });
  });
  app.put('/v1/households/:hh/backups/order', async (c) => {
    if (!(await x.guard(c, H(c), 'backup_list', 'update'))) return x.deny(c);
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(COVER_V1.maxBackups) }).parse(await c.req.json());
    const cur = (await cover.backups(H(c))).map(b => b.id);
    if (ids.length !== cur.length || ids.some(id => !cur.includes(id))) return c.json({ error: 'invalid_order' }, 400);
    for (const [i, id] of ids.entries()) await db.query(`update backup_contact set rank=$3 where id=$1 and household_id=$2`, [id, H(c), i + 1]);
    await audit(db, c.get('userId'), H(c), 'backups.reordered', { ids });
    return c.json({ ok: true });
  });
  /** Standing approval is opt-in and applies to the backup list only (PRD 9.5 exception). */
  app.put('/v1/households/:hh/cover/settings', async (c) => {
    if (!(await x.guard(c, H(c), 'backup_list', 'update'))) return x.deny(c);
    const b = z.object({ standingApproval: z.boolean().optional(), remindTrusted: z.boolean().optional(), hotDay: z.boolean().optional() }).parse(await c.req.json());
    if (b.standingApproval != null) await db.query(`update households set standing_backup_approval=$2 where id=$1`, [H(c), b.standingApproval]);
    if (b.remindTrusted != null) await db.query(`update households set remind_trusted=$2 where id=$1`, [H(c), b.remindTrusted]);
    if (b.hotDay != null) await db.query(`update households set hot_day=$2 where id=$1`, [H(c), b.hotDay]);
    await audit(db, c.get('userId'), H(c), 'cover.settings', { ...b, note: b.standingApproval ? 'standing approval: backup list only' : undefined });
    return c.json({ ok: true });
  });

  /* ---------- PS-140 circle builder ---------- */
  app.post('/v1/households/:hh/circle-builder', async (c) => {
    if (!(await x.guard(c, H(c), 'care_circle', 'create'))) return x.deny(c);
    const b = z.object({ kind: z.enum(['society_link', 'pet_swap', 'building_helper', 'paid_provider']), name: z.string().max(60).optional(), phone: PHONE.optional() }).parse(await c.req.json());
    const id = uid('cb'), token = b.kind === 'society_link' ? uid('j').slice(2, 10) : null;
    await db.query(`insert into circle_builder_invite(id, household_id, kind, token) values ($1,$2,$3,$4)`, [id, H(c), b.kind, token]);
    let note = '';
    if (b.kind === 'society_link') note = `Invite link: /join/${token}. Paste it in your society WhatsApp group. Nobody sees your flat number.`;
    if (b.kind === 'pet_swap') note = 'Swap request recorded. Both owners must opt in before either is asked to help.';
    if (b.kind === 'building_helper') note = 'She is asked for her consent first. One helper can work for several homes without mixing them up.';
    if (b.kind === 'paid_provider') {
      const n = (await cover.backups(H(c))).length;
      if (b.name && b.phone && n < COVER_V1.maxBackups) await db.query(`insert into backup_contact(id, household_id, name, phone_e164, rank, relationship, owner_arranged) values ($1,$2,$3,$4,$5,'Own paid walker or sitter',true)`, [uid('bk'), H(c), b.name, b.phone, n + 1]);
      note = 'Added to your backups as owner-arranged, not verified by Pawsure.';
    }
    await audit(db, c.get('userId'), H(c), 'circle.builder', { kind: b.kind, note: 'no day-care list is shown (PS-140)' });
    return c.json({ id, note }, 201);
  });

  /* ---------- one-time task links: no account, task-scoped, expiring ---------- */
  app.get('/t/:token', async (c) => send(c, await cover.linkView(c.req.param('token'))));
  app.post('/t/:token/:action{accept|decline|done|cant}', async (c) => {
    const b = z.object({ noteRead: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    return send(c, await cover.linkAction(c.req.param('token'), c.req.param('action') as 'accept', b.noteRead));
  });

  /* ---------- demo: cover-phone threads for the simulators ---------- */
  app.get('/demo/cover-thread/:hh/:pid', async (c) => x.d.demoMode ? c.json(await db.query(`select direction, template, body, gloss, buttons, job_id, at from cover_messages where household_id=$1 and person_id=$2 order by at, seq`, [c.req.param('hh'), c.req.param('pid')])) : c.json({ error: 'not_found' }, 404));
  app.get('/demo/cover-people/:hh', async (c) => x.d.demoMode ? c.json(await db.query(`select id, name, 'backup' as kind, phone_e164 as phone from backup_contact where household_id=$1 and removed_at is null union all select id, name, kind, phone_e164 from task_links where household_id=$1 order by 2`, [c.req.param('hh')])) : c.json({ error: 'not_found' }, 404));
  app.get('/demo/cover-link/:hh/:pid', async (c) => {
    if (!x.d.demoMode) return c.json({ error: 'not_found' }, 404);
    const m = (await db.query<{ buttons: { id: string }[] }>(`select buttons from cover_messages where household_id=$1 and person_id=$2 and buttons::text like '%link:%' order by at desc, seq desc limit 1`, [c.req.param('hh'), c.req.param('pid')]))[0];
    return c.json({ token: m?.buttons.find(b => b.id.startsWith('link:'))?.id.slice(5) ?? null, today: istDate(now()) });
  });
}
