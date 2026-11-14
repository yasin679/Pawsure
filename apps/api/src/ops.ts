/**
 * Phase 5 — pilot operations: retention (§9), service monitoring and alerting (§16 Phase 0/5 monitoring plan).
 * Monitoring reads the database plus an in-process window of request timings; alerts open one ops case per incident
 * of a check going into 'alert', and page the on-call owner through the push adapter.
 */
import type { Db } from '@pawsure/db';
import { uid } from '@pawsure/db';
import type { Adapters } from './adapters.js';
import { audit } from './care.js';
import { istDate } from './clock.js';

const DAY = 86400000;

/* ---------------- Retention ---------------- */
export const RETENTION = {
  photosVoiceDays: 90, requestTextDays: 90, messageMetadataMonths: 12, liveLocationHours: 24, friendOptOutDays: 30,
  incidentEvidenceYears: 3, otpHours: 24, expiredSessionDays: 7, revokedShareLinkDays: 90
};

/** Runs once per IST day. Deletes or blanks only what the schedule says; keeps image hashes for duplicate detection. */
export async function runRetention(db: Db, now: Date): Promise<Record<string, number> | null> {
  const date = istDate(now);
  const claimed = await db.query(`insert into retention_runs(run_date, counts) values ($1, '{}') on conflict do nothing returning run_date`, [date]);
  if (!claimed.length) return null;
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const n = async (sql: string, p: unknown[]) => (await db.query(sql + ' returning 1', p)).length;
  const counts: Record<string, number> = {
    // Photos / voice notes: 90 days, unless the task is under dispute (mismatch case) — then kept for the case.
    evidenceRefsCleared: await n(`update checkin_signals s set evidence_ref=null where evidence_ref is not null and s.received_time < $1 and not exists (select 1 from care_tasks t where t.id=s.task_id and t.mismatch_case is not null)`, [ago(RETENTION.photosVoiceDays * DAY)]),
    incidentVoiceCleared: await n(`update incidents set voice_ref=null where voice_ref is not null and reported_at < $1`, [ago(RETENTION.incidentEvidenceYears * 365 * DAY)]),
    requestTextCleared: await n(`update friend_requests set parse=null, doc = doc - 'text' where created_at < $1 and (parse is not null or doc ? 'text')`, [ago(RETENTION.requestTextDays * DAY)]),
    liveLocationDeleted: await n(`delete from live_location_sessions where delete_after < $1`, [now.toISOString()]),
    friendProfilesDeleted: await n(`delete from friend_profiles where opt_out_requested_at is not null and opt_out_requested_at < $1`, [ago(RETENTION.friendOptOutDays * DAY)]),
    helperMessagesDeleted: await n(`delete from helper_messages where at < $1`, [ago(RETENTION.messageMetadataMonths * 30 * DAY)]),
    friendMessagesDeleted: await n(`delete from friend_messages where at < $1`, [ago(RETENTION.messageMetadataMonths * 30 * DAY)]),
    otpDeleted: await n(`delete from otp_challenges where created_at < $1`, [ago(RETENTION.otpHours * 3600000)]),
    sessionsDeleted: await n(`delete from sessions where expires_at < $1 or revoked_at < $1`, [ago(RETENTION.expiredSessionDays * DAY)]),
    shareLinksDeleted: await n(`delete from share_links where revoked_at < $1`, [ago(RETENTION.revokedShareLinkDays * DAY)])
  };
  await db.query(`update retention_runs set counts=$2 where run_date=$1`, [date, JSON.stringify(counts)]);
  await audit(db, 'system', null, 'retention.run', { date, counts });
  return counts;
}

/* ---------------- Monitoring ---------------- */
interface Sample { t: number; route: string; status: number; ms: number }
export interface Monitor {
  record(path: string, method: string, status: number, ms: number): void;
  tickDone(ms: number): void;
  samples: Sample[]; lastTickAt: number | null; lastTickMs: number | null; started: number;
}
/** Collapse ids so /v1/households/hh_demo/tasks/r1_2026-11-06 → /v1/households/:id/tasks/:id */
export const routeKey = (method: string, path: string) => method + ' ' + path.split('/').map(s => (/\d|_|-.*-/.test(s) && s.length > 2 ? ':id' : s)).join('/');
export function createMonitor(): Monitor {
  const m: Monitor = {
    samples: [], lastTickAt: null, lastTickMs: null, started: Date.now(),
    record(path, method, status, ms) { m.samples.push({ t: Date.now(), route: routeKey(method, path), status, ms }); if (m.samples.length > 5000) m.samples.splice(0, m.samples.length - 5000); },
    tickDone(ms) { m.lastTickAt = Date.now(); m.lastTickMs = Math.round(ms); }
  };
  return m;
}
export const p95 = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!); };

export interface Check { key: string; label: string; status: 'ok' | 'warn' | 'alert'; value: string; target: string; note?: string }
const AI_ROUTES = /POST \/v1\/households\/:id\/requests$|\/search$/;

export async function serviceChecks(db: Db, mon: Monitor, now: Date, demoMode: boolean): Promise<Check[]> {
  const real = Date.now(), last15 = mon.samples.filter(s => real - s.t < 15 * 60000);
  const lvl = (bad: boolean, warn: boolean): Check['status'] => (bad ? 'alert' : warn ? 'warn' : 'ok');
  const tickAge = mon.lastTickAt == null ? null : Math.round((real - mon.lastTickAt) / 1000);
  const core = last15.filter(s => !AI_ROUTES.test(s.route) && !s.route.includes('/jobs/') && !s.route.includes('/demo/'));
  const corP95 = p95(core.map(s => s.ms));
  const err5 = last15.filter(s => s.status >= 500).length;
  const wh = last15.filter(s => s.route.includes('/webhooks/')), whErr = wh.filter(s => s.status >= 500).length, whRej = wh.filter(s => s.status >= 400 && s.status < 500).length;
  const otpFail = last15.filter(s => s.route.includes('/auth/otp/verify') && s.status >= 400).length;
  const hourAgo = new Date(real - 3600000).toISOString();
  const del = (await db.query<{ status: string; n: number }>(`select status, count(*)::int as n from delivery_log where at > $1 group by status`, [hourAgo]));
  const dn = (s: string) => del.find(x => x.status === s)?.n ?? 0;
  const delays = (await db.query<{ d: number }>(`select (detail->>'delaySec')::int as d from audit_log where action='escalation.step' and detail ? 'delaySec' order by id desc limit 50`)).map(r => r.d);
  const delayP95 = p95(delays);
  const stuck = (await db.query<{ n: number }>(`select count(*)::int as n from friend_requests where state in ('Sent','Provisional hold','Accepted - pending owner confirmation') and updated_at < $1`, [new Date(now.getTime() - 10 * 60000).toISOString()]))[0]!.n;
  const rights = (await db.query<{ overdue: number; soon: number; oldest: number | null }>(`select count(*) filter (where due_at < $1)::int as overdue, count(*) filter (where due_at < $2)::int as soon, max(extract(epoch from ($1::timestamptz - created_at)) / 86400)::int as oldest from rights_requests where state <> 'closed'`, [now.toISOString(), new Date(now.getTime() + 2 * DAY).toISOString()]))[0]!;
  const s1 = (await db.query<{ n: number }>(`select count(*)::int as n from incidents where severity='S1' and resolved_at is null and ack_at is null and reported_at < $1`, [new Date(now.getTime() - 15 * 60000).toISOString()]))[0]!.n;
  const llm = await db.query<{ action: string; n: number }>(`select action, count(*)::int as n from audit_log where action in ('llm.parsed','llm.fallback') and at > $1 group by action`, [new Date(real - DAY).toISOString()]);
  const llmFb = llm.find(x => x.action === 'llm.fallback')?.n ?? 0, llmAll = llmFb + (llm.find(x => x.action === 'llm.parsed')?.n ?? 0);
  const t0 = performance.now(); await db.query('select 1'); const dbMs = Math.round(performance.now() - t0);
  const ret = (await db.query<{ run_date: string }>(`select run_date::text from retention_runs order by run_date desc limit 1`))[0]?.run_date ?? null;
  return [
    { key: 'jobs_tick', label: 'Job runner (escalations, prompts, timers)', status: tickAge == null ? 'warn' : lvl(tickAge > 600, tickAge > 180), value: tickAge == null ? 'not run yet' : `${tickAge}s since last run (${mon.lastTickMs} ms)`, target: 'every minute; alert after 10 min' },
    { key: 'alert_delay', label: 'Missed-task alert delay (p95, last 50)', status: delayP95 == null ? 'ok' : lvl(delayP95 > 30, delayP95 > 15), value: delayP95 == null ? 'no alerts yet' : `${delayP95}s`, target: '≤ 30 s after the threshold', note: demoMode ? 'Demo clock jumps in 5–60 min steps, which inflates this in demo mode.' : undefined },
    { key: 'delivery', label: 'Message delivery (last hour)', status: lvl(dn('gave_up') > 0, dn('failed') >= 3 || dn('fallback_sent') > 0), value: `${dn('sent')} sent · ${dn('failed')} failed attempts · ${dn('fallback_sent')} by fallback · ${dn('gave_up')} undelivered`, target: 'nothing undelivered' },
    { key: 'webhooks', label: 'Inbound webhooks (15 min)', status: lvl(whErr > 0, whRej > 10), value: `${wh.length} received · ${whErr} errors · ${whRej} rejected`, target: 'no 5xx' },
    { key: 'otp', label: 'OTP sign-in failures (15 min)', status: lvl(otpFail > 30, otpFail > 10), value: `${otpFail} failed codes`, target: '≤ 10; more may be abuse' },
    { key: 'api_latency', label: 'Core API p95 (15 min, non-AI)', status: corP95 == null ? 'ok' : lvl(corP95 > 1000, corP95 > 500), value: corP95 == null ? 'no traffic' : `${corP95} ms over ${core.length} requests`, target: '< 500 ms' },
    { key: 'api_errors', label: 'Server errors (15 min)', status: lvl(err5 >= 5, err5 >= 1), value: `${err5}`, target: '0' },
    { key: 'stuck_requests', label: 'Friend requests waiting > 10 min', status: lvl(false, stuck > 0), value: `${stuck}`, target: 'ops checks each one' },
    { key: 'open_s1', label: 'S1 emergencies unacknowledged > 15 min', status: lvl(s1 > 0, false), value: `${s1}`, target: '0, call the care circle' },
    { key: 'rights_age', label: 'Rights requests', status: lvl(rights.overdue > 0, rights.soon > 0), value: `${rights.overdue} overdue · ${rights.soon} due within 2 days · oldest ${rights.oldest ?? 0} days`, target: 'reply within 7 days' },
    { key: 'llm', label: 'AI parse fallbacks (24 h)', status: lvl(false, llmAll >= 5 && llmFb / llmAll > 0.5), value: `${llmFb} of ${llmAll}`, target: 'manual form always works; > 50% fallback = check vendor' },
    { key: 'database', label: 'Database', status: lvl(dbMs > 1000, dbMs > 200), value: `${dbMs} ms round trip`, target: '< 200 ms' },
    { key: 'retention', label: 'Retention job', status: ret == null ? 'warn' : lvl(false, ret < istDate(new Date(now.getTime() - 2 * DAY))), value: ret ? `last ran for ${ret}` : 'not run yet', target: 'daily' }
  ];
}

/** Store check states; each move into 'alert' opens one ops case and pages on-call. Recovery is noted on that case. */
export async function raiseAlerts(db: Db, A: Adapters, checks: Check[]) {
  const raised: string[] = [];
  for (const c of checks) {
    const prev = (await db.query<{ status: string; case_id: string | null }>(`select status, case_id from service_checks where key=$1`, [c.key]))[0];
    if (prev && prev.status === c.status) { await db.query(`update service_checks set value=$2 where key=$1`, [c.key, c.value]); continue; }
    let caseId = prev?.case_id ?? null;
    if (c.status === 'alert') {
      caseId = uid('case');
      await db.query(`insert into ops_cases(id, kind, title, severity) values ($1,'monitoring',$2,'ops')`, [caseId, `${c.label}: ${c.value}`]);
      await A.push.push('oncall', 'Pawsure service alert', `${c.label}: ${c.value}`);
      raised.push(c.key);
    } else if (prev?.status === 'alert' && caseId) {
      await db.query(`update ops_cases set notes = notes || $2::jsonb where id=$1`, [caseId, JSON.stringify([`${new Date().toISOString()} recovered: ${c.value}`])]);
    }
    await db.query(`insert into service_checks(key, status, value, since, case_id) values ($1,$2,$3,now(),$4) on conflict (key) do update set status=$2, value=$3, since=now(), case_id=$4`, [c.key, c.status, c.value, caseId]);
    await audit(db, 'system', null, 'monitor.' + c.status, { check: c.key, value: c.value });
  }
  return raised;
}

/* ---------------- Backups (PGlite deployments; managed Postgres uses provider PITR) ---------------- */
/**
 * Writes an encrypted snapshot plus a manifest (sha256 + row-count fingerprint) to BACKUP_DIR, keeps the newest 14.
 * Runs nightly from the job runner when BACKUP_DIR and BACKUP_KEY are set, or on demand via POST /jobs/backup.
 * RPO for this mode = 24 h (nightly); see docs/runbooks/restore.md for the managed-Postgres targets.
 */
export async function runBackup(db: Db, now: Date, opts: { dir?: string; key?: string; force?: boolean } = {}) {
  const dir = opts.dir ?? process.env.BACKUP_DIR, rawKey = opts.key ?? process.env.BACKUP_KEY;
  if (!dir || !rawKey || !db.dump) return null;
  const { mkdirSync, writeFileSync, readdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { backup, backupKey, fingerprint } = await import('@pawsure/db');
  mkdirSync(dir, { recursive: true });
  const date = istDate(now);
  if (!opts.force && readdirSync(dir).some(f => f.startsWith(`pawsure-${date}`))) return null;
  const fp = await fingerprint(db);
  const b = await backup(db, backupKey(rawKey));
  const name = `pawsure-${date}-${Date.now()}.psbk`;
  writeFileSync(join(dir, name), b.data);
  writeFileSync(join(dir, name + '.json'), JSON.stringify({ file: name, createdAt: new Date().toISOString(), careDate: date, sha256: b.sha256, bytes: b.bytes, fingerprint: fp }, null, 2));
  const all = readdirSync(dir).filter(f => f.endsWith('.psbk')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 14))) { rmSync(join(dir, old), { force: true }); rmSync(join(dir, old + '.json'), { force: true }); }
  await audit(db, 'system', null, 'backup.written', { file: name, bytes: b.bytes, sha256: b.sha256 });
  return { file: join(dir, name), bytes: b.bytes, sha256: b.sha256 };
}
