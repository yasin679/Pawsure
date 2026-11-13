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
| Date | 13 Nov 2026 (1.0.1: 11 Nov 2026; 1.0: 10 Nov 2026) |
| Source of truth | PRD v1.4, sections 7.7, 9.6, 8.8 (PS-127 to PS-141), 9.5, 10.4, 16.3, 17.1, Appendix F |
| Repository | github.com/yasin679/Pawsure |
| Database | Migration `006_cover_continuity.sql` (adds tables and columns only), with a rollback script |
| Tests | 301 API, rules and database tests (211 in 1.0.1); 110 end-to-end browser tests (90 in 1.0.1); all 24 mandatory P0 scenarios and all 14 new v1.4 scenarios |

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

## 4 Upgrade notes

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
- Owner app in English only; no photo OCR; no live location coordinates; no coupon vendor; code-card **Print** does not work inside the shared demo frame.
- Release gates outside the software: legal review, helper acceptance and usability tests, vendor quotes, ops rota, trademark check (`docs/runbooks/pilot-runbook.md`).

## 7 PRD gaps found and decisions taken

The PRD is silent or ambiguous on these; each is recorded in `docs/decision-log.md` (D-40 to D-51) for sign-off:

- **Evening reminders:** no deadline is given for a reminder sent the evening before; Pawsure uses 45 minutes after the reminder (D-40).
- **“I’m leaving” warning:** read literally, it would warn every morning before reminders go out; it warns only for tasks known to be uncovered (D-41).
- **Medicine and backups:** PS-130 doesn’t say who may give medicine; only backups the owner marks for it are asked (D-42).
- **I’m delayed (17.1 row):** “the 7:30 dinner is added” and “Only until 8 creates a request for the dinner only” can’t both hold; the demo uses a 7:30 walk and an 8:30 dinner (D-47).
- **Friend reminders:** PS-127 includes confirmed friend cover; 1.1.0 relies on the friend’s own confirmation and no-show rule instead of a second reminder (D-48).
