# Pawsure: P0 pilot application

*Be sure, whoever's caring.* This is the working implementation of Pawsure P0, built from PRD v1.3 and Master Prompt 2. It is a real build, not a mock-up: the owner PWA talks to a real API and database, and the rules engine behind every confidence label is unit-tested.

The visual design matches the interactive prototype (`../Prototype`): the same tokens, components, icons and mascot illustrations.

## Status: end of Phase 5 (QA and pilot readiness)

| Area | State |
|---|---|
| Rules engine (`packages/domain`) | **Done and tested.** Confidence v1, visit vs task, lifecycle, escalation and look-in links, covered day, emergency severity, rewards, code cards, permission matrix, and Friend Finder parsing, matching and the request state machine with timers |
| Database (`packages/db`) | **Done and tested.** Full P0 schema with an append-only audit log, task events and consents; idempotency keys; event vs received time; PGlite locally, PostgreSQL in production |
| API (`apps/api`) | Phase 1 plus **Phase 2**: routine (edits take effect tomorrow), who’s caring, can’t-come, leaving checklist, I’m back + return check, timeline, day report, day close (PS-111 stored with the rule version); helper invite → consent in en/hi/mr → method → stop/start; task prompts; a monthly encrypted code card with rotation and server-side code checking; IVR keypad codes; backup look-in page; incidents with the severity job; health calendar + reminders; care circle invite/accept/revoke. One `/jobs/tick` runs prompts, escalations, incidents and reminders idempotently **Phase 3**: F1 privacy, friends list/invite/profile, block/report; Ask Pawsure with the 8 s AI timeout and manual fallback; clarifications; deterministic search; explicit approval; WhatsApp requests in the friend’s language; replies (buttons, free-text times, idempotent); the full request lifecycle and timers; access grants; cover tasks; friend-side endpoints |
| Owner PWA (`apps/web`) | Onboarding; Today (who’s caring, can’t-come, alone-window warning, leaving checklist, I’m back, return check, alerts, incidents, evidence, task changes, timeline, day report); Pet (profile, emergency card, routine editor, health calendar); Me (helper & code card, care circle, invitations); backup look-in page. **Demo only:** clock + Sunita’s simulated phone. Find cover (Ask Pawsure, review, simple form, suggestions, approval, request detail), Friends (list, invite, profile, block/report), Me → what friends see; **friend view** for invited friends (requests, visit details, F7 settings). Demo: clock, Sunita’s phone, friends’ phones, AI mode switch |
| Vendors | **None connected.** Every vendor is a mock adapter (`apps/api/src/adapters.ts`) |

Tests: **180 passing** (`npm test`): 80 domain, 4 database, 96 API integration, security and acceptance. **All 24 mandatory P0 scenarios** (§13) map to passing tests: see `docs/test-report.md` (`npm run report`).

**Phase 5** adds what a pilot needs to run safely:
- **Vendor failover:** every message is retried once, then sent by SMS fallback; every attempt is in a delivery log with masked recipients. OTP never fakes success (503).
- **Monitoring and alerting:** 13 service checks from the monitoring plan (job runner, alert delay, delivery, webhooks, OTP abuse, API p95, errors, stuck requests, S1, rights age, AI fallbacks, database, retention). A check turning red opens one ops case and pages on-call. Console → **Service health**; `GET /ready` for uptime monitors.
- **Retention** (§9) runs once per day: photos/voice refs after 90 days (kept while disputed), request text after 90 days, live location after 24 h, opted-out friend profiles after 30 days, message metadata after 12 months; image hashes are kept so reused photos are still caught.
- **Encrypted backups and a restore drill** (AES-256-GCM, manifest with row counts; restore verified table by table and the audit log checked still append-only).
- **Security red-team suite:** tenant isolation and IDOR across all household routes, staff vs household data, enumeration, OTP lockout, sign-out and sign-out everywhere, link guessing, webhook spoofing, media/code leakage, injection, spam limits, audit immutability. It found and fixed: incident ack/resolve on an unknown id returned 200.
- **Random photo checks** (1 in 5 without a gate app, 1 in 10 otherwise) are now sent in task prompts, chosen with a server secret.
- **Helper “delete my data”** on WhatsApp creates an erasure request and stops check-ins at once.
- **20-home cohort:** Console → **Pilot readiness** checks the §4.2 switches and assigns the rewards arm to half the homes, balanced by gate app, from a recorded seed.
- **Load test:** p95 179 ms at pilot load in-process (target < 500 ms); 200 homes checked for scale (`npm run load-test`).
- **Hand-over docs:** `docs/api.md` (generated, 112 routes), `docs/runbooks/` (pilot, monitoring, support, deployment and rollback, restore with RPO/RTO, vendors and credentials, drills), `docs/known-limitations.md`.

**Phase 4** adds the operations console at `/admin` (staff sign in with OTP; each role sees only its sections; every view and refusal is in the append-only audit log; phone numbers are masked), live pilot metrics against the proposed gates, ops queues with closing reasons, method-mix cuts with groups under 5 hidden, feature switches by default and by household (locked ones can’t be changed), reward holds decided with a reason the helper reads, rights requests with the 7-day target and 90-day limit, and the breach runbook with a 72-hour clock. Owners get **Wallet and points** and **Your data rights** (see and save their data, make a request, consents). Helpers can reply “points”, “share”, “stop link” and “my data” on WhatsApp, and get a weekly points message on Sunday evening.

Demo staff numbers for `http://localhost:5173/admin`: ops 98110 00001, ops lead 98110 00002, privacy lead 98110 00003, auditor 98110 00004.

## Run it locally

Needs Node 20+. No Docker and no database server: local data lives in `apps/api/.data/pglite`.

```bash
npm install
```

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open http://localhost:5173. In demo mode the API returns the OTP on screen instead of sending an SMS. Sign in as Neha (owner) with `98000 00021`, or as a friend: Priya `99000 00012`, Arjun `98000 00077` (Hindi). The dark **DEMO** bar moves the simulated clock. **Show Sunita’s phone** opens a simulated helper phone that answers prompts, sends photos with the typed code, voice notes, missed calls, problem reports and stop/start, all through the real webhooks.

```bash
npm test
```

```bash
npm run typecheck
```

## Layout

```
packages/domain   pure business rules + unit tests (no I/O)
packages/db       SQL migrations, PGlite/Postgres client, demo seed + tests
apps/api          Hono API, vendor adapters (mock), jobs, integration tests
apps/web          React + Vite PWA (design system shared with the prototype)
docs/             architecture, decision log, permission matrix, traceability
tools/            gen-docs (permission matrix, traceability), gen-api-docs, test-report,
                  load-test, backup-now, restore-drill
```

## Shareable demo (no server)

`npm run build:demo -w @pawsure/web` builds a version where the real API and database (PGlite) run inside the visitor's browser, with the demo household and mock vendors. It is static files (`apps/web/dist-demo`), published as a private Claude artifact for sharing. Each visitor gets their own copy that resets when the page reloads; nothing is sent anywhere, no real SMS or WhatsApp. The ops console is at `#admin` (or the **Ops console** button in the demo bar). This is for showing the product, not for the pilot (decision D-36).

## Configuration

Copy `.env.example`. **Never commit real secrets.** Outside demo mode the API refuses to start without `OTP_PEPPER`, and all demo routes, the demo clock and on-screen OTP codes are disabled.

## Next phases (from Master Prompt 2 §16)

- **Phase 2, daily care and helper: done.** Still to come: the helper’s weekly points message and shareable record (PS-104/105, with the Phase 4 rewards work), photo code reading (D-17), and the real WhatsApp/IVR vendors.
- **Phase 3, Friend Finder: done.** Still to come: real LLM and speech-to-text vendors, live location coordinates (D-23), friend thank-you points (switch OFF), nearby-member fallback (locked OFF until ID checks).
- **Phase 4, ops, privacy and rewards: done.** Still to come: coupon redemption with a vendor, legal review of the rights and breach wording, a BI export beyond CSV, and helper-side rights answers in hi/mr reviewed by native speakers.
- **Phase 5, QA and pilot readiness: done in software.** Still open before go-live: vendor contracts and real adapters, a staging environment with an HTTPS load test, legal and native-speaker reviews, the named ops rota, and the §14 field tests. See `docs/runbooks/pilot-runbook.md` (go / no-go) and `docs/known-limitations.md`.

Release blockers that are still open are listed in `docs/decision-log.md` and `docs/traceability.md`.
