# Pilot runbook: 20 homes, Andheri–Powai, 4 weeks

Owner of this runbook: **Ops lead** (named before go-live). Everything here assumes the switches in §4.2 and the gates in §14 and §18 of the master prompt.

## Before day 1 (go / no-go)

| # | Check | Who | How |
|---|---|---|---|
| 1 | All tests pass, 24/24 mandatory scenarios | Tech lead | `npx tsx tools/test-report.mts` → docs/test-report.md |
| 2 | Switches match §4.2 | Tech lead | Console → Pilot readiness shows “Switches match §4.2” |
| 3 | Rewards arms assigned (10 of 20), seed recorded in the decision log | Ops lead | Console → Pilot readiness → Assign arms |
| 4 | Restore drill passed in the last 7 days | Tech lead | `npx tsx tools/restore-drill.mts` → docs/runbooks/last-restore-drill.md |
| 5 | Breach rehearsal held; checklist 7/7 | Privacy lead | Console → Breach runbook |
| 6 | Load test against staging over HTTPS, p95 < 500 ms | Tech lead | `tools/load-test.mts` (in-process) + a staging run |
| 7 | Vendors contracted, templates approved (WhatsApp utility, DLT SMS), IVR number live | Ops lead | docs/runbooks/vendors.md |
| 8 | Legal review of privacy notice, consent texts, rights and breach wording | Privacy lead | Signed note in the decision log |
| 9 | Hindi and Marathi helper messages reviewed by native speakers | Product | Signed note in the decision log |
| 10 | Ops rota filled for all 28 days, 8 AM–10 PM IST, with an on-call owner for automated alerts | Ops lead | Rota below |

No go-live if any of 1–5, 7, 8 or 10 is open.

## Rota and response targets

- Staffed: 8 AM–10 PM IST, 7 days. Automated alerts (escalations, S1 calls) run 24×7 without staff.
- On-call: one named person per day receives “Pawsure service alert” pushes (monitoring) and S1 ops cases.

| Case | Target |
|---|---|
| S1 emergency case (ops queue) | Watch within 15 min in staffed hours; out of hours, the automated call chain runs and ops reviews at the start of the next shift |
| Service alert (Service health turns red) | Acknowledge within 15 min; follow docs/runbooks/monitoring.md |
| Support callback (helper or owner) | First reply within 2 h in staffed hours |
| Abuse report / block | Act within 24 h |
| Points hold / dispute | Decide within 7 days, with a reason the helper reads |
| Rights request | Reply within 7 days (legal limit 90) |

Pawsure is not an emergency or veterinary service and never promises a response. Staff never give medical advice; they point to the owner’s vet and the 24×7 clinic on the emergency card.

## Daily checklist (start of shift)

1. Console → **Service health**: everything green? Open any red check’s ops case.
2. Console → **Queues**: open incidents, escalations today, cases. Take or close each with a reason.
3. Console → **Friend Finder**: anything stuck for more than 10 minutes?
4. Console → **Rewards holds**: anything due within 2 days?
5. Console → **Rights requests** (privacy lead): anything due within 2 days?

## Weekly

- Pilot overview: covered days, Confirmed/Likely share, consent rate, Friend Finder fulfilment, AI correction rate. Report counts with n; never as population percentages.
- Method mix (cuts of 5 or more only).
- Restore drill (weekly during the pilot).
- Week 2 decision: may turn on the helper shareable record only if the points arm is working (§4.2).

## Stop rules (§14)

- Under 60% of visits Confirmed/Likely, or under 50% of homes still active in week 4 → stop and rethink.
- AI correction rate above 10% → keep the manual form as the default and do not widen AI use.
- Any high-risk privacy leak → pause new requests, run the breach runbook.

## Hand-over pack

README.md · docs/architecture.md · docs/api.md · docs/permission-matrix.md · docs/traceability.md · docs/test-report.md · docs/decision-log.md · docs/runbooks/* · docs/known-limitations.md
