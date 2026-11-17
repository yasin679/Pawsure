---
id: PS-FAQ-04
title: FAQ and Troubleshooting
subtitle: Answers to common questions, and what to do when something doesn’t look right
audience: Everyone: owners, care circle, helpers, friends, the operations team
---

# FAQ and Troubleshooting

## 1 Frequently asked questions

### 1.1 Evidence and labels

**Why does a task say *Likely* and not *Confirmed*?**
One good signal, such as a photo with today’s code, gives *Likely*. *Confirmed* needs two independent channels, for example the photo plus arrival and exit calls long enough for the visit’s tasks. A single signal never confirms a task.

**The helper came, so why is the task *Not confirmed (visit only)*?**
The arrival and exit calls prove the visit, not each task. Without a photo, voice note or code for the task, it stays *Not confirmed* and escalates like a missed task. Your return check can mark it *Matched*.

**Why was a photo not counted?**
Either the code in the caption was not today’s (wrong or from an old or rotated card), or the same image was sent before. Reused photos are recognised by their fingerprint, even after the photo itself is deleted.

**Does Pawsure use AI?**
Not in this release. Requests are understood by rules and the screen says *understood by rules (no AI connected)*. Choosing which friends to suggest never uses AI. The **AI (simulated)** switch in the demo only lets you try the fallbacks.

**What is a covered day?**
A day on which every pet’s tasks had evidence, or were resolved by you before 11:59 PM. Cancelled tasks are left out. In Trusted Helper mode the day is covered only if you tap **Covered**; otherwise it is *Unknown*.

### 1.2 When cover is at risk (new in 1.1)

**Why did my helper get a message before the visit?**
One reminder per visit asks whether she is coming, so you hear early if she can’t. A Yes is a plan, not evidence: the task still needs its photo, voice note or code.

**Who does Pawsure contact without asking me?**
Only your ordered backup list, and only if you turned on *Ask my backups automatically*. Friends, substitutes and any other number are contacted only after your tap.

**Why can’t I skip Bruno’s medicine?**
Medicine *must happen*, so Move and Skip are not offered. If you don’t respond within 15 minutes of *cover not found*, your care circle gets an automated call.

**Why didn’t Pawsure start Friend Finder?**
Friend Finder closes 30 minutes before the task. After that, Pawsure says *too close to the task for Friend Finder* and asks your backups instead.

**What is “No cover planned”?**
You left with nobody confirmed. The day isn’t counted as covered unless the tasks are done with evidence or matched by your return check.

### 1.3 Alerts and emergencies

**When is my backup alerted?**
Standard tasks: you at +30 minutes, your backup at +60 (a 15-minute look-in link), cover suggestions at +75. Walks: +45, +75, +90. Medicine: you at +15, cover suggestions at +60, and never your backup.

**I saw the alert. Why did my backup still get it?**
Only tapping **I’m on it** (or pressing 1 on a call) stops the next steps. Reading the message does not count.

**Is Pawsure an emergency service?**
No. It alerts the people you chose and shows your vet and 24x7 clinic. In an emergency, call them directly. Pawsure never gives medical advice or promises a response time.

### 1.4 Helpers

**Does my helper need the app or a smartphone?**
No. WhatsApp works, and so does a basic phone: a missed call on arrival and exit, then keying today’s code on the IVR line.

**What does my helper see about me?**
Task messages for your home only. They never see your other data, and owners never see a helper’s phone number in the app.

**My helper said *Not now*. What can I do?**
Nothing is recorded about them. Use Trusted Helper mode, your own return check, or invite them again later. Their tasks show *Not confirmed*, never *failed*.

**My helper got a message with a “start code”. What is it?**
Right after her arrival missed call, and again after her exit call, Pawsure sends her a new 3-digit code on WhatsApp. She writes it on paper, puts it next to your pet or the bowl and sends a photo within 10 minutes. Because nobody knew the code before the call, the photo must have been taken during the visit. You see *Start code: photo matched ✓* (or *waiting*, *no photo sent*, *came late*, *didn't match*) on the task.

**The calls were long enough, so why is the visit *Not confirmed*?**
A start or end code photo came back with a code that doesn't match. The visit stays *Not confirmed* until the right code arrives within 10 minutes of being sent. If the codes simply never came back, the visit is *Likely*, not *Confirmed*.

**Where do I see when my helper came and left?**
Tap a task: under the photo, the visit line shows the arrival and exit times, how long the visit lasted and the minimum its tasks need, for example *Visit 12:50–1:02 · 12 min (minimum 11 min)*. It's red when the visit was too short.

**How do points work?**
5 points per *Confirmed* or *Likely* task, up to 125 a month from your home; 500 points = a ₹20 coupon; no cash; points expire after 6 months. Points are on in half of the pilot homes.

**Why are some points *on hold*?**
Your return check contradicted a *Likely* task. The Pawsure team decides within 7 days and the helper reads the reason. A hold is never a finding against them.

### 1.5 Friends and cover

**Can my friends see my flat number?**
Only a friend you have **confirmed** for a visit, and only for that visit. Access is removed when they tap **Done**, cancel, or 2 hours after the task.

**Why wasn’t a friend suggested?**
They may not have opted in to be found, may be paused, not free at that time, not have chosen that task (for example medicine), or be blocked. **Friends not shown — why** gives counts only.

**Two friends said Yes. Who gets it?**
With **Ask all 3**, the first valid Yes is held for 10 minutes while you confirm. The others are told you are confirming, and are closed politely once you do.

**What if the friend doesn’t turn up?**
If there is no check-in by 20 minutes after the task time, the request becomes *No-show* and your backup is alerted (or cover suggestions, for medicine).

### 1.6 Account and privacy

**Someone else used my phone. Can they see my data?**
After **Sign out**, the session ends on the server and the app clears what was shown. **Sign out of all devices** ends every session, for example if a phone is lost.

**How do I see or delete my data?**
**Me → Your data rights**: **Show my data**, or make a request to see, correct, withdraw a consent, delete or complain. Helpers can reply **my data** or **delete my data** on WhatsApp. Pawsure aims to reply within 7 days.

**Why does Pawsure keep some records after I ask to delete them?**
Records other people rely on, such as an incident, are kept only for as long as the law requires.

## 2 Troubleshooting

| Problem | Likely cause | What to do |
|---|---|---|
| *Please wait 30 seconds before asking for another code* | Codes can be resent after 30 seconds | Wait, then tap **Resend code**. Signing out and back in is never blocked by codes you already used. |
| *Too many codes requested* | 3 codes in 15 minutes | Wait 15 minutes. |
| *Too many wrong attempts* | 5 wrong codes | Request a new code. |
| *We could not send the code* | The SMS provider is unavailable | Try again in a few minutes. The operations team sees this on Service health. |
| Signed out unexpectedly | Session expired (30 days), or **Sign out of all devices** was used | Sign in again. |
| *You’re offline* banner | No connection | The last saved view is shown; the helper’s missed-call check-ins still work. |
| *Search is blocked until the highlighted questions are answered* | Time, pet, access or medicine detail is unclear | Answer each highlighted question. |
| *None of your friends can do this right now* | Nobody opted in, free and capable at that time | Try a different time, **Widen to any distance**, or call your backup. |
| *Answer the highlighted questions first* | Clarification still open | Same as above. |
| *That friend is no longer eligible* | They paused, opted out or were blocked after the search | Search again. |
| *Up to 10 cover requests an hour* | Spam limit | Wait, or call support if it is an emergency. |
| *Please fill in: Food and feeding, Allergies…* when adding a pet | Essential care and medical details are required | Fill them in; write *None* or *None known* where there are none. |
| *Too close to the task for Friend Finder* | The search closes 30 min before the task | Your backups are asked instead; or use **Ask someone else** on the cover-not-found sheet. |
| A backup’s **Yes** is greyed out | They have not cared for your pet before | They must first tick “I have read this” under the handling note. |
| *Your role can’t change this* | Co-owners, backups and family have limited permissions | Ask the owner. |
| The look-in link says *This link has expired* | Links open for 15 minutes | Contact the owner directly. |
| The look-in link says *This link was switched off* | Your care-circle access was removed | Contact the owner. |
| Helper says the code is wrong | Old card, or the card was rotated | Print the current card (**Me → Helper and check-ins**). |
| Code card **Print** does nothing in the shared demo | The demo runs inside a frame that blocks printing | Print from the installed app. |

## 3 For the operations team

| Symptom (Service health) | First response |
|---|---|
| Job runner red | Check the scheduler calls `POST /jobs/tick` every minute with `x-job-secret`. Runs catch up safely. |
| Message delivery red | WhatsApp or SMS provider down. Fallback to SMS is already running; tell owners in-app if it lasts more than 30 minutes. |
| Webhooks red | Check logs; vendors retry. 401 means the vendor isn’t sending `WEBHOOK_SECRET`. |
| S1 emergencies unacknowledged | Phone the owner and backup; the automated calls are already running. |
| Rights requests overdue | Privacy lead replies from **Rights requests**. |

Full runbooks: `docs/runbooks/monitoring.md` and `docs/runbooks/support.md`.
