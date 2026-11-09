# Monitoring and alerting

The job runner (`POST /jobs/tick`, every minute) evaluates these checks after each run. A check moving into **alert** opens one ops case (kind `monitoring`) and sends a push to `oncall`; recovery is noted on the same case. States are in `service_checks`; every change is in the audit log. Console → **Service health** shows them live.

| Check | Warn | Alert | First response |
|---|---|---|---|
| Job runner | no run for 3 min | no run for 10 min | Check the scheduler (cron → `/jobs/tick` with `x-job-secret`) and API logs. Escalations and prompts are idempotent: a late run catches up without duplicates. |
| Missed-task alert delay (p95) | > 15 s | > 30 s | Usually the scheduler interval or a slow database. In demo mode the clock jumps, so this reads high. |
| Message delivery (1 h) | ≥ 3 failed attempts or any fallback | any message undelivered | Console → Vendors / Recent deliveries. If WhatsApp is down, SMS fallback is already running; tell owners in-app if it lasts > 30 min. |
| Inbound webhooks (15 min) | > 10 rejected | any 5xx | 409 is normal (no consent / duplicate). 5xx: check logs, the vendor retries. |
| OTP failures (15 min) | > 10 | > 30 | Possible abuse: check numbers in the audit log; the per-number limits already apply. |
| Core API p95 (15 min) | > 500 ms | > 1 s | Database load, a slow route in the logs. |
| Server errors (15 min) | ≥ 1 | ≥ 5 | Logs; roll back if it follows a deploy (deployment.md). |
| Friend requests waiting > 10 min | any | — | Console → Friend Finder; call the owner if a task is close. |
| S1 unacknowledged > 15 min | — | any | Call the owner and backup by phone; the automated calls are already running. |
| Rights requests | due within 2 days | overdue | Privacy lead. |
| AI parse fallbacks (24 h) | > 50% of ≥ 5 | — | Vendor status; the manual form keeps working. |
| Database round trip | > 200 ms | > 1 s | Host metrics. |
| Retention job | not run for 2 days | — | Check the job runner; retention runs once per IST day. |

`GET /ready` returns 503 if the database is unreachable; point the host’s health check and an external uptime monitor at it. `GET /health` is a liveness probe only.

## Cost guards (§15)

Set vendor-side budgets and spend alerts for WhatsApp, IVR, SMS, AI and maps before go-live. Rewards can be paused with the `helperRewards` switch if funding stops.
