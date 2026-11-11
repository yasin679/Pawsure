---
id: PS-RN-07
title: Release Notes v1.0.1
subtitle: Pawsure P0 pilot build — what’s included, what was fixed, and what is still open
audience: Everyone
---

# Release Notes v1.0.1

## 1 About this release

Pawsure 1.0 is the first complete P0 build; 1.0.1 fixes the issues reported after the first review (section 6) for the 20-home pilot in Andheri–Powai, Mumbai. It covers own-helper care with an honest evidence layer, the AI Friend Finder, the operations console, privacy rights and the pilot-readiness tooling. It is built from PRD v1.3 and Master Prompt 2.

| Item | Value |
|---|---|
| Version | 1.0.1 (P0 pilot build) |
| Date | 11 Nov 2026 (1.0: 10 Nov 2026) |
| Repository | github.com/yasin679/Pawsure |
| Shareable demo | A private Claude artifact (the whole app runs in the visitor’s browser) |
| Tests | 211 API, rules and database tests; 90 end-to-end browser tests; all 24 mandatory P0 scenarios — all passing |

## 2 What’s included

### 2.1 For pet owners

- **Today:** who’s caring (tracked helper, Trusted Helper mode, nobody yet, a friend), the plan with an evidence label for every task, visit evidence shown separately, timeline and day report.
- **Leaving and returning:** 30-second checklist, alone-window warning against your own limit, 10-second return check that can match or contradict tasks.
- **Alerts:** missed check-ins alert you, then your backup with a 15-minute look-in link, then suggest cover; medicine is never passed to a backup.
- **SOS:** S1, S2 and S3 incidents with automatic call plans, the vet notice and resolution notes.
- **Pets:** profiles, emergency card, routine (changes start tomorrow), health calendar with reminders.
- **Helper:** WhatsApp invitation and consent in English, Hindi or Marathi; photo, voice or missed-call methods; the monthly food-box code card with rotation; random photo checks.
- **Care circle:** co-owner, backup, family and viewer roles; removal within 60 seconds on every channel.
- **Find cover:** ask in your own words or the simple form; friends-first, nearest-first suggestions with reasons; explicit approval; messages in each friend’s language; ask one or ask all 3; proposed times; confirmation with minimum, time-limited access; no-show handling.
- **Friends:** invitations, profiles, block and report, privacy panel (society and tower only).
- **Wallet:** helper points from your home only. **Data rights:** see your data, requests with a 7-day target.

### 2.2 For helpers, friends and the care circle

- Helpers use WhatsApp or a basic phone: task prompts, **points**, **share**, **my data**, **delete my data**, **stop**, **help**.
- Friends reply on WhatsApp or in the app, and control findability, pauses, free times, tasks, keys, language and live location.
- Backups and family get a care-circle home with today’s timeline and alerts; helpers get a helper home.

### 2.3 For the operations team

- Operations console with role-limited sections: pilot overview against the gates, service health, queues, households, method mix, signals, Friend Finder, switches, pilot readiness, rewards holds, rights requests, audit log and breach runbook.
- Vendor failover with a delivery log, 13 monitoring checks with on-call alerts, daily retention, encrypted backups with a restore drill, load test, cohort assignment.
- Documentation: this document set (PS-UG-01 to PS-TE-08), generated API reference, permission matrix, traceability, decision log, runbooks.

## 3 Fixes made during testing

| Area | Fix |
|---|---|
| Find cover | Confirming a friend moved unrelated tasks (another pet, medicine) to them; only matching tasks move now. |
| Find cover | Today still said Find cover was coming; it now links to Find cover with a pre-filled request. |
| Find cover | The request kept the old time after a friend’s proposed time was confirmed. |
| Find cover | “Parsed by AI” was shown although no AI model is connected; it now says *understood by rules (no AI connected)*. |
| Today | Didn’t refresh when returning from Find cover; the SOS confirmation appeared behind the open sheet. |
| Console | Breach rehearsal showed *Past due* in the demo; a leftover style capped the console width. |
| Demo | Backup look-in link couldn’t open in the shared demo; Meera and Farhan were missing from the friends’ phones. |
| Wording | Gender-neutral texts for helpers and in the Hindi friend message. |

## 4 Security changes

| Change | Why |
|---|---|
| Sign-out ends the session on the server, clears cached data and screen state; **Sign out of all devices** | The next person on a shared phone could see the previous person’s data; old tokens stayed valid |
| Job runner and webhooks require secrets and refuse to run without them | They were open in production if the secret wasn’t set |
| zod 4.6.7 and @hono/node-server 2.1.5; 64 KB request limit; security headers | Known vulnerabilities in the previous versions |
| Helpers see only their own helper record | A helper could list other helpers |
| Helper, care-circle and staff logins get their own home screens | These logins previously landed in the owner app |

## 5 Upgrade notes

- New required settings outside demo mode: `JOB_SECRET` and `WEBHOOK_SECRET` (see PS-IG-02 section 3). Vendors must send the webhook secret in `x-webhook-secret`.
- `CODE_CARD_KEY` is 32 bytes **base64** (the earlier template said hex).
- Migrations `001`–`005` run at start-up and only add tables and columns.

## 6 Fixes in 1.0.1 (11 Nov 2026)

| Reported issue | Cause | Fix |
|---|---|---|
| Couldn’t request another sign-in code after the 30 seconds | The demo’s clock only moved with the demo buttons, so the 30 seconds never passed | The demo clock runs in real time (the buttons still jump it forward) |
| Blocked from signing in again after logging out | Same clock, plus used codes counted toward the resend limits | Used codes no longer count; verify always checks the newest unused code |
| A pet could be added with only a name | Only the name was required | Food and feeding, allergies, medicine instructions and the vet’s name and phone are required (*None* allowed), in the app and on the server |
| Blank owner screen and dead tabs after returning from the Ops console | Signing in to the console replaced the owner’s sign-in on the same device | The owner app and the console keep separate sign-ins; an account without a household returns to setup instead of a blank screen; leaving setup part-way resumes it |

## 7 Known limitations

- No vendor is connected (SMS, WhatsApp, IVR, push, AI, storage are mock adapters); no staging or pilot environment yet.
- No AI model is connected; requests are understood by rules.
- No photo OCR: codes are read from captions or the keypad.
- No live location coordinates; no coupon vendor.
- Owner app in English only; helper and friend messages in English, Hindi and Marathi (native-speaker review pending).
- Code-card **Print** does not work inside the shared demo frame.
- Developer-tool dependencies (Vitest, Vite) need major upgrades before shared CI.
- Release gates outside the software: legal review, helper acceptance and usability tests, vendor quotes, ops rota, trademark check (`docs/runbooks/pilot-runbook.md`).
