/**
 * Restore drill (Phase 5): restore the newest encrypted backup into a throwaway in-memory database, compare every
 * table's row count with the manifest taken at backup time, confirm the audit log is still append-only, and time it.
 * Run: BACKUP_DIR=backups BACKUP_KEY=<64 hex> npx tsx tools/restore-drill.mts   (writes docs/runbooks/last-restore-drill.md)
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, unseal, backupKey, verifyRestore } from '../packages/db/src/index.js';

const dir = process.env.BACKUP_DIR ?? 'backups';
const files = readdirSync(dir).filter(f => f.endsWith('.psbk')).sort();
if (!files.length) { console.error(`No backups in ${dir}. Run POST /jobs/backup first.`); process.exit(1); }
const file = files.at(-1)!;
const manifest = JSON.parse(readFileSync(join(dir, file + '.json'), 'utf8')) as { createdAt: string; sha256: string; fingerprint: Record<string, number> };
const t0 = performance.now();
const plain = unseal(readFileSync(join(dir, file)), backupKey());
const db = await openDb({ dataDir: 'memory', loadFrom: plain });
const result = await verifyRestore(manifest.fingerprint, db);
const seconds = ((performance.now() - t0) / 1000).toFixed(1);
await db.close();

const report = `# Last restore drill

- Backup: \`${file}\` taken ${manifest.createdAt}
- Restored at: ${new Date().toISOString()}
- Time to restore and verify: **${seconds} s** (data restore only; add host start-up for the full RTO)
- Tables compared: ${result.tables}
- Row counts match the manifest: **${result.mismatches.length === 0 ? 'yes' : 'no'}**
- Audit log still append-only after restore: **${result.appendOnly ? 'yes' : 'no'}**
- Result: **${result.ok ? 'PASS' : 'FAIL'}**
${result.mismatches.length ? '\n| Table | Expected | Restored |\n|---|---|---|\n' + result.mismatches.map(m => `| ${m.table} | ${m.expected} | ${m.restored} |`).join('\n') + '\n' : ''}`;
mkdirSync('docs/runbooks', { recursive: true });
writeFileSync('docs/runbooks/last-restore-drill.md', report);
console.log(report);
process.exit(result.ok ? 0 : 1);
