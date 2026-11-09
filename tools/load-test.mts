/**
 * Pilot load test (§12 NFR: P95 core non-AI API < 500 ms at pilot load; scale by configuration to 1,000 households).
 * Seeds N homes like the demo home (owner, helper with consent, 2 pets, 4 routine tasks), then runs owner reads,
 * helper webhooks and the minute job concurrently in-process against PGlite, and reports p95 per route.
 * Run: npx tsx tools/load-test.mts [homes=20] [requests=2000]  → docs/runbooks/load-test.md
 * In-process numbers exclude network and TLS; repeat against staging with a real HTTP client before the pilot.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openDb, migrate, seedDemo } from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';
import { mockAdapters } from '../apps/api/src/adapters.js';
import { demoClock } from '../apps/api/src/clock.js';
import { p95 } from '../apps/api/src/ops.js';

const HOMES = Number(process.argv[2] ?? 20), REQUESTS = Number(process.argv[3] ?? 2000), CONCURRENCY = 10;
const DAY = '2026-11-10', at = (hm: string) => `${DAY}T${hm}:00+05:30`;

async function run(homes: number, requests: number) {
  const db = await openDb({ dataDir: 'memory' }); await migrate(db); await seedDemo(db);
  const clock = demoClock(at('12:50'));
  const app = createApp({ db, adapters: mockAdapters(), clock, pepper: 'load', demoMode: true, limits: { requestsPerHour: 1e6 } });
  const q = (s: string, p: unknown[]) => db.query(s, p);
  const tokens: { hh: string; token: string; helper: string }[] = [];
  for (let i = 0; i < homes; i++) {
    const n = String(i).padStart(4, '0'), hh = 'hh_load' + n, ow = 'u_lo' + n, hp = 'u_lh' + n, owPhone = '+9189' + n.padStart(8, '0'), hpPhone = '+9188' + n.padStart(8, '0');
    await q(`insert into households(id, society, tower, gate_app, rewards_arm) values ($1,'Load Test CHS, Powai','A',$2,$3)`, [hh, i % 3 === 0, i % 2 === 0]);
    await q(`insert into users(id, phone_e164, display_name) values ($1,$2,'Owner ' || $3),($4,$5,'Helper ' || $3)`, [ow, owPhone, n, hp, hpPhone]);
    await q(`insert into memberships(id, household_id, user_id, role, status, method) values ($1,$2,$3,'owner','active',null),($4,$2,$5,'helper','active','photo')`, ['m_o' + n, hh, ow, 'm_h' + n, hp]);
    await q(`insert into consent_records(id, user_id, household_id, kind, version, language, granted) values ($1,$2,$3,'helper_monitoring','W1-1.0','en',true)`, ['cl' + n, hp, hh]);
    await q(`insert into pets(id, household_id, name, species) values ($1,$2,'Dog ' || $3,'Dog'),($4,$2,'Cat ' || $3,'Cat')`, ['pd' + n, hh, n, 'pc' + n]);
    for (const [k, pet, due, type] of [['a', 'pd', 780, 'feeding'], ['b', 'pd', 780, 'medicine'], ['c', 'pc', 780, 'litter'], ['d', 'pd', 960, 'toilet']] as const)
      await q(`insert into routine_tasks(id, household_id, pet_id, title, task_type, due_minute, min_minutes, escalation_profile, visit_slot, assignee_membership_id, effective_from) values ($1,$2,$3,$4,$5,$6,3,$7,$8,$9,'2026-11-01')`, [`rl${k}${n}`, hh, pet + n, 'Task ' + k, type, due, type === 'medicine' ? 'medicine' : 'standard', 'v1', 'm_h' + n]);
    const token = 'load-' + n;
    await q(`insert into sessions(token_hash, user_id, expires_at) values ($1,$2,'2027-01-01')`, [createHash('sha256').update(token).digest('hex'), ow]);
    tokens.push({ hh, token, helper: hpPhone });
  }
  const t0 = performance.now(); await app.request('/jobs/tick', { method: 'POST' }); const firstTick = performance.now() - t0;
  const times: Record<string, number[]> = {}; let errors = 0, done = 0;
  const one = async (k: number) => {
    const h = tokens[k % tokens.length]!, r = k % 10;
    const [route, path, init]: [string, string, RequestInit] =
      r < 4 ? ['GET today', `/v1/households/${h.hh}/today`, {}] :
      r < 5 ? ['GET timeline', `/v1/households/${h.hh}/day/timeline`, {}] :
      r < 6 ? ['GET report', `/v1/households/${h.hh}/day/report`, {}] :
      r < 7 ? ['GET pets', `/v1/households/${h.hh}/pets`, {}] :
      r < 8 ? ['GET me', '/v1/me', {}] :
      ['POST webhook photo', '/webhooks/whatsapp', { method: 'POST', body: JSON.stringify({ from: h.helper, messageId: 'ld' + k, type: 'photo', taskId: `rla${h.hh.slice(7)}_${DAY}`, mediaRef: 'img' + k, caption: 'done' }) }];
    const s = performance.now();
    const res = await app.request(path, { ...init, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + h.token } });
    (times[route] ??= []).push(performance.now() - s);
    if (res.status >= 500) errors++;
    done++;
  };
  const start = performance.now(); let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (next < requests) await one(next++); }));
  const wall = (performance.now() - start) / 1000;
  const t1 = performance.now(); await app.request('/jobs/tick', { method: 'POST' }); const tick = performance.now() - t1;
  const all = Object.values(times).flat();
  await db.close();
  return { homes, requests: done, errors, rps: Math.round(done / wall), p95All: p95(all)!, routes: Object.entries(times).map(([k, v]) => ({ route: k, n: v.length, p95: p95(v)! })), firstTick: Math.round(firstTick), tick: Math.round(tick) };
}

const pilot = await run(HOMES, REQUESTS);
const scale = await run(200, 400);
const pass = pilot.p95All < 500 && pilot.errors === 0;
const report = `# Load test

Run ${new Date().toISOString()} · in-process (no network/TLS) · PGlite · concurrency ${CONCURRENCY}

## Pilot load: ${pilot.homes} homes, ${pilot.requests} requests

| Route | Requests | p95 (ms) |
|---|---|---|
${pilot.routes.map(r => `| ${r.route} | ${r.n} | ${r.p95} |`).join('\n')}
| **All core (non-AI)** | ${pilot.requests} | **${pilot.p95All}** |

- Server errors: ${pilot.errors} · throughput ≈ ${pilot.rps} requests/s
- Minute job for all homes: first run ${pilot.firstTick} ms, steady ${pilot.tick} ms
- Target: p95 < 500 ms → **${pass ? 'PASS' : 'FAIL'}**

## Scale check: 200 homes

- Minute job: first run ${scale.firstTick} ms, steady ${scale.tick} ms · p95 of ${scale.requests} requests: ${scale.p95All} ms · errors ${scale.errors}
- The job runner visits every home every minute; at 1,000 homes it must be split into household shards before it nears 60 s (not built yet; see known limitations).

Repeat against staging over HTTPS with the real database before the pilot; in-process numbers are a floor, not a promise.
`;
mkdirSync('docs/runbooks', { recursive: true });
writeFileSync('docs/runbooks/load-test.md', report);
console.log(report);
process.exit(pass ? 0 : 1);
