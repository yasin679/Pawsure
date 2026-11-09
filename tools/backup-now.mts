/**
 * Manual encrypted backup of a PGlite data directory (stop the API first — PGlite allows one process per directory).
 * While the API runs, use POST /jobs/backup instead (it backs up from inside the running process).
 * Run: PGLITE_DIR=apps/api/.data/pglite BACKUP_DIR=backups BACKUP_KEY=<64 hex> npx tsx tools/backup-now.mts
 * Add SEED_DEMO=1 to back up a fresh demo database (for drills on a clean machine).
 */
import { openDb, migrate, seedDemo } from '../packages/db/src/index.js';
import { runBackup } from '../apps/api/src/ops.js';

const db = await openDb({ dataDir: process.env.SEED_DEMO ? 'memory' : (process.env.PGLITE_DIR ?? 'apps/api/.data/pglite') });
await migrate(db);
if (process.env.SEED_DEMO) await seedDemo(db);
const r = await runBackup(db, new Date(), { force: true });
await db.close();
if (!r) { console.error('Set BACKUP_DIR and BACKUP_KEY.'); process.exit(1); }
console.log(`Backup written: ${r.file} (${r.bytes} bytes, sha256 ${r.sha256})`);
