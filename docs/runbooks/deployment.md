# Staging / pilot deployment and rollback

No staging or production environment exists yet (decision D-01 is open). These are the steps once a host and managed PostgreSQL (India region) are chosen.

## Environments

| | Staging | Pilot |
|---|---|---|
| `NODE_ENV` | production | production |
| `DEMO_MODE` | 0 (or 1 on a separate demo instance) | 0 |
| `DATABASE_URL` | staging Postgres | pilot Postgres (PITR on) |
| Vendors | sandbox accounts | contracted accounts |

Required secrets (never in git): `OTP_PEPPER`, `CODE_CARD_KEY`, `JOB_SECRET`, `BACKUP_KEY` (PGlite only), `WEB_ORIGIN`, vendor credentials (vendors.md). With `DEMO_MODE=0` the server refuses to start without `OTP_PEPPER`.

## Deploy

1. `npm ci && npm run typecheck && npm test` must pass on the commit.
2. Build the web app: `npm run build` (static files from `apps/web/dist`, served over HTTPS; PWA service worker included).
3. Take a database snapshot (provider snapshot or `POST /jobs/backup`).
4. Start the new API version. Migrations run at start-up, in order, each in a transaction; they only add tables and columns (expand-only), so the previous API version still runs against the new schema.
5. Check `GET /ready`, sign in on the web app, open Console → Service health.
6. Turn on the scheduler: every minute `POST /jobs/tick` with header `x-job-secret: $JOB_SECRET`.

## Rollback

- **App only** (most cases): redeploy the previous API and web build. Because migrations are expand-only, no database change is needed.
- **Bad migration or data**: stop the scheduler, restore the pre-deploy snapshot (restore.md), deploy the previous build, re-enable the scheduler. Events that arrived in between are re-sent by vendors on retry; idempotency keys stop duplicates.
- Record every rollback in the decision log with the reason.

## Never

- Never enable `DEMO_MODE` on the pilot database (it seeds demo data and returns OTP codes in responses).
- Never change a locked switch outside the approval process (Console refuses; a database edit must be logged as a decision).
