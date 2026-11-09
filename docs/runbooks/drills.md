# Operational drills (§13 operational simulations)

Run in demo mode (`npm run dev:api`, web on :5173). Each drill names how it is covered automatically.

| Simulation | How to run it by hand | Automated test |
|---|---|---|
| No mobile data (owner offline) | Browser devtools → Offline: the offline banner shows; missed-call check-ins still arrive by IVR | — (manual) |
| Dropped IVR call / arrival with no exit | Sunita’s phone → arrival missed call only; task shows “visit in progress”, then “one call only” | trust.test: arrival without exit |
| Delayed WhatsApp webhook | Post a webhook with an old `sentAt`; the evidence is marked late (kept within 3 h) | trust.test: late evidence |
| Duplicate event | Post the same `messageId` twice → `duplicate_event` | api.test, phase3.test |
| Friend decline / no response / cancel / no-show / duplicate accept | Friends’ phones in the demo bar | phase3.test, friendfinder.test |
| AI timeout / provider outage | Demo bar → AI: times out / unavailable → manual form | phase3.test |
| Vendor outage | `POST /demo/outage` (vendors.md) | phase5.test: failover |
| Queue backlog | Stop ticking for 10+ minutes, then tick: steps fire once, Service health shows the job runner alert | phase5.test, api.test (idempotent steps) |
| Access revoked with a live link | Care circle → remove the backup while a look-in link is open → link returns 410 | phase2.test |
| Breach notification | Console (privacy lead) → Breach runbook → Start a rehearsal; tick each step | phase4.test |
| Restore | tools/restore-drill.mts | phase5.test: restore |
| Load | tools/load-test.mts | — (tool) |
