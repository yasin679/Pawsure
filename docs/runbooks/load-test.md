# Load test

Run 2026-11-13T06:54:30.098Z · in-process (no network/TLS) · PGlite · concurrency 10

## Pilot load: 20 homes, 2000 requests

| Route | Requests | p95 (ms) |
|---|---|---|
| GET pets | 200 | 27 |
| GET me | 200 | 40 |
| POST webhook photo | 400 | 120 |
| GET today | 800 | 162 |
| GET timeline | 200 | 173 |
| GET report | 200 | 163 |
| **All core (non-AI)** | 2000 | **161** |

- Server errors: 0 · throughput ≈ 87 requests/s
- Minute job for all homes: first run 1443 ms, steady 960 ms
- Target: p95 < 500 ms → **PASS**

## Scale check: 200 homes

- Minute job: first run 11764 ms, steady 9449 ms · p95 of 400 requests: 169 ms · errors 0
## Evening peak: 200 homes, cover reminders (v1.1.0)

- Every home has an 8 AM task tomorrow, so all 200 reminders go out in the 8 PM run while 400 owner requests run alongside it.
- Reminders sent: **200** of 200 · that run took 31027 ms · the next run 17700 ms
- p95 of owner requests during the run: **226 ms** · errors 0 → target p95 < 500 ms: **PASS**

- The job runner visits every home every minute; at 1,000 homes it must be split into household shards before it nears 60 s (not built yet; see known limitations).

Repeat against staging over HTTPS with the real database before the pilot; in-process numbers are a floor, not a promise.
