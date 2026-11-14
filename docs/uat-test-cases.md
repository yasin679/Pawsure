---
id: PS-UAT-06
title: UAT Test Cases
subtitle: 123 acceptance test cases with steps, expected results and the latest result
audience: Testers, product owner and sign-off owners
---

# UAT Test Cases

## 1 About these test cases

Each case below is also an automated end-to-end test (Playwright, in Chrome) that drives the real screens against the demo build. A tester can run it by hand with the steps shown, or all of them with `npm run e2e`. The **P/F** column shows the result of the latest automated run.

| Item | Value |
|---|---|
| Latest run | 15 Nov 2026, 00:47 IST |
| Result | **123 of 123 passed** |
| Build | Demo build (the real app, API and database in the browser), Chrome, 390 px phone width; console at 1280 px |
| Demo numbers | Owner 98000 00021 · Co-owner 98000 00022 · Backup 97000 00008 · Helper 90000 00035 · Friends 99000 00012, 98000 00077, 97000 00090 · Staff 98110 00001–4 |
| Evidence | PS-TE-08 Test Evidence workbook; `e2e/report` (HTML report with traces on failure) |

Priority: **H** high (sign-in, daily care, helper check-ins, Find cover, security, cover continuity), **M** medium.

> [!NOTE]
> The demo clock starts at 9:00 AM on 6 Nov 2026 and runs in real time. Steps that say “clock to” or “advance” use the demo bar (**+5m**, **+15m**, **+1h**). Helper, friend and backup replies use the simulated phones (**Show Sunita’s phone**, **Show friends’ phones**, **Show backups’ phones**).


## 2 Sign-in and onboarding

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| A1 | H | New owner signs up: phone, code, consents, profile, then lands on Today | 1. Open the app: Log in or create an account<br>2. Enter 98112 22333, Send code<br>3. Enter the code shown, Verify<br>4. Tick Terms and Privacy, Continue<br>5. Enter name, city, society, tower, Continue | Today opens greeting the new owner | Pass |
| A2 | H | Consent is required: continuing without Terms and Privacy shows an error | 1. Sign in with a new number<br>2. Tap Continue without ticking Terms/Privacy | Error: please accept the Terms and the Privacy Notice | Pass |
| A3 | H | A wrong code is refused with a clear message | 1. Enter Neha’s number, Send code<br>2. Enter 000000, Verify | Error: code doesn’t match | Pass |
| A4 | H | An invalid phone number is refused | 1. Enter 12345, Send code | Error asking for a 10-digit Indian mobile number | Pass |
| A5 | H | Existing owner signs in and sees both pets on Today | 1. Sign in as 98000 00021 | Today shows Bruno and Misty | Pass |
| A6 | H | Sign out returns to Log in or create an account | 1. Me → Sign out | Log in or create an account shown | Pass |
| A7 | H | Co-owner Rohan signs in and sees the same household | 1. Sign in as 98000 00022 | Today greets Rohan and shows the shared pets | Pass |

## 3 Pets

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| B1 | M | Add a pet: essential care and medical details are required, then it is saved | 1. + Add<br>2. Name = Coco only → Save<br>3. Fill food, allergies, medicine, vet name and phone → Save | Error lists the missing essentials; after filling them Coco is saved and shown | Pass |
| B2 | M | Edit a pet: allergies are saved and shown | 1. Edit<br>2. Allergies = Chicken<br>3. Save | Allergies show Chicken | Pass |
| B3 | M | Emergency card shows vet, 24x7 clinic and the not-an-emergency-service notice | 1. Open Emergency card | Own vet, 24x7 clinic and the not-an-emergency-service notice shown | Pass |

## 4 Routine and health calendar

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| C1 | M | Add a routine task: it takes effect from tomorrow and is listed | 1. Add<br>2. Task = Evening walk, type walk<br>3. Save | Saved, takes effect from tomorrow; task listed | Pass |
| C2 | M | Health calendar: add a vaccine date, then mark it done | 1. Add<br>2. Name Kennel cough, next due 20 Nov<br>3. Save<br>4. Done | Entry shown, then tagged Done | Pass |
| C3 | M | Health calendar: snooze an overdue reminder | 1. Rabies vaccine (overdue) → Snooze 1 day | Tag changes Overdue → Snoozed | Pass |
| C4 | M | From Today, Edit routine → Add “Just for today”: it joins today’s plan and doesn’t repeat | 1. Plan & evidence → Edit routine<br>2. Add: Extra play time, walk<br>3. When = Just for today<br>4. Save<br>5. Back to Today | Added to today’s plan, marked “today only”, shown on Today; it does not repeat tomorrow | Pass |

## 5 Today (daily care)

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| D1 | H | Who’s caring → Trusted Helper mode; tapping Covered makes the day covered | 1. Who’s caring → Change → Trusted Helper mode<br>2. Tap Covered | Mode shown; day becomes Covered day | Pass |
| D2 | H | Leaving checklist → I’m back → quick return check is saved | 1. I’m leaving → tick water → I’m leaving<br>2. Clock to 6 PM<br>3. I’m back<br>4. Answer the 5 return-check questions → Save | Out since 9:00 AM shown; Return check saved | Pass |
| D3 | H | Missed task: owner alert appears, “I’m on it”, then resolved with a note | 1. Clock to 1:35 PM<br>2. Alert for Lunch → I’m on it<br>3. Mark resolved with a note | Alert shows no evidence; then You’re on it; resolved alert disappears | Pass |
| D4 | H | Medicine is never passed to the backup: the alert says so | 1. Clock to 1:20 PM | Joint supplement alert says medicine is never passed to the backup | Pass |
| D5 | H | Change a task: cancelling needs a reason and is kept in history | 1. Open Toilet pad task → Change this task<br>2. Save without reason<br>3. Add reason → Save | Reason required; task shows Cancelled | Pass |
| D6 | H | Timeline and day report open with today’s plan | 1. Timeline<br>2. Close → Day report | Timeline lists the plan; report lists tasks and the Thank Sunita link | Pass |
| D7 | H | SOS: report “Pet hurt” → S1 incident → I’m on it → resolved with a note | 1. SOS → Pet hurt<br>2. Incident card → I’m on it<br>3. Open → resolution note → Mark resolved | S1 incident created, acknowledged, then closed | Pass |
| D8 | H | Can’t come today → plan kept, alone-window warning, “Ask a friend” pre-fills Find cover | 1. My help can’t come today → Mark unavailable<br>2. Ask a friend to cover | Plan kept, alone-window warning, no phase-3 placeholder; Find cover pre-filled for Bruno 1:00 pm | Pass |
| D9 | H | Day close at 11:59 PM stores the covered-day result | 1. Clock to 11:59 PM | Day closes; covered-day status shown | Pass |

## 6 Helper check-ins and backup look-in

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| E1 | H | Prompt arrives 10 min before; photo + today’s code → Likely; plus arrival and exit calls → Confirmed | 1. Show Sunita’s phone<br>2. Arrival call<br>3. Photo + today’s code<br>4. +15 min → Exit call | Prompt received; task Likely after photo; Confirmed after exit call | Pass |
| E2 | H | A wrong code is flagged and does not confirm the task | 1. Photo with wrong code | Task Not confirmed | Pass |
| E3 | H | Re-sending an old photo is not counted | 1. Re-send old photo on two tasks<br>2. Open Timeline | Helper told the photo was sent before (Marathi); timeline: not counted (reused image) | Pass |
| E4 | H | Voice note and IVR code each give Likely | 1. Voice note for Lunch<br>2. IVR code for Litter tray | Both tasks Likely | Pass |
| E5 | H | Helper reports “water ran out” → S3 incident on the owner’s Today | 1. Water ran out | S3 incident card on owner’s Today | Pass |
| E6 | H | Helper reports “pet hurt” → S1 incident with the call plan | 1. Pet hurt<br>2. Owner opens the incident | S1 incident with call plan and own-vet notice | Pass |
| E7 | H | Helper says “stop” → check-ins stopped; “start” re-asks consent and Yes resumes | 1. Stop<br>2. Owner: Helper and check-ins<br>3. Start again → Yes (हो) | Stopped check-ins, nothing recorded; after re-consent: Consent given | Pass |
| E8 | H | Helper screen: code card shown; rotating makes version 2 | 1. Rotate now → Rotate | Code card version 1 → version 2; old codes stop counting | Pass |
| E9 | H | Invite a new helper → waiting for their reply; nothing recorded yet | 1. Invite another helper (Lata) | Invitation sent; status Waiting for a reply | Pass |
| E10 | H | Backup look-in: link sent at +60 min, opens the pet card, “I’m on it”; expires after 15 min | 1. Open the backup’s look-in link<br>2. I’m on it<br>3. Clock +20 min, reopen link | Pet card with ‘not for backups to give’ medicine; thanks message; then link expired | Pass |

## 7 Care circle

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| F1 | M | Invite a family member → listed as invited | 1. Invite Kiran as Family | Kiran listed as invited | Pass |
| F2 | M | Remove the backup → access removed on every channel within 60 s | 1. Remove Ankita → Remove | Access removed on every channel, with timings under 60 s | Pass |
| F3 | M | Owner sees co-owner Rohan in the circle with his permissions | 1. Look at Rohan | Co-owner permissions listed | Pass |

## 8 Find cover (AI Friend Finder)

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| G1 | H | Helper can’t come → ask Meera → she says Yes (Marathi) → owner confirms → only Bruno’s lunch moves to her | 1. Ask a friend to cover → Understand → Search<br>2. Ask Meera → approve → Send<br>3. Meera taps हो<br>4. Owner Confirm → Today | Marathi message without flat/key; confirmed; only Bruno’s lunch reassigned; medicine and Misty’s litter stay open | Pass |
| G2 | H | Clear request is understood with no questions; suggestions are friends-first, nearest-first | 1. Clear example request → Understand → Search<br>2. Open ‘friends not shown’ | No questions; Priya, Arjun, Kavya in order; exclusions shown as counts | Pass |
| G3 | H | Ask all 3: first Yes is held, second Yes waits, owner confirms → others closed politely | 1. Ask all 3 → approve → Send<br>2. Priya Yes, Arjun हाँ<br>3. Confirm Priya | Provisional hold; Arjun waiting; after confirm Arjun closed politely | Pass |
| G4 | H | Medicine + vague time: questions block the search until answered | 1. Medicine + vague time request<br>2. Answer each question | Search blocked until answered; medicine notice shown | Pass |
| G5 | H | AI unavailable → simple form; matching still works | 1. Ask → Understand<br>2. Simple form: Feed, 5 PM → Search | AI unavailable notice; suggestions still found | Pass |
| G6 | H | AI times out (8 s) → simple form | 1. Ask → Understand | After 8 s: AI timed out, simple form offered | Pass |
| G7 | H | No friend free (10:30 PM) → honest empty result; nearby members stay switched off | 1. Feed Bruno at 10:30 pm → Search | Honest ‘none of your friends can do this’; nearby members Switch OFF | Pass |
| G8 | H | Friend suggests another time → owner confirms the new time | 1. Priya replies ‘5:30’<br>2. Owner Confirm 5:30 | Confirmed at 5:30 PM (header shows the agreed time) | Pass |
| G9 | H | Friend declines → nobody accepted, “Try again” offered | 1. Priya taps No | Nobody accepted; Try again offered | Pass |
| G10 | H | Request screen says it was understood by rules (no AI connected); owner cancels the request | 1. Look at how the request was understood<br>2. Cancel request | Says “understood by rules (no AI connected)”, never “parsed by AI”; request Cancelled | Pass |
| G11 | H | Duplicate WhatsApp “Yes” is ignored (idempotent) | 1. Priya taps Yes<br>2. Replay the same webhook | Only one acceptance recorded (idempotent) | Pass |

## 9 Friends (owner side)

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| H1 | M | Friends list shows who is findable; inviting a friend sends an invite (not opt-in) | 1. Invite Nikhil | Invitation sent; not searchable until they opt in | Pass |
| H2 | M | Friend profile → “Ask for help” opens Find cover with a draft for that friend | 1. Open Priya → Ask for help | Profile shows their own choices; Find cover draft for Priya | Pass |
| H3 | M | Block a friend → removed from future searches | 1. Kavya → Block → Block<br>2. Search a 5 pm request | Kavya not in results | Pass |
| H4 | M | Report a friend → blocked and sent for review | 1. Arjun → Report → Unsafe behaviour → Report | Report sent, friend blocked, ops case created | Pass |
| H5 | M | Privacy: what friends see; location sharing can widen to society + tower; nearby members locked off | 1. Society + tower | Hidden-until-confirmed list; setting saved; nearby switch locked off | Pass |

## 10 Friend’s own app

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| I1 | M | Priya signs in → friend view; pausing and turning off “findable” take effect at once | 1. Sign in as Priya<br>2. My settings → Pause<br>3. Turn off Friends can find me | Friend view; Saved; removed from search immediately | Pass |
| I2 | M | Owner asks Priya → Priya says Yes in her app → owner confirms → Priya sees address and key → arrives → done → completed | 1. Priya: Yes in app<br>2. Owner: Confirm<br>3. Priya: Show address → I’ve arrived → Done<br>4. Owner: Find cover | Address B-1104 shown only after confirm; owner told of arrival; request Completed | Pass |

## 11 Wallet, data rights, consents

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| J1 | M | Wallet shows the helper’s points from this home only, against the 125 cap | 1. Open Wallet and points | Sunita 60/125 from this home only; no cash; 500 points = ₹20 | Pass |
| J2 | M | “Show my data” lists what Pawsure holds about the owner | 1. Show my data | Export shows Neha’s profile and consents | Pass |
| J3 | M | Make a correction request → listed as Received with a reply-by date | 1. Correct something → detail → Send request | Request DR-… received; listed as Received with reply-by date | Pass |
| J4 | M | Consents are listed with their versions | 1. Look at Consents | terms T-1.0 and others listed | Pass |

## 12 Operations console

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| K1 | M | A household owner is refused: no staff role | 1. Open the console<br>2. Sign in there with the owner’s number | Console asks for its own staff sign-in; the owner number gets “This account has no staff role” | Pass |
| K2 | M | Ops on shift sees only their sections; overview shows each pilot gate with n and status | 1. Sign in 98110 00001 | Only ops sections; 6 gate metrics with n | Pass |
| K3 | M | Households view masks phone numbers | 1. Households | Phones masked (+91 •••• ••21) | Pass |
| K4 | M | Queues: a helper callback case can only be closed with a reason | 1. Queues → Close… without reason<br>2. Add reason → Close | Reason required; case closed | Pass |
| K5 | M | Ops lead: switches, turn on the share record; locked switches cannot be changed | 1. Switches → helperShareRecord Turn on | Value true; locked switches disabled | Pass |
| K6 | M | Ops lead: a points hold needs a reason the helper can read; releasing it notifies her | 1. Rewards holds → Decide… → Release without reason<br>2. Add reason → Release | Reason required; hold released | Pass |
| K7 | M | Privacy lead: answers and closes an owner’s rights request | 1. Rights requests → Handle… → reply → Reply and close | Request closed | Pass |
| K8 | M | Privacy lead: breach rehearsal starts the 72 h clock; steps can be ticked | 1. Breach runbook → Start a rehearsal<br>2. Affected people notified<br>3. Tick a checklist item | 72 h clock shows hours left; step ticked; readiness 1/7 | Pass |
| K9 | M | Auditor: reads the append-only audit log, can export, cannot open households | 1. Audit log → Staff views | Entries shown, Export CSV available, no Households section, no raw phones | Pass |
| K10 | M | Service health: a WhatsApp + SMS outage shows the failed delivery and raises an alert | 1. Helper message during outage<br>2. Restore SMS, sign in<br>3. Service health | Message delivery alert; vendor shows simulated outage; ‘gave up’ in deliveries | Pass |
| K11 | M | Pilot readiness: switches checked against §4.2; the arms check needs the enrolled cohort | 1. Pilot readiness → Assign arms | Switches OK; arms check asks for enrolled cohort; assignment refused (too few homes) | Pass |
| K12 | M | Ops: method mix hides groups under 5 and never lists a helper | 1. Method mix | Groups under 5 hidden; no helper named | Pass |
| K13 | M | Every role opens each of its console sections without an error | 1. For each role, open every allowed section | Each section opens with its title and no error | Pass |

## 13 Cross-cutting

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| L1 | M | Phone width (390 px): no sideways scrolling on any main tab | 1. Visit Today, Find cover, Friends, Pet, Me | No sideways scrolling | Pass |
| L2 | M | Offline banner appears when the connection drops | 1. Go offline<br>2. Back online | Offline banner appears then disappears | Pass |
| L3 | M | Reloading the demo starts fresh (each visitor gets their own copy) | 1. Reload<br>2. Sign in | Fresh demo data (tracked helper again) | Pass |
| L4 | M | Old “coming in phase 3” placeholders are gone everywhere | 1. Open Who’s caring sheet and every tab | No ‘arrives in phase’ placeholders anywhere | Pass |
| L5 | M | Choosing “A friend” under Who’s caring opens Find cover | 1. Who’s caring → A friend | Find cover opens | Pass |
| L6 | M | No console errors while using the main screens | 1. Visit every tab | No JavaScript errors in the console | Pass |

## 14 Login separation and security

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| M1 | H | Helper login → helper home only (WhatsApp instructions), no owner tabs or household data | 1. Sign in as 90000 00035<br>2. Open Your data rights | Helper home with WhatsApp instructions; no owner tabs, no pet data; data rights reachable | Pass |
| M2 | H | Backup login → care-circle home: today’s timeline and alerts, no pets, flat or owner tabs | 1. Sign in as 97000 00008 | Care-circle home: today’s timeline, ‘never give medicine’; no tabs, no flat number | Pass |
| M3 | H | Backup can acknowledge an emergency the owner reported | 1. Owner SOS → Pet hurt, sign out<br>2. Backup signs in → I’m on it | Backup can acknowledge the emergency | Pass |
| M4 | H | Staff who sign in on the owner app go to the console, not owner sign-up | 1. Sign in on the owner app with a staff number | Sent to the ops console, not owner sign-up | Pass |
| M5 | H | Shared phone: after sign-out the old session is dead and the next person sees none of the previous person’s data | 1. Owner signs out<br>2. Re-use the old token<br>3. Rohan signs in → Find cover | Token removed and refused (401); no trace of the previous person’s draft | Pass |
| M6 | H | “Sign out of all devices” ends the owner’s other sessions too | 1. Me → Sign out of all devices<br>2. Use the other session | Other session refused (401) | Pass |
| M7 | H | A new user sees only their own (empty) home, none of Neha’s pets, friends or requests | 1. Sign up<br>2. Look at Today, Friends, Find cover | Only Eve’s empty home; none of Neha’s pets, friends or requests | Pass |
| M8 | H | Friend login sees only requests sent to them, never household tabs | 1. Sign in as Priya | Only requests sent to Priya; no household tabs | Pass |
| M9 | H | HTML typed into a pet name shows as text and never runs | 1. Add pet named <img src=x onerror=alert(1)> with the essential details | Shown as text; no script runs, no image injected | Pass |
| M10 | H | Staff console: the owner’s session never opens it; signing out of the console ends that session only | 1. Open console<br>2. Sign in as ops lead<br>3. Sign out of console<br>4. Re-use the token | Owner session never opens the console and stays signed in; console session ended on the server (401) | Pass |

## 15 Reported issues (regression)

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| N1 | H | After waiting 30 seconds, “Resend code” sends a new code | 1. Send code<br>2. Wait 31 seconds (real time)<br>3. Resend code | A new code is sent (no “Please wait” after the 30 seconds) | Pass |
| N2 | H | Owner → Ops console (staff sign-in) → back: the owner app and every tab still work | 1. Ops console → staff sign-in<br>2. Back to the owner app<br>3. Tap every tab | Owner app works (Today, Find cover, Friends, Pet, Me all open); owner still signed in | Pass |
| N3 | H | Sign out, then sign straight back in with the same number | 1. Sign out<br>2. Sign in again straight away with the same number | Signs in without a block | Pass |
| N4 | H | A new user who reloads part-way through setup continues setup (no blank screen) | 1. Reload part-way through setup | Setup continues (terms, profile) instead of a blank screen | Pass |

## 16 Cover continuity (v1.4)

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| O1 | H | Helper taps Can’t make it at 2:30 → At risk → backups in order → Mrs Desai reads the note and accepts → owner confirms → gate and key | 1. Helper taps Can’t make it on the 2:30 reminder<br>2. Owner opens Today<br>3. Mrs Desai reads the handling note and taps Yes<br>4. Owner taps Confirm Mrs Desai<br>5. Owner ticks the gate approval and picks the key plan | Task At risk with the reason; Mrs Desai and Ankita asked first (key holders); Yes blocked until the note is read; after Confirm the gate and key checklist shows and turns Ready | Pass |
| O2 | H | No reply by 3:15 → At risk “no reply”, owner alerted once | 1. Advance to 3:10, then 3:15 | Nothing at 3:10; at 3:15 the task is At risk with “No reply from Sunita…”; owner alerted once | Pass |
| O3 | H | Helper writes “येऊ शकत नाही” at 11 AM for the 1 PM visit → At risk; access removed | 1. Helper writes “येऊ शकत नाही” | The 1 PM visit is At risk at once; owner told; no task prompts for that visit | Pass |
| O4 | H | Send someone else → helper names her sister → owner approves → one-time task link with details only after the note is read | 1. Helper taps Send someone else and sends her sister’s name and number<br>2. Owner approves<br>3. The sister opens the one-time link, reads the note, opens the details | Owner sees “Nothing about your home has been shared”; the link shows the address only after approval and the note | Pass |
| O5 | H | Backups in order: two at a time, key holders first; the owner sees each ask and stops the list | 1. See what’s happening<br>2. Advance to 2:40<br>3. Stop asking | First pair Mrs Desai and Ankita; then Rohan and Ritu; Stop shows the next-step options | Pass |
| O6 | H | A friend cancels at 4:45 for a 5:00 task → Friend Finder does not start → backup list; owner told why | 1. At 4:45 Priya cancels | No new Friend Finder search; At risk; status sheet says “Friend Finder not started: too close to the task” | Pass |
| O7 | H | Cover not found, must happen (medicine): no Move or Skip; care circle called after 15 min | 1. Advance to 12:30<br>2. Advance to 12:45 | Cover not found sheet with no Move or Skip and the 15-minute warning; at 12:45 the care circle is called | Pass |
| O8 | H | Cover not found, can wait (walk) → the owner moves it; the day records who was asked | 1. Advance through the backup pairs to 6:15<br>2. Move it | Move and Skip offered; task becomes You’re handling it; the day report’s cover history lists who was asked | Pass |
| O9 | H | “I’m leaving” with nobody confirmed → warning and options → Leave anyway → No cover planned | 1. I’m leaving<br>2. Leave anyway<br>3. Pick plan B, I’m leaving | Warning “Nobody has accepted Bruno’s 1:00 PM lunch + fresh water yet” with six options; Today shows No cover planned | Pass |
| O10 | H | “I’m delayed” 7 → 9 PM: Sunita only until 8 → a request for the dinner only | 1. I’m delayed → 9 PM → See what changes<br>2. Ask Sunita first<br>3. Sunita replies Only until 8 | Walk and dinner listed with alone-window and medicine checks; dinner becomes a request on its own | Pass |
| O11 | H | Gate and key: unticked items remind the owner once at task − 15 | 1. Advance to 3:45 and 3:50 | One gate-and-key reminder to the owner | Pass |
| O12 | H | A first-time friend must read the handling note before Yes | 1. Rahul taps Yes<br>2. Rahul taps I have read this, then Yes | First Yes is refused with “please read the handling note”; after reading, the request waits for the owner | Pass |
| O13 | H | Newcomer with nobody → honest message and the circle builder; no day-care list | 1. Sign up<br>2. Answer No one yet<br>3. Start the society invite link | Honest “Cover is limited…” message; four builder options; no day-care list | Pass |
| O14 | H | Ops sends a cluster advisory → tomorrow’s reminders go out this evening; same-society fallback is OFF and locked | 1. Console → Cluster advisory → Strike → Send<br>2. Switches; Cover continuity<br>3. Back to the owner app | Sent to 1 home; same-society fallback locked OFF; metrics and templates listed; Sunita has tomorrow’s reminder this evening | Pass |

## 17 Fixes from demo testing (v1.1.0)

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| P1 | M | A friend’s Yes before the cutoff can still be confirmed after it; new requests are blocked at the cutoff | 1. Priya says Yes at 4:28<br>2. Owner confirms at 4:35<br>3. Owner tries a new request at 4:35 | Confirm works; the new request is blocked with “Too close to the task for Friend Finder” | Pass |
| P2 | M | Alert text uses the past tense once the backup step has happened | 1. Advance to 4:30 PM | Alert says “Your backup was alerted at 2:00 PM.” | Pass |
| P3 | M | “Planned” appears once on a task card | 1. Look at a task card | “Planned” shows once; the cover line shows “Sunita · assigned” | Pass |
| P4 | M | The request label and the demo parser switch say the same thing (no AI connected) | 1. Look at the demo parser switch<br>2. Ask Pawsure for cover | Switch and request both say “rules (no AI connected)” | Pass |
| P5 | M | The welcome mascot is a transparent image, not a crop on a beige box | 1. Open the app (Log in or create an account) | The mascot is a transparent image with no beige box | Pass |
| P6 | M | On a wide screen the simulated phones sit beside the owner app, with no developer wording | 1. Show Sunita’s phone | The phone sits beside the owner app; no developer wording | Pass |
| P7 | M | Demo presets set up each of the 14 v1.4 scenarios | 1. Demo bar → v1.4 scenario… → pick each of O1 to O14 | Each preset loads without an error and shows what to tap next; O5, O7, O9 and O11 show their starting state | Pass |

## 18 QA defect tracker (v1.1.0)

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| Q1 | M | PAW-001/005 an unsent request can be edited from its screen; once sent, Edit is gone and the reason is shown | 1. Ask: feed Bruno at 6 pm<br>2. Search, then Back<br>3. Open the request (Awaiting owner approval) → Edit request<br>4. Change time, search, send to Priya | Edit request opens Check the details while unsent; after sending, Edit is gone and the reason is shown (PAW-001, PAW-005) | Pass |
| Q2 | M | PAW-004/012 history shows the latest 3 with exact times; View all shows the rest | 1. Look at Event history<br>2. View all | Latest 3 events with exact times (h:mm:ss); View all shows every event (PAW-004, PAW-012) | Pass |
| Q3 | M | PAW-006 a pet profile change shows on an unsent request | 1. Change Bruno’s medicine in the pet profile<br>2. Reopen the request<br>3. Answer the medicine question<br>4. Change the profile again and reopen | The question quotes the current profile; after answering, a later change is flagged and search uses the new text (PAW-006) | Pass |
| Q4 | M | PAW-002/008 New task: Save without a name shows a plain error by the field and saves nothing | 1. Save with no name<br>2. Type: medicine, name Eye drops, no instructions → Save | “Give the task a name.” by the field, nothing saved; medicine needs written instructions (PAW-002, PAW-008) | Pass |
| Q5 | M | PAW-013 unsaved work: leaving New task asks first; the simple form survives a tab switch | 1. Type a task name → Back<br>2. Keep editing<br>3. Simple form: tick Feed → switch tabs → reopen | Discard prompt before losing edits; the simple form keeps its ticks (PAW-013) | Pass |

## 19 QA consolidated tracker (14 Nov)

| ID | Pri | Test | Steps | Expected result | P/F |
|---|---|---|---|---|---|
| R1 | M | PAW-017 the owner edits the profile: tower saved, flat stays private, every owner is told | 1. Edit profile<br>2. Change tower → Save<br>3. Change it back | City and society pre-selected; Saved: tower; the change is shown; every owner is told (PAW-017) | Pass |
| R2 | M | PAW-018/036 sign-up asks for the city first; Pune and Mumbai list their own Lake Vista CHS | 1. Enter a name<br>2. Choose Pune<br>3. Choose Lake Vista CHS · Baner | Continue stays off until a city and society are chosen; each city lists its own societies (PAW-018, PAW-036) | Pass |
| R3 | M | PAW-029 Priya pauses for 6 days: the switch shows On with the dates; turning it off ends the pause | 1. Pause for 6 days<br>2. Turn the pause switch off | Switch shows On with the last paused day and the day requests return; off ends it at once (PAW-029) | Pass |
| R4 | M | PAW-026/033 a two-pet request: both pets ticked, summary names both; capacity and overnight hours in settings | 1. Priya sets 2 pets, tries 9 PM–6 AM<br>2. Owner: Simple form, Feed, tick Misty too → Search | Overnight end shows (next day); suggestion names Bruno and Misty and says 2 pets at once (PAW-026, PAW-033, R-13) | Pass |
| R5 | M | PAW-041/056 Priya says she is running late, then has an emergency after feeding: the owner sees both | 1. Running late 20 min<br>2. I’ve arrived<br>3. Emergency, tick Fed → Send<br>4. Owner opens the request | Owner told about the delay; the visit is Interrupted with Feed finished; backups asked (PAW-041, PAW-056, PAW-060) | Pass |
| R6 | M | PAW-019 the helper can’t change the home’s details but can tell the owner they are wrong | 1. Wrong society or tower? Tell the owner | Confirmation shown; owner asked to check; no edit rights for the helper (PAW-019) | Pass |

## 20 Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Product owner | | Accept / Reject | |
| Operations lead | | Accept / Reject | |
| Privacy lead | | Accept / Reject | |
| QA | | Accept / Reject | |
