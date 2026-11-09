# Backup and restore

## Targets (proposed, decision D-30)

| Deployment | RPO (data loss at most) | RTO (back in service within) |
|---|---|---|
| Managed PostgreSQL (pilot target) | 5 min (provider point-in-time recovery) | 1 h |
| PGlite on a single host (demo / fallback) | 24 h (nightly encrypted snapshot) | 30 min |

The last drill result is in `last-restore-drill.md` (restore and verification of the demo database took about 1 s; add host start-up and DNS for the full RTO).

## Encrypted snapshots (PGlite)

- Nightly from the job runner after 2 AM IST when `BACKUP_DIR` and `BACKUP_KEY` are set; on demand with `POST /jobs/backup`.
- File: `pawsure-<date>-<ms>.psbk` (AES-256-GCM, tamper-evident) plus `.json` manifest with sha256 and row counts. The newest 14 are kept.
- Keep `BACKUP_KEY` in the secrets manager, never next to the backups. Copy backups off the host (encrypted object storage in India).

## Managed PostgreSQL

- Turn on point-in-time recovery (7 days minimum) and a nightly encrypted `pg_dump` to separate storage.
- To verify a restore: restore to a new instance, run `migrate`, then compare `fingerprint()` from `@pawsure/db` against the source and check the audit log still refuses updates (`verifyRestore`).

## Drill (weekly during the pilot)

```bash
BACKUP_DIR=backups BACKUP_KEY=<64 hex> npx tsx tools/restore-drill.mts
```

It restores the newest backup into a throwaway database, compares every table’s row count with the manifest, checks the audit log is still append-only, and writes `last-restore-drill.md`. Exit code 1 means fail: open an ops case and fix before the next shift.

## Real restore

1. Stop the scheduler (no ticks) and put the web app in maintenance (owners see the offline banner; helper missed calls are queued by the vendor).
2. Restore (provider PITR or the newest `.psbk`) to a new database; run the verification above.
3. Point the API at it, start, check `GET /ready`, then turn the scheduler back on. Escalations resume idempotently.
4. Record the incident; if personal data may have been exposed, start the breach runbook (Console → Breach runbook).
