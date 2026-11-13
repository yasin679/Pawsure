/** Generates docs/permission-matrix.md and docs/traceability.md from code so the docs can’t drift. Run: npx tsx tools/gen-docs.ts */
import { writeFileSync } from 'node:fs';
import { MATRIX, type Resource } from '../packages/domain/src/permissions.js';

const resources = [...new Set(Object.values(MATRIX).flatMap(r => Object.keys(r ?? {})))] as Resource[];
let pm = '# Permission matrix (generated from `packages/domain/src/permissions.ts`)\n\nRoles across, resources down. Server-side and object-level: every check also requires the same household, except staff. Extra conditions apply beyond this table:\n\n';
pm += '- **Backup** sees the pet and emergency card only through a valid 15-minute look-in link, and the address only if authorised.\n- **Helper** sees the emergency card only during a visit or incident.\n- **Friend** sees access details and the emergency card only after acceptance and owner authorisation.\n- **Nearby member** has no access while PS-062 is OFF.\n- **Substitute** and **ad-hoc visitor** (v1.4) act only through a one-time task link: this task only, until it expires or is revoked. Before acceptance and owner approval they see the task, time and tower; address, gate, key and emergency card only after both.\n- **Standing approval** (v1.4, PRD 9.5) lets Pawsure message the ordered backup list without a tap each time. It never covers friends, substitutes, ad-hoc numbers or nearby members (`outreachAllowed`).\n\n';
const roles = Object.keys(MATRIX);
pm += '| Resource | ' + roles.join(' | ') + ' |\n|' + '---|'.repeat(roles.length + 1) + '\n';
for (const r of resources.sort()) pm += `| ${r} | ` + roles.map(role => (MATRIX as Record<string, Record<string, string[]>>)[role]?.[r]?.map(a => a[0]!.toUpperCase() + a.slice(1, 3)).join(' ') || '—').join(' | ') + ' |\n';
pm += '\nKey: Rea = read, Cre = create, Upd = update, Del = delete, Ack = acknowledge, App = approve, Exp = export.\n';
writeFileSync('docs/permission-matrix.md', pm);

type Row = [id: string, title: string, status: 'Built + tested' | 'Rules built + tested' | 'Partial' | 'Planned' | 'Switch OFF (locked)', where: string, tests: string, phase: string];
const T: Row[] = [
  ['PS-001', 'Mobile OTP sign-in', 'Built + tested', 'api /auth/otp/*, web Onboarding', 'api.test: auth', '1'],
  ['PS-002', 'Consent and profile controls', 'Built + tested', 'api /v1/consents, /v1/me/rights (withdrawal), web Onboarding + Your data rights', 'phase4.test: owner rights', '1/4'],
  ['PS-003', 'Pet profiles', 'Built + tested', 'api pets CRUD, web PetScreen', 'api.test: roles', '1'],
  ['PS-004', 'Vet and emergency contacts', 'Built + tested', 'pets table, PetScreen emergency card', 'db.test', '1'],
  ['PS-005', 'Care circle + revocation ≤ 60 s', 'Built + tested', 'circle invite/accept/revoke; look-in links revoked at once; per-request membership check', 'phase2.test: revoke', '2'],
  ['PS-006', 'Cats and other pets', 'Built + tested', 'species on pets; seed cat routine', 'api.test day flow', '1'],
  ['PS-007', '30-second leaving checklist', 'Built + tested', 'POST day/leaving; Today sheet', 'phase2.test', '2'],
  ['PS-010/011', 'Routine tasks and edits', 'Built + tested', 'routine endpoints (effective tomorrow, superseded_by), RoutineScreen', 'phase2.test: routine', '2'],
  ['PS-012', 'Alone-window warning', 'Built + tested', 'aloneWindow(); Today banner', 'daily.test, phase2.test', '2'],
  ['PS-013', 'Who’s caring today?', 'Built + tested', 'PUT day mode; friend route opens Find cover', 'phase2.test', '2/3'],
  ['PS-014', 'My help can’t come today', 'Built + tested', 'plan preserved; confirmed friend cover reassigns helper tasks (original kept)', 'phase2.test, phase3.test', '2/3'],
  ['PS-015/016/103', 'Timeline and day report', 'Built + tested', 'GET day/timeline, day/report; Today sheets; Thank on WhatsApp', 'phase2.test', '2'],
  ['PS-020–022, PS-110', 'Helper invite, consent, method', 'Built + tested', 'W1/W2 templates en/hi/mr, buttons, Not now, stop/start, HelperScreen', 'phase2.test: helper channel', '2'],
  ['PS-023/024/109', 'Task prompt, code card', 'Built + tested', 'prompt job (due −10, once), monthly encrypted card, rotate, typed-code check', 'phase2.test: code card, prompts', '2'],
  ['PS-025', 'Missed call + IVR', 'Built + tested', '/webhooks/ivr, registered-number check', 'api.test', '2 (vendor)'],
  ['PS-026', 'Owner-provided gate signal', 'Built + tested', '/visits/:id/gate', 'trust.test', '1'],
  ['PS-027/039', 'Helper problem report, parallel alert', 'Built + tested', 'WhatsApp problem buttons → incident + incident job', 'phase2.test', '2'],
  ['PS-028/042–044/126', 'Rewards ledger, caps, holds, experiment', 'Built + tested', 'rewards.ts + ledger.ts; earned rows written at day close; month cap from the ledger; holds decided with a reason; per-household arms; owner Wallet', 'ledger.test, phase4.test: rewards', '4'],
  ['PS-029', 'One helper across households', 'Built + tested', 'memberships per household', 'db.test', '1'],
  ['PS-030/122', 'Confidence engine, visit vs task', 'Built + tested', 'trust.ts, care.loadDay', 'trust.test (24), api.test', '1'],
  ['PS-031/032/101', 'Missed check-in and escalation', 'Built + tested', 'escalation.ts, runEscalations, /jobs/escalations', 'escalation-coverage.test, api.test', '1'],
  ['PS-033', 'Return check', 'Built + tested', 'applyReturnCheck, POST day/return-check, Today sheet', 'daily.test, phase2.test', '2'],
  ['PS-034', 'Dispute and helper response', 'Partial', 'Mismatch → ops case, held ledger, dispute message + Explain button; ops lead releases or reverses with a reason', 'phase2.test, phase4.test', '2/4'],
  ['PS-035/106', 'Emergency card (+ sharing)', 'Built', 'PetScreen card; look-in page; incident card', 'phase2.test (look-in)', '2'],
  ['PS-036/124', 'Incident log and severity matrix', 'Built + tested', 'incidents list/ack/resolve, incident job with dedupe, plan view', 'escalation-coverage.test, phase2.test', '2'],
  ['PS-037/008', 'Camera look-in', 'Planned', 'flag OFF', '—', 'Switch OFF'],
  ['PS-038', 'Offline / provider resilience', 'Partial', 'event vs received time, idempotent webhooks, offline banner, IVR path', 'api.test: duplicate webhook', '2/5'],
  ['PS-040/041/046', 'Health calendar and reminders', 'Built + tested', 'health endpoints, reminder job, HealthScreen', 'daily.test, phase2.test', '2'],
  ['PS-045', 'No partner claims', 'Built', 'Emergency card: tele-consult “planned”', '—', '1'],
  ['PS-050–054', 'Friend profiles, consent, privacy', 'Built + tested', 'F1 privacy panel; F2 list + invite (invite ≠ opt-in); F3 profile; F7 friend settings; opt-out removes from search at once', 'phase3.test', '3'],
  ['PS-055/056/065/125', 'Ask Pawsure parse, clarify, AI bounds, fallback', 'Built + tested', 'LLM adapter (8 s abort) → rules schema; clarifications block search; manual form; correction metric', 'friendfinder.test, phase3.test', '3 (real LLM vendor: 5)'],
  ['PS-057/058/066', 'Friends-first deterministic matching', 'Built + tested', 'matchFriends on live data; reasons; excluded counts without names', 'friendfinder.test, phase3.test', '3'],
  ['PS-059–061/063/067/068/123', 'Outreach, replies, race, timers', 'Built + tested', 'explicit approval; WhatsApp FF templates in en/hi/mr; replies via webhook or app; hold, reminder, expiry, close −30, no-show +20, friend cancel → reopen; access grants', 'friendfinder.test, phase3.test', '3'],
  ['PS-062', 'Nearby-member fallback', 'Built (switch OFF)', 'FLAG_DEFAULTS locked; permissions deny', 'permissions test', 'Switch OFF'],
  ['PS-064', 'Block / report', 'Built + tested', 'block, report → ops case; excluded from search', 'phase3.test', '3'],
  ['PS-069', 'Consent-based history summary', 'Built', 'historySummary on F3', 'friendfinder.test', '3'],
  ['PS-070/071/072', 'Ops console, flags, audit', 'Built + tested', '/admin API (role-checked, every view audited, masked phones) + console at /admin: overview, queues, households, signals, Friend Finder, switches, audit', 'phase4.test: staff access, ops queue', '4'],
  ['PS-102', 'Backup look-in link', 'Built + tested', 'hashed token, 15 min, logged opens, address only if authorised, /l/:token page, ack', 'phase2.test', '2'],
  ['PS-104/105/107', 'Share record, points messages, thank-you points', 'Partial', '“points” reply and Sunday weekly message; share link (counts only, flag OFF by default, “stop link”); friend thank-you points stay OFF', 'phase4.test: rewards, share link', '4 (PS-107 needs funding)'],
  ['PS-108', 'Unified navigation', 'Built', 'web App tab bar', '—', '1'],
  ['PS-111', 'Covered care day', 'Built + tested', 'coveredDay.ts, care_days', 'escalation-coverage.test', '1'],
  ['PS-117', 'Method-mix dashboard', 'Built + tested', '/admin/method-mix: method, language, gate-app cuts; groups under 5 suppressed; no helper listed', 'ledger.test: safeCuts, phase4.test', '4'],
  ['PS-118', 'WhatsApp template policy', 'Partial', 'named templates only (templates.ts); support path in thread', '—', '5 (Meta approval)'],
  ['PS-026', 'Random photo checks without a gate app', 'Built + tested', 'photoSampleRate in task prompts, server-secret sampling', 'trust.test #5, acceptance.test #5', '5'],
  ['§9 security', 'Tenant isolation, IDOR, enumeration, OTP abuse, sessions, links, spam, audit immutability', 'Built + tested', 'guards per household, sign-out, rate limits', 'security.test', '5'],
  ['§9 retention / backups', 'Retention schedule, encrypted backups, restore drill', 'Built + tested', 'ops.ts runRetention/runBackup, tools/restore-drill.mts', 'phase5.test', '5'],
  ['§16 monitoring', 'Service checks, alerting, vendor failover', 'Built + tested', 'ops.ts serviceChecks/raiseAlerts, delivery.ts', 'phase5.test', '5'],
  ['PS-119/120', 'Rights, grievance, breach runbook', 'Built + tested', 'owner + helper (WhatsApp “my data”) requests with 7/90-day clocks, export, privacy desk; breach checklist and rehearsal with the 72 h clock', 'phase4.test: rights, breach', '4 (legal review pending)'],
  ['PS-121', 'Task lifecycle', 'Built + tested', 'lifecycle.ts, task_events (immutable)', 'trust.test, api.test', '1'],
  ['PS-127', 'Pre-task caregiver confirmation', 'Built + tested', 'cover/planner.ts planReminder; cover.ts runReminders (90 min before; 8 PM the evening before for tasks before 10 AM; Trusted only if enabled; co-owners and backup replacements); WhatsApp buttons, IVR 1/2/3, app reply; HelperSim', 'cover.test: reminder planner; cover-continuity.test O1/O2/IVR/co-owner; e2e O1, O2', '1.1.0'],
  ['PS-128', 'Can’t come at any time; substitute', 'Built + tested', 'isCantCome (en/hi/mr), parseSubstitute; helper inbound, IVR “cant”; access revoked + audited; task_links (substitute, owner approves first, one-time link)', 'cover.test: replies; cover-continuity.test: can’t come, substitute; e2e O3, O4', '1.1.0'],
  ['PS-129', 'At-risk task state', 'Built + tested', 'cover/stateMachine.ts (reason codes); atRiskReason; At-risk banner and cover line on Today', 'cover.test: state machine, at-risk evaluator; e2e O1, O2', '1.1.0'],
  ['PS-130', 'Ordered backup list', 'Built + tested', 'orderBackups/nextBackupAction (pairs, 10 min, key holders first, hold, auto-confirm); backup_contact; Backups screen; standing approval', 'cover.test: backup runner; cover-continuity.test: backups; e2e O5', '1.1.0'],
  ['PS-131', 'After the Friend Finder cutoff', 'Built + tested', 'friendFinderOpen/afterFriendCancel; FF reducer blocks sends at the cutoff and sends a late cancel to the backup runner; honours a Yes received before the cutoff', 'friendfinder-cutoff.test; cover-continuity.test: cutoff; e2e O6, P1', '1.1.0'],
  ['PS-132', 'Task urgency', 'Built + tested', 'defaultUrgency, alertGrace (must happen: due + 15), circleCallDue; routine and care_tasks urgency; urgency selector; hot-day switch', 'cover.test: urgency; cover-continuity.test: must happen; e2e O7, O8', '1.1.0'],
  ['PS-133', 'Cover not found', 'Built + tested', 'notFoundOptions; message + automated call; I’ll handle it, ask someone else (15-min link), whole circle, move/skip by urgency; Cover not found sheet', 'cover.test; cover-continuity.test: must happen, can wait, ask someone else; e2e O7, O8', '1.1.0'],
  ['PS-134', 'Pre-departure warning and plan B', 'Built + tested', 'preDepartureCheck; six options; leave anyway → NoCoverPlanned (not covered); plan B on the leaving check; wide ask (60 min) when more than 3 h remain', 'cover.test: pre-departure; cover-continuity.test: leaving; e2e O9', '1.1.0'],
  ['PS-135', 'Thin-circle warning and cluster advisory', 'Built + tested', 'thinCircle weekly (dedupe by week); /admin/advisories composer; advisory pulls tomorrow’s reminders to that evening', 'cover-continuity.test: advisory, circle builder; e2e O14', '1.1.0'],
  ['PS-136', 'I’m delayed', 'Built + tested', 'planDelay, splitExtension; /day/delay and /ask; helper Yes / Only until / Can’t; part-only request; day report', 'cover.test: delay planner; cover-continuity.test: delayed; e2e O10', '1.1.0'],
  ['PS-137', 'Gate and key checklist', 'Built + tested', 'visit_access_checklist for anyone new to the home; key plans; one reminder at task − 15; details only after acceptance', 'cover.test: checklist; cover-continuity.test O1; e2e O1, O11', '1.1.0'],
  ['PS-138', 'Pet handling note', 'Built + tested', 'pets.handling_note; first-time backups, friends, substitutes and ad-hoc visitors must confirm reading it before Yes; ranking unchanged except a tie-break for people who have cared before', 'cover-continuity.test O1; phase3.test; e2e O1, O4, O12', '1.1.0'],
  ['PS-139', 'One named carer per task', 'Built + tested', 'task_cover person per task; routine Who (helper, co-owner, owner); co-owner reminder answered in the app', 'cover-continuity.test: co-owner', '1.1.0'],
  ['PS-140', 'Newcomer circle builder', 'Built + tested', 'Onboarding “Do you have anyone?”; society link, pet-parent swap, building helper, own provider; no day-care list', 'cover-continuity.test: circle builder; e2e O13', '1.1.0'],
  ['PS-141', 'Same-society member fallback', 'Switch OFF (locked)', 'feature flag sameSocietyFallback, locked OFF until the verification rule is decided (PRD 20.3)', 'cover-continuity.test: switch; e2e O14', '1.1.0'],
  ['16.3 v1.4', 'Cover continuity metrics', 'Built + tested', 'coverMetrics (six metrics, 10% review line); /admin/cover-metrics; console Cover continuity section', 'cover.test: metrics; cover-continuity.test', '1.1.0'],
  ['PS-118 v1.4', 'Cover templates', 'Partial', '9 utility templates en/hi/mr with approval status (coverTemplates.ts; /admin/templates). Not submitted: no WhatsApp provider yet', 'cover-continuity.test: templates', '1.1.0 (Meta approval)'],
];
let tr = '# Requirements traceability (P0)\n\nStatus for release 1.1.0 (PRD v1.4). “Rules built + tested” means the deterministic logic is implemented and unit-tested, but the screens or vendor wiring come in the named phase.\n\n| Requirement | Title | Status | Where | Tests | Phase |\n|---|---|---|---|---|---|\n';
for (const r of T) tr += '| ' + r.join(' | ') + ' |\n';
writeFileSync('docs/traceability.md', tr);
console.log('docs generated:', resources.length, 'resources;', T.length, 'requirement rows');
