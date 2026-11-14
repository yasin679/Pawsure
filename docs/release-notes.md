---
id: PS-RN-07
title: Release Notes v1.1.0
subtitle: Pawsure P0 pilot build — cover continuity (PRD v1.4), fixes, and what is still open
audience: Everyone
---

# Release Notes v1.1.0

## 1 About this release

Pawsure 1.1.0 adds **cover continuity** from PRD v1.4 (revised 12 Nov 2026): Pawsure now checks *before* a visit that someone is coming, tells the owner early when a task is at risk, asks the owner’s own backups in order, and never lets a must-happen task slip silently. It also fixes six issues found in demo testing on 10 Nov 2026. Everything from 1.0.1 is unchanged.

| Item | Value |
|---|---|
| Version | 1.1.0 (P0 pilot build) |
| Date | 13 Nov 2026, QA update 14 Nov 2026 (1.0.1: 11 Nov 2026; 1.0: 10 Nov 2026) |
| Source of truth | PRD v1.4, sections 7.7, 9.6, 8.8 (PS-127 to PS-141), 9.5, 10.4, 16.3, 17.1, Appendix F |
| Repository | github.com/yasin679/Pawsure |
| Database | Migration `006_cover_continuity.sql` (adds tables and columns only), with a rollback script |
| Tests | 357 API, rules and database tests (211 in 1.0.1); 125 end-to-end browser tests (90 in 1.0.1); all 24 mandatory P0 scenarios and all 14 new v1.4 scenarios. QA update 14 Nov: migration `007_qa_consolidated.sql` |

## 2 What’s new: cover continuity

| Requirement | What it does |
|---|---|
| PS-127 Reminder | One reminder per visit, 90 min before (8 PM the evening before for visits before 10 AM): **Yes, I’ll do it** · **Can’t make it** · **Send someone else**; basic phone: press 1 / 2 / 3. Trusted helpers only if the owner turns it on; co-owners get it in the app. A Yes is never evidence. |
| PS-128 Can’t come | The helper (or a backup who said yes) can say “can’t come” at any time, by button, free text in English, Hindi or Marathi, or IVR 2. The owner is told at once and that person’s access to the visit is removed. A substitute she names gets nothing until the owner approves, then a one-time task link. |
| PS-129 At risk | Orange on Today with the reason and the next step: can’t make it, can’t come, a friend cancelling, or no reply 45 min before the task. |
| PS-130 Backups | Ordered list of up to 5 (Me → Backups), with key holders, medicine permission and “owner-arranged, not verified by Pawsure” for paid walkers. With the owner’s opt-in standing approval they are asked two at a time, 10 min per pair, key holders first; otherwise one tap. First yes → 10-minute hold; a must-happen task from a pre-approved backup is confirmed automatically. |
| PS-131 Cutoff | Friend Finder only until 30 min before the task. After that it is skipped (“too close to the task for Friend Finder”); a friend cancelling after the cutoff goes to the backup list. |
| PS-132 Urgency | Can wait · Time-sensitive · Must happen, with defaults by task type and a hot-day switch for water. Must happen: no Skip, alert at due + 15, and the whole care circle is called 15 min after cover not found if the owner hasn’t responded. |
| PS-133 Cover not found | Message + automated call with the task, who was asked and when the pet was last fed or watered: I’ll handle it · Ask someone else (one-time 15-minute link) · Ask my whole care circle · Move or skip (as urgency allows). Not counted as covered unless done with evidence or matched. |
| PS-134 Before you leave | If anything today has nobody confirmed, “I’m leaving” shows who and six options. Leave anyway marks the day **No cover planned**. The leaving check asks for a plan B. More than 3 h before the task: backups asked together with a 60-minute window. |
| PS-135 Thin circle, advisory | Weekly warning when fewer than 2 people hold a key. Ops can send a cluster advisory the evening before a likely mass absence; tomorrow’s reminders then go out that evening. |
| PS-136 I’m delayed | New return time → tasks that now fall while out, alone window and medicine → the current caregiver is asked first (Yes / Only until / Can’t) → a request for the uncovered part only. |
| PS-137 Gate and key | For anyone new to the home: approve in the gate app (owner action; no integration) and choose the key plan; one reminder at task − 15. |
| PS-138 Handling note | A short note on the pet profile. Anyone covering for the first time must confirm they read it before they can say yes. |
| PS-139 One named carer | Every task names one person; a co-owner with a task gets the same reminder. |
| PS-140 Newcomer | “Do you have anyone who can look in on your pet?” → an honest message and four ways to build a circle. No day-care list. |
| PS-141 Same-society fallback | Built behind a switch that is **OFF and locked** until the verification rule is decided. |
| 16.3 Metrics | Six new console metrics: pre-task confirmation, at-risk rescue, cover-not-found (with the 10% review line), time to cover, no-cover-planned days, circle depth. |

## 3 Fixes from demo testing (10 Nov 2026)

| # | Issue | Fix |
|---|---|---|
| 1 | **High.** A request sent at the cutoff let the friend say Yes, then Confirm said “Expired, nobody accepted” | New requests are blocked at the cutoff with a clear message; a Yes received before the cutoff is honoured until its hold ends (or the task time) |
| 2 | At 4:30 an unconfirmed 1 PM task still said “backup is alerted at 2:00 PM if you don’t acknowledge” | Past tense once the time has passed (“Your backup was alerted at 2:00 PM.”) |
| 3 | “Planned” appeared twice on each task card | Shown once; the new cover line replaces the second |
| 4 | The request said “understood by rules (no AI connected)” while the AI switch said “working” | The switch is now “Request parser: rules (no AI connected)”, and its other options say “simulate …” |
| 5 | The welcome mascot sat on a visible beige box | Uses a transparent image |
| 6 | Demo layout and developer wording | Simulated phones sit beside the owner app on wide screens; presenter-visible labels no longer mention webhooks |
| 7 | No way to plan from Today, or to add a task for today only | **Edit routine** next to *Plan & evidence*; new tasks can be **Just for today** (added at once, never repeated) |
| 8 | A task added for today only would have repeated every day | One-off tasks are planned on their own day only and drop off the routine list afterwards |
| 9 | “Call your backup” in the shared demo showed “This content is blocked” | In the demo, call and WhatsApp buttons show a simulated notice; the sign-in screen lists every demo number |

### 3.1 QA defect tracker (13 Nov 2026)

From *Pawsure_QA_Defect_Tracker.xlsx* (16 items). Each item now has a test: `apps/api/test/qa-defects.test.ts`, `packages/domain/test/friendfinder-idempotent.test.ts` and `e2e/13-qa-defects.spec.ts` (Q1–Q5).

| ID | Finding | Fix |
|---|---|---|
| PAW-001, 005 | An unsent request offered only **Cancel**; editability by state was not defined | **Edit request** while Draft, Ready for search or Awaiting owner approval; after sending, a reason is shown and the server refuses edits with a plain message |
| PAW-002, 008 | A New task with no name showed `title: Invalid input: expected string, received undefined` | The name is the first field and required; “Give the task a name.” by the field before anything is sent; the server gives the same plain message. Medicine tasks need written instructions on both sides |
| PAW-003 | Repeated Draft → Ready → Awaiting cycles in the history | Re-selecting a value already chosen records nothing; each real edit records one “Owner edited the request” |
| PAW-004 | History filled the screen | Latest 3 events, **View all (n)** for the rest |
| PAW-006 | Pet profile changes did not reach an unsent request | The medicine question quotes the current profile; a later change is flagged and search uses the new text |
| PAW-007 | Two requests could be out for the same visit | A second request for the same pet, day and task within 30 min can’t be sent; Suggestions offers **Open it** |
| PAW-012 | Times only to the minute, and from the database clock | Every event has an exact time from the app clock, shown to the second |
| PAW-013 | Leaving New task lost typed work; the simple form reset on a tab switch | Discard prompt on New task; the simple form keeps its values |
| PAW-014 | A second Confirm, Cancel or Send returned an error, and two at once could both run | Repeats are ignored (200, nothing re-sent); one owner action at a time per request; buttons are disabled while saving |
| PAW-015 | Switching the pet on a medicine request kept the first pet’s medicine instructions | The new pet’s own instructions are used, or the owner is asked when it has none |
| PAW-016 | Approving after an edit gave a bare `search_first` | “The request has changed since the suggestions were made. Search again before sending.” with a **Search again** button |
| PAW-009, 010, 011 | Proposed tests | Passed with no change: start dates by India time (also just after midnight), one must-happen alert at +15 min and none for a task with evidence, co-owner reminder only to the co-owner |

### 3.2 QA consolidated tracker (14 Nov 2026)

From *Pawsure_QA_Consolidated_Tracker_2026-11-14.xlsx* (PAW-017 to PAW-062 and audit risks R-01 to R-20). Every item was run, mostly with the demo clock moved across minutes and days, including a **7-day run** (6 to 12 Nov) that covers the 6-day pause. Tests: `apps/api/test/qa-consolidated.test.ts` (35), `packages/domain/test/friendfinder-qa-consolidated.test.ts` (4), `e2e/14-qa-consolidated.spec.ts` (R1–R6).

**Defects found and fixed**

| ID | Finding | Fix |
|---|---|---|
| PAW-029, R-05 | **Pause for the next 6 days** was worked out on the phone in UTC (a day short just after midnight in India); the switch showed *off* during the pause; turning the switch off did not end it | The server sets the end in India time, with today as day 1. The switch shows the last paused day and the day requests return, and turning it off ends the pause at once. Over 7 days on the clock: paused from 00:00 to 23:59 on days 1–6 and back on day 7. **Friends can find me** set to OFF stays off when a pause ends |
| PAW-030, R-13 | Overnight hours (9 PM to 6 AM) never matched; the time picker stopped at 10:30 PM | Free times can run past midnight and are shown as “(next day)”. Boundaries were checked (free 4:30–9 PM: 4:15 no, 4:30 yes, 8:50 for 10 min yes, 8:55 for 10 min no). A window with the same start and end is refused |
| PAW-034 | A friend with any confirmed visit, on any day and at any time, was treated as busy; capacity was fixed at one | Busy now means pets already agreed at an **overlapping** time on the same day, in any home (confirmed, on hold, or a Yes waiting for the owner) |
| PAW-043 | Two owners could both confirm the same friend for overlapping visits | The second confirmation is refused: “Priya has just been booked for another visit at that time. Ask someone else.” |
| PAW-054 | A Yes in the app and a Yes on WhatsApp at the same moment counted twice (two owner alerts); a second **Done** could count a help twice | Replies are handled one at a time per request and a repeated Yes changes nothing; Done is counted once |
| PAW-025, PAW-021 | A helper could answer another helper’s task by keypad; today’s code typed from an unregistered phone counted | A keypad code counts only from the assigned helper (`not_your_task` otherwise), never from an unknown number |
| PAW-047 | A second “I’ve arrived” added another check-in; Done or Cancel after the visit ended gave a server error | A repeat check-in changes nothing; late or repeated taps get a plain reason (409), never an error page |

**New, from the tracker’s enhancement items**

| ID | What was built |
|---|---|
| PAW-017 | **Edit profile** in Me → Profile and privacy: name, city, society, tower, flat. Owners and co-owners only. Each change is logged (which fields, never the values) and every owner is told; a friend already confirmed sees the new address |
| PAW-018, PAW-036, R-11 | Sign-up asks for the **city first**, then the society from that city’s list. Two societies with the same name in different cities stay separate, and a society from another city is refused. A society that isn’t listed can be typed; it is marked *Not verified yet* |
| PAW-019 | Helpers can’t edit the home’s details (they are the owner’s), but **Wrong society or tower? Tell the owner** opens a support case and alerts the owner |
| PAW-026 | Friends choose **how many pets at once** (1–4) and which kinds (dogs, cats, other). Matching respects both |
| PAW-033, R-02 | **Several pets in one request**: checkboxes on the simple form and on Check the details; the rules parser understands “both” and two names. The message names every pet, medicine instructions are per pet (“Bruno: …”), and the cover task names them all |
| PAW-040 | A friend too far away to arrive in time (by distance band) isn’t suggested |
| PAW-041, PAW-051 | **I’m running late** for a confirmed friend (app, or “late 20” / “10 min late” on WhatsApp or SMS). The owner gets the new arrival time, and the no-show alarm waits for it (up to 80 minutes after the task) |
| PAW-056 to PAW-062 | **Emergency — I have to leave**: the friend ticks what was already done. The visit is *Interrupted*, never *Completed*. The work done is recorded (*Partly done*), the owner and co-owner get an urgent alert and a call, the access details are removed and the ordered backups are asked at once. Also works as “emergency, done feed” on WhatsApp or SMS. A later Done, arrival or second alert changes nothing |

**Passed with no change** (each has a test): PAW-020, 022, 023, 024, 027, 028 (a pause now also says how many confirmed visits stay booked), 031, 032, 035, 037, 042, 044, 048, 050, 052, 053, 055, 058; R-01, R-04, R-06, R-08, R-10, R-12, R-14, R-15, R-17, R-20.

**Not built, by decision**: route distance, live traffic ETA and GPS checks (PAW-039, PAW-045, PAW-046): Pawsure keeps no coordinates (D-23) and shows distance as bands; this needs a maps-provider decision. Nearby societies (PAW-038) stay behind the locked switch (PS-062). Telugu and Kannada (R-18) are not supported yet; they are refused, not half-translated. Friends need WhatsApp (PAW-049); basic phones work for helpers and backups. Breed and behaviour compatibility (R-16) goes no further than the large or anxious dogs choice and the handling note.

### 3.3 New look (15 Nov 2026)

- **Theme:** sage green, cream and a touch of gold, with softer buttons and cards.
- **Splash:** sage gradient with the Pawsure paw mark, shown for at least 1.5 seconds.
- **Sign-in:** opens straight on **Log in or create an account**: mascot, mark, one line, the number and **Send code**. Demo numbers sit behind **Try a demo number**.
- **Phone frame:** on a laptop or tablet the app shows inside a phone with a status bar; on a phone it fills the screen.
- **Pawly:** **Find with Pawly** shows the friend search step by step, then how many friends were found. A new **No friend is free right now** page offers another time, any distance, invite a friend and call your backup.
- **Demo tools hidden:** the dark demo bar no longer shows on every page. A small **Demo tools** switch beside the phone (or **#tools** in the address) brings it back. The scenario and request-parser menus are gone.
- **Plainer words:** long explanations cut to one short line, and the long dashes replaced with commas, in the app and in the WhatsApp and SMS messages.

## 4 Upgrade notes

- QA update (14 Nov): migration `007_qa_consolidated.sql` adds friend capacity and species, a society list (name + city) and the home’s city, state and society id. Existing homes keep their society text; open Edit profile to pick the city and listed society. Rollback: `packages/db/rollback/007_qa_consolidated.down.sql`.
- Migration `006_cover_continuity.sql` runs at start-up and only adds tables and columns. Rollback: `packages/db/rollback/006_cover_continuity.down.sql` (by hand, after a backup; it removes all cover data).
- New households start with standing approval **off**. Owners turn it on in Me → Backups.
- No new settings are required. Timings can be overridden per household (`households.cover_config`) or per routine task (`routine_tasks.cover_config`).
- The job runner (`POST /jobs/tick`, every minute) now also sends reminders, runs the backup list, the cutoffs, holds, cover-not-found calls, checklist reminders, the weekly thin-circle check and advisories. All steps are idempotent.
- Nine new WhatsApp utility templates (en/hi/mr) are listed with their approval status in the console (Cover continuity) and `apps/api/src/coverTemplates.ts`. None is submitted to Meta yet.

## 5 What 1.0 and 1.0.1 included

Own-helper care with an honest evidence layer, alerts and escalation, SOS, pets and routine, the AI Friend Finder (rules-based while no AI model is connected), friends, care circle, wallet and data rights, the operations console, vendor failover, monitoring, retention and backups; and the 1.0.1 fixes (sign-in code resend, re-login, required pet details, separate owner and console sign-ins).

## 6 Known limitations

- No vendor is connected (SMS, WhatsApp, IVR, push, AI, storage are mock adapters); reminders, calls and advisories are recorded, not sent. No staging or pilot environment yet.
- The cover templates are drafts; Hindi and Marathi wording needs native-speaker and worker-dignity review.
- The weekly thin-circle check tests key holders only (no availability data for backups yet).
- Society invite links and pet-parent swaps are recorded but have no join page or matching yet.
- The reminder adds about 30 WhatsApp utility messages per household per month; it must be costed against the ₹10 per household gate once a provider quote exists.
- Distance is shown as bands, with no route distance, live traffic or GPS check (D-23). Telugu and Kannada are not supported. Friends need WhatsApp.
- Owner app in English only; no photo OCR; no live location coordinates; no coupon vendor; code-card **Print** does not work inside the shared demo frame.
- Release gates outside the software: legal review, helper acceptance and usability tests, vendor quotes, ops rota, trademark check (`docs/runbooks/pilot-runbook.md`).

## 7 PRD gaps found and decisions taken

The PRD is silent or ambiguous on these; each is recorded in `docs/decision-log.md` (D-40 to D-51) for sign-off:

- **Evening reminders:** no deadline is given for a reminder sent the evening before; Pawsure uses 45 minutes after the reminder (D-40).
- **“I’m leaving” warning:** read literally, it would warn every morning before reminders go out; it warns only for tasks known to be uncovered (D-41).
- **Medicine and backups:** PS-130 doesn’t say who may give medicine; only backups the owner marks for it are asked (D-42).
- **I’m delayed (17.1 row):** “the 7:30 dinner is added” and “Only until 8 creates a request for the dinner only” can’t both hold; the demo uses a 7:30 walk and an 8:30 dinner (D-47).
- **Friend reminders:** PS-127 includes confirmed friend cover; 1.1.0 relies on the friend’s own confirmation and no-show rule instead of a second reminder (D-48).
