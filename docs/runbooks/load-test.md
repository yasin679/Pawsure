# Load test

Run 2026-11-09T14:38:49.210Z · in-process (no network/TLS) · PGlite · concurrency 10

## Pilot load: 20 homes, 2000 requests

| Route | Requests | p95 (ms) |
|---|---|---|
| GET pets | 200 | 30 |
| GET me | 200 | 45 |
| POST webhook photo | 400 | 142 |
| GET today | 800 | 186 |
| GET timeline | 200 | 201 |
| GET report | 200 | 191 |
| **All core (non-AI)** | 2000 | **179** |

- Server errors: 0 · throughput ≈ 93 requests/s
- Minute job for all homes: first run 1037 ms, steady 634 ms
- Target: p95 < 500 ms → **PASS**

## Scale check: 200 homes

- Minute job: first run 8165 ms, steady 5581 ms · p95 of 400 requests: 148 ms · errors 0
- The job runner visits every home every minute; at 1,000 homes it must be split into household shards before it nears 60 s (not built yet; see known limitations).

Repeat against staging over HTTPS with the real database before the pilot; in-process numbers are a floor, not a promise.
