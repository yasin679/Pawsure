/**
 * In-browser demo backend: the real Pawsure API (Hono) and database (PGlite, PostgreSQL in WebAssembly) running in the
 * visitor's own browser, seeded with the demo household. Nothing leaves the browser; every visitor gets their own copy,
 * and it starts fresh on each page load. Vendors are the same mock adapters the server uses in demo mode.
 */
import { openDb, migrate, seedDemo, type MigrationSource } from '@pawsure/db';
import { createApp } from '../../../api/src/app';
import { mockAdapters } from '../../../api/src/adapters';
import { demoClock } from '../../../api/src/clock';
// PGlite's file-system bundle (postgres.data) is copied next to the page as pglite-fs.wasm after the build (npm run build:demo) because artifact
// hosting only serves standard web file types. It is raw bytes either way; PGlite takes it as a Blob.
const fsBundleUrl = new URL('pglite-fs.wasm', document.baseURI).href;

const files = import.meta.glob('../../../../packages/db/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const MIGRATIONS: MigrationSource[] = Object.entries(files).map(([path, sql]) => ({ name: path.split('/').pop()!, sql }));

export async function start() {
  const fsBundle = await fetch(fsBundleUrl).then(r => { if (!r.ok) throw new Error('database files did not load'); return r.blob(); });
  const db = await openDb({ dataDir: 'memory', pglite: { fsBundle } });
  await migrate(db, MIGRATIONS);
  await seedDemo(db);
  const app = createApp({ db, adapters: mockAdapters(), clock: demoClock('2026-11-06T09:00:00+05:30', { live: true }), pepper: 'demo-pepper-not-secret', demoMode: true });
  await app.request('/jobs/tick', { method: 'POST' });
  return app;
}
