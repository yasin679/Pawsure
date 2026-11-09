# Pawsure API reference

Generated from the route table by `tools/gen-api-docs.mts` (112 routes). Request bodies are validated with zod in the handlers; errors are JSON `{ error, note? }` with 400 invalid input, 401 no session, 403 role or household not allowed (logged), 404 not found, 409 invalid state or no consent, 429 rate limited, 503 vendor unavailable.

Base URL: `VITE_API_URL` (local `http://localhost:8787`). Times are IST; every inbound event stores event time and received time.

## Auth, health and links

| Method | Path | Access |
|---|---|---|
| POST | `/auth/otp/request` | Public |
| POST | `/auth/otp/verify` | Public |
| GET | `/health` | Public |
| GET | `/l/:token` | Signed, expiring token in the path |
| POST | `/l/:token/ack` | Signed, expiring token in the path |
| GET | `/r/:token` | Signed, expiring token in the path |
| GET | `/ready` | Public |

## Me, consents and rights

| Method | Path | Access |
|---|---|---|
| POST | `/v1/auth/logout` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/auth/logout-all` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/consents` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/invitations` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/invitations/:mid/accept` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/me` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/me/export` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/me/rights` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/me/rights` | Session (owner, circle, helper or friend; checked per household) |

## Household

| Method | Path | Access |
|---|---|---|
| POST | `/v1/households` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/circle` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/circle/:mid/revoke` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/circle/invite` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/code-cards` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/code-cards/current` | Session (owner, circle, helper or friend; checked per household) |
| PUT | `/v1/households/:hh/day` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/day/back` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/day/call-helper` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/day/close` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/day/leaving` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/day/report` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/day/return-check` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/day/timeline` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/day/trusted-covered` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/health` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/health` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/health/:id/:action{done|snooze}` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/helpers` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/helpers/:mid/practice` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/helpers/:mid/resend` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/helpers/invite` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/incidents` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/incidents` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/incidents/:id/ack` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/incidents/:id/resolve` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/pets` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/pets` | Session (owner, circle, helper or friend; checked per household) |
| PATCH | `/v1/households/:hh/pets/:id` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/privacy` | Session (owner, circle, helper or friend; checked per household) |
| PUT | `/v1/households/:hh/privacy` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/routine` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/routine` | Session (owner, circle, helper or friend; checked per household) |
| PUT | `/v1/households/:hh/routine/:id` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/tasks/:id/ack` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/tasks/:id/lifecycle` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/tasks/:id/resolve` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/today` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/visits/:visitId/gate` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/wallet` | Session (owner, circle, helper or friend; checked per household) |

## Demo

| Method | Path | Access |
|---|---|---|
| POST | `/demo/clock` | Demo mode only |
| GET | `/demo/friend-thread/:uid` | Demo mode only |
| GET | `/demo/helper-thread/:mid` | Demo mode only |
| POST | `/demo/llm` | Demo mode only |
| POST | `/demo/outage` | Demo mode only |
| GET | `/demo/outbox` | Demo mode only |
| GET | `/demo/service` | Demo mode only |

## Webhooks

| Method | Path | Access |
|---|---|---|
| POST | `/webhooks/ivr` | Vendor webhook (signature check when the vendor is chosen) |
| POST | `/webhooks/whatsapp` | Vendor webhook (signature check when the vendor is chosen) |

## Jobs

| Method | Path | Access |
|---|---|---|
| POST | `/jobs/backup` | x-job-secret (demo: open) |
| POST | `/jobs/escalations` | x-job-secret (demo: open) |
| POST | `/jobs/tick` | x-job-secret (demo: open) |

## Friend Finder

| Method | Path | Access |
|---|---|---|
| GET | `/v1/households/:hh/friends` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/friends/:uid` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/friends/:uid/block` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/friends/:uid/report` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/friends/invite` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/requests` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/requests` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/households/:hh/requests/:id` | Session (owner, circle, helper or friend; checked per household) |
| PATCH | `/v1/households/:hh/requests/:id` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/requests/:id/approve` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/requests/:id/cancel` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/requests/:id/change-time` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/requests/:id/complete` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/requests/:id/confirm` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/households/:hh/requests/:id/search` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/me/friend` | Session (owner, circle, helper or friend; checked per household) |
| PUT | `/v1/me/friend` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/me/friend/links/:hh/accept` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/me/requests/:id/:action{arrived|done|cancel}` | Session (owner, circle, helper or friend; checked per household) |
| GET | `/v1/me/requests/:id/access` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/me/requests/:id/live` | Session (owner, circle, helper or friend; checked per household) |
| POST | `/v1/me/requests/:id/reply` | Session (owner, circle, helper or friend; checked per household) |

## Operations console

| Method | Path | Access |
|---|---|---|
| GET | `/admin/audit` | Session + staff role (every view audited) |
| GET | `/admin/breach` | Session + staff role (every view audited) |
| PUT | `/admin/breach/checklist` | Session + staff role (every view audited) |
| POST | `/admin/breach/events` | Session + staff role (every view audited) |
| PUT | `/admin/breach/events/:id` | Session + staff role (every view audited) |
| POST | `/admin/cases/:id` | Session + staff role (every view audited) |
| POST | `/admin/cohort/assign` | Session + staff role (every view audited) |
| GET | `/admin/flags` | Session + staff role (every view audited) |
| PUT | `/admin/flags` | Session + staff role (every view audited) |
| GET | `/admin/friend-finder` | Session + staff role (every view audited) |
| GET | `/admin/households` | Session + staff role (every view audited) |
| GET | `/admin/me` | Session + staff role (every view audited) |
| GET | `/admin/method-mix` | Session + staff role (every view audited) |
| GET | `/admin/overview` | Session + staff role (every view audited) |
| GET | `/admin/queues` | Session + staff role (every view audited) |
| GET | `/admin/release-check` | Session + staff role (every view audited) |
| GET | `/admin/rewards` | Session + staff role (every view audited) |
| POST | `/admin/rewards/:id/decide` | Session + staff role (every view audited) |
| GET | `/admin/rights` | Session + staff role (every view audited) |
| PUT | `/admin/rights/:id` | Session + staff role (every view audited) |
| GET | `/admin/service` | Session + staff role (every view audited) |
| GET | `/admin/signals` | Session + staff role (every view audited) |

## Webhook contracts

- **WhatsApp** `POST /webhooks/whatsapp`: `{ messageId, from (E.164), type: button|text|photo|voice, payload?, text?, taskId?, mediaRef?, caption?, sentAt? }`. Idempotent on `messageId`; a repeat returns `{ status: "duplicate_event" }`. Nothing is stored from a helper without consent (409).
- **IVR / missed call** `POST /webhooks/ivr`: `{ callId, from, event: arrive|exit|code, taskId?, visitId?, digits?, at? }`. Idempotent on `callId`+event; calls from unregistered numbers never count.
- Production adapters must verify the vendor signature before this handler runs (decision D-06).
