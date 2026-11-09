# Decision log

Format: ID · decision · status · owner · basis. **Proposed** items need sign-off from the named role before the pilot. Nothing here is a signed vendor, legal or partner commitment.

| ID | Decision | Status | Owner | Basis |
|---|---|---|---|---|
| D-01 | Production hosting: managed PostgreSQL (India region) plus serverless API, chosen on quotes and DPA terms | **Open** | Tech lead | §3; vendors not preselected |
| D-02 | Monorepo, TypeScript end to end; business rules in a pure `@pawsure/domain` package shared by API, jobs and PWA | Proposed | Tech lead | §3: keep business logic separate from UI and vendor adapters |
| D-03 | Local development and tests use PGlite (embedded PostgreSQL); production uses `DATABASE_URL` | Proposed | Tech lead | No Docker on the dev machine; the same SQL and triggers run in both |
| D-04 | The owner UI reuses the prototype's design system (board tokens, Baloo 2 / Nunito, pill components, line icons, mascot crops) | Agreed with the product owner | Design | Product owner instruction, 9 Nov 2026 |
| D-05 | The product name stays **Pawsure**; the design board's "PawKind" label is not used | Agreed with the product owner | Product | Product owner instruction, 9 Nov 2026 |
| D-06 | All vendors (SMS OTP, WhatsApp BSP, IVR, push, LLM, storage) are mock adapters until contracts exist | Proposed | Tech lead | §3, §10: never fabricate an integration |
| D-07 | The mock LLM is "unavailable", so the deterministic parser and manual form are the default parse path until an LLM is approved | Proposed | AI engineer | PS-125: the fallback is mandatory |
| D-08 | OTP: 6 digits, 5-minute expiry, 5 attempts, 30-second resend gap, 3 sends per 15 min; codes stored hashed with a server pepper; the same response whether or not the number exists | Proposed | Security | PS-001; §9 enumeration resistance |
| D-09 | Sessions: random 256-bit bearer tokens stored as SHA-256 hashes, 30-day expiry, revocable | Proposed | Security | §9 |
| D-10 | **Backups never give medicine.** Medicine tasks have no backup look-in step: owner alert at due +15, then cover suggestions at due +60 (friends who opted into medicines, with written instructions). A friend no-show on a medicine task goes straight to cover suggestions. Other timings stay relative to step 1: backup +30, cover +45 (walks +45 / +75 / +90). | **Agreed** (product owner, 9 Nov 2026) | Product | `backupAllowed()` in `escalation.ts`; 2 tests |
| D-11 | "Visit only" tasks (helper came, no task evidence) escalate exactly like missed tasks, including the backup look-in link; the alert says the visit was recorded | **Agreed** (product owner, 9 Nov 2026) | Product | PS-031; 1 test |
| D-12 | An arrival call with no exit counts as "visit in progress" for 45 minutes before it becomes "one call only" | Proposed | Product | Not specified in PRD 10.5 |
| D-13 | DEMO_MODE (adjustable clock, demo OTP in the response, `/demo/*` routes) is on only when `NODE_ENV` isn't production and `DEMO_MODE` isn't `0`; the server refuses to start without `OTP_PEPPER` outside demo | Proposed | Tech lead | Demos must never leak into the pilot |
| D-14 | App icon is an SVG paw on Golden Yellow; PNG 192/512 maskable icons are needed for wider install support | **Open** | Design | iOS / Android install quality |
| D-15 | Mascot illustrations are cropped from the board JPEG until designers export SVG/PNG | **Open** | Design | Image quality |
| D-16 | Demo household moved from Pune (prototype) to Powai, Mumbai, to match the pilot geography | Proposed | Product | Master prompt 2 §2 |
| D-17 | Today’s code is checked **on the server**: typed in the photo caption or keyed on the IVR. The app never trusts a provider claim that a code was “visible”. Reading the code from the image itself (OCR) sits behind an adapter and stays off until a vendor is chosen | Proposed | Tech lead | PS-024; never trust a client-side claim |
| D-18 | A new code card is created automatically for each household at the start of each month, and the owner is told to print it; owners can rotate at any time | Proposed | Product | PS-109: new card each month |
| D-19 | In demo mode a simulated helper phone posts to the real webhooks; in production owners never see a helper’s WhatsApp thread | Proposed | Product | Demo and testing only |
| D-20 | Friends use the same PWA: someone who signs in with no household but a friend link sees the friend view (requests, replies, visit details, F7 settings). WhatsApp buttons work too | Proposed | Product | PS-052, PS-060; no separate friend app |
| D-21 | Access details for a confirmed friend are an explicit grant that expires 2 hours after the task time and is revoked at once on completion, cancellation or a time change | Proposed | Security | PS-063, §9 “expiring access details” |
| D-22 | Until an LLM vendor is approved, the mock AI adapter answers with the deterministic rules parser in the same structured schema. The 8 s timeout, “unavailable” and “low confidence” paths fall back to the simple form and can be switched in demo mode | Proposed | AI engineer | PS-125 |
| D-23 | Live location sessions are stored only as start/stop records during an accepted visit and deleted 24 h later; no coordinates are stored until a location vendor is chosen | Proposed | Privacy | PS-054, §9 retention |
| D-24 | Staff use the same OTP sign-in; a `staff_roles` row grants one role (ops, ops lead, privacy lead, tech lead, auditor). Every console view and every refusal is written to the audit log | Proposed | Security | PS-070, §5 |
| D-25 | Earned points are written to the ledger when the day closes (once per task, enforced by a unique index); until then they are shown live. The 125-point monthly cap counts ledger points plus today's live points | Proposed | Product | PS-042, PS-126 |
| D-26 | Reporting cuts with fewer than 5 people are hidden, and the console never lists or ranks individual helpers | Proposed | Privacy | PS-117 |
| D-27 | The helper's shareable record shows counts only (verified records, streak, active since) behind a revocable random link; it is OFF until the flag is turned on | Proposed | Privacy | PS-104 |
| D-28 | A staff member closing a case, deciding a hold or closing a rights request must write a reason; for holds and rights the person concerned reads that reason | Proposed | Ops lead | PS-034, PS-044, PS-119 |
| D-29 | WhatsApp and call alerts fall back to SMS after one retry; OTP has no fallback (the user asks again). SMS fallback needs a DLT-registered alert template before launch | Proposed | Ops lead | §16 Phase 5 vendor failover |
| D-30 | Recovery targets: managed Postgres RPO 5 min / RTO 1 h; PGlite single host RPO 24 h / RTO 30 min. Restore drill weekly during the pilot | Proposed | Tech lead | §9 encrypted backups and tested restore |
| D-31 | Retention runs once per IST day; image hashes are kept after photos expire so reused photos are still rejected (a hash is not the image) | Proposed | Privacy lead | §9 retention, PS-122 |
| D-32 | Random photo checks are chosen per task with a server secret (1 in 5 without a gate app or after a mismatch in 14 days, else 1 in 10) and only asked of helpers who don't already send photos | Proposed | Product | PS-026, scenario #5 |
| D-33 | Spam limits: 10 cover requests per household per hour, 20 friend invites per day; configurable | Proposed | Security | §9 request spam |
| D-34 | A helper's “delete my data” stops check-ins at once (like “stop”); the privacy lead reviews what can be erased, keeping records others rely on for their retention period | Proposed | Privacy lead | PS-119, scenario #17 |
| D-35 | Rewards arms are assigned by stratified shuffle (gate app yes/no) from a recorded seed so the split can be reproduced | Proposed | Ops lead | PS-126 |
