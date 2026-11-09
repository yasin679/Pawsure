/**
 * API reference generated from the running route table, so it can't drift from the code (master prompt §17 item 4).
 * Run: npx tsx tools/gen-api-docs.mts  → docs/api.md
 */
import { writeFileSync } from 'node:fs';
import { openDb, migrate } from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';
import { mockAdapters } from '../apps/api/src/adapters.js';
import { systemClock } from '../apps/api/src/clock.js';

const db = await openDb({ dataDir: 'memory' }); await migrate(db);
const app = createApp({ db, adapters: mockAdapters(), clock: systemClock, pepper: 'docs', demoMode: true });
const seen = new Set<string>();
const routes = app.routes.filter(r => r.method !== 'ALL').filter(r => { const k = r.method + ' ' + r.path; if (seen.has(k)) return false; seen.add(k); return true; });
const auth = (p: string) => p.startsWith('/v1/') ? 'Session (owner, circle, helper or friend; checked per household)' : p.startsWith('/admin/') ? 'Session + staff role (every view audited)' : p.startsWith('/webhooks/') ? 'Vendor webhook (signature check when the vendor is chosen)' : p.startsWith('/jobs/') ? 'x-job-secret (demo: open)' : p.startsWith('/demo/') ? 'Demo mode only' : p.startsWith('/l/') || p.startsWith('/r/') ? 'Signed, expiring token in the path' : 'Public';
const group = (p: string) => p.startsWith('/v1/households/:hh/requests') || p.startsWith('/v1/me/requests') || p.includes('/friends') || p.startsWith('/v1/me/friend') ? 'Friend Finder'
  : p.startsWith('/v1/households') ? 'Household' : p.startsWith('/v1/') ? 'Me, consents and rights' : p.startsWith('/admin') ? 'Operations console' : p.startsWith('/webhooks') ? 'Webhooks' : p.startsWith('/jobs') ? 'Jobs' : p.startsWith('/demo') ? 'Demo' : 'Auth, health and links';
const groups = new Map<string, typeof routes>();
for (const r of routes) { const g = group(r.path); groups.set(g, [...(groups.get(g) ?? []), r]); }
let md = `# Pawsure API reference

Generated from the route table by \`tools/gen-api-docs.mts\` (${routes.length} routes). Request bodies are validated with zod in the handlers; errors are JSON \`{ error, note? }\` with 400 invalid input, 401 no session, 403 role or household not allowed (logged), 404 not found, 409 invalid state or no consent, 429 rate limited, 503 vendor unavailable.

Base URL: \`VITE_API_URL\` (local \`http://localhost:8787\`). Times are IST; every inbound event stores event time and received time.

`;
for (const [g, rs] of groups) {
  md += `## ${g}\n\n| Method | Path | Access |\n|---|---|---|\n`;
  for (const r of rs.sort((a, b) => a.path.localeCompare(b.path))) md += `| ${r.method} | \`${r.path}\` | ${auth(r.path)} |\n`;
  md += '\n';
}
md += `## Webhook contracts

- **WhatsApp** \`POST /webhooks/whatsapp\`: \`{ messageId, from (E.164), type: button|text|photo|voice, payload?, text?, taskId?, mediaRef?, caption?, sentAt? }\`. Idempotent on \`messageId\`; a repeat returns \`{ status: "duplicate_event" }\`. Nothing is stored from a helper without consent (409).
- **IVR / missed call** \`POST /webhooks/ivr\`: \`{ callId, from, event: arrive|exit|code, taskId?, visitId?, digits?, at? }\`. Idempotent on \`callId\`+event; calls from unregistered numbers never count.
- Production adapters must verify the vendor signature before this handler runs (decision D-06).
`;
writeFileSync('docs/api.md', md);
console.log(`docs/api.md: ${routes.length} routes`);
await db.close();
