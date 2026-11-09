/**
 * Test execution report (master prompt §17 item 9): runs the whole suite, then maps each of the 24 mandatory P0
 * end-to-end scenarios (§13) to the tests that cover it and records pass/fail. Run: npx tsx tools/test-report.mts
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('.data', { recursive: true });
try { execSync('npx vitest run --reporter=json --outputFile=.data/vitest.json', { stdio: 'ignore' }); } catch { /* failures are reported below */ }
type T = { fullName: string; status: string; title: string; ancestorTitles: string[] };
const raw = JSON.parse(readFileSync('.data/vitest.json', 'utf8')) as { numTotalTests: number; numPassedTests: number; numFailedTests: number; startTime: number; testResults: { name: string; assertionResults: T[] }[] };
const tests = raw.testResults.flatMap(f => f.assertionResults.map(a => ({ ...a, file: f.name.replace(/\\/g, '/').replace(/.*Pawsure-App\//, '') })));

// Scenario → patterns over "describe > it" names. Each must match at least one test; level says where it is proven.
const S: [number, string, RegExp[]][] = [
  [1, 'Owner creates pet/routine; Who’s caring today without optional fields', [/#1 new owner/]],
  [2, 'Helper consents in Marathi, selects method and withdraws', [/invite sends W1 consent in Marathi/, /Yes → method menu → method stored; “stop” withdraws/]],
  [3, 'WhatsApp photo with today’s code: correct pet/task/time; confidence and points', [/#3 photo with today’s code alone is Likely/, /photo \+ today’s code alone → Likely/, /Confirmed helper task earns 5 points/]],
  [4, 'Registered-number arrival/exit IVR and code; duration and reason codes', [/#4 visit shorter/, /calls from an unregistered number never count/, /IVR keypad code counts only if it is today’s/]],
  [5, 'No gate app: own-helper path works; random photo 1 in 5', [/#5 random photo prompts rise/, /random photo checks about 1 in 5/, /own-helper path still works without a gate app/]],
  [6, 'Missed check-in: owner then backup escalation and event log', [/#6 steps fire in order/, /escalation fires once per step/]],
  [7, 'Standard escalation exact defaults; acknowledgement stops later steps', [/#7 4 PM task/, /#7 owner acknowledgement stops/]],
  [8, 'Backup look-in expires after 15 min; authorised scope; every open logged', [/#8 look-in link/, /backup link is logged on every open/]],
  [9, 'Helper reports pet sick: incident, parallel alert, emergency card, no AI diagnosis', [/#9 helper reports/, /S1 incident creates an ops case/]],
  [10, 'Trusted Helper: no helper monitoring/alerts/points; health/emergency remain', [/#10 Trusted Helper mode creates no monitoring/, /#10 no helper prompts/]],
  [11, 'Helper says Not now: no signals; owner offered alternatives; no “failed”', [/“Not now” records a refusal/, /no evidence is collected from a helper without consent/]],
  [12, 'Covered care day samples incl. Matched, Trusted tap, no-tap Unknown', [/Confirmed \+ Likely \+ Matched → Covered/, /Trusted Helper: tap = Covered/, /#12 return check contradicting/]],
  [13, 'Friend Finder: suitable friend, medicine exclusion, opt-out, privacy, Ask all 3, no-response, ambiguous AI, block/report', [/friends-first, nearest-first/, /medicine requests exclude/, /opting out removes a friend/, /first yes holds/, /ambiguous medicine/, /block \/ report creates an ops case/, /#27 no friend free/]],
  [14, 'Rewards mismatch hold/appeal; no misconduct label', [/#14 mismatch holds points/, /a hold needs a reason the helper can read/]],
  [15, 'Helper record share: counts only; revoke disables link', [/flag ON the link shows counts only/]],
  [16, 'Role/access revocation within 60 s, including links', [/a revoked member loses API access at once/, /dies on revocation/]],
  [17, 'Rights request from WhatsApp: record, stop future processing, audit', [/“delete my data” creates an erasure request/, /“my data” opens an access request/]],
  [18, 'Arrival/exit only = visit only; task Not confirmed', [/#18 arrival\/exit only/]],
  [19, 'Duplicate old photo hash does not count', [/#19 a duplicate image hash/, /re-sent image never counts/]],
  [20, 'Cancelled task excluded; partly done lists skipped items', [/#20 cancel needs a reason/, /#20 partly done/]],
  [21, 'Friend no-show at task + 20 min → owner alert and backup', [/#21 no friend signal/]],
  [22, 'S1 no answer: calls ×3 every 5 min; all care circle at 15; ops case', [/#22 S1 with no answer/, /S1 emergency unacknowledged for 15 minutes/]],
  [23, 'LLM disabled: manual form still completes Friend Finder', [/AI unavailable or low confidence → manual form/]],
  [24, 'Trusted Helper day with no Covered tap → Unknown, not covered', [/#24 no “Covered” tap/, /Trusted Helper: tap = Covered, no tap = Unknown/]]
];
const name = (t: T) => [...t.ancestorTitles, t.title].join(' > ');
const rows = S.map(([n, label, pats]) => {
  const hits = tests.filter(t => pats.some(p => p.test(name(t))));
  const missing = pats.filter(p => !tests.some(t => p.test(name(t))));
  const ok = hits.length > 0 && missing.length === 0 && hits.every(h => h.status === 'passed');
  return { n, label, ok, hits, missing };
});
const byFile = new Map<string, { pass: number; fail: number }>();
tests.forEach(t => { const f = byFile.get(t.file) ?? { pass: 0, fail: 0 }; t.status === 'passed' ? f.pass++ : f.fail++; byFile.set(t.file, f); });
const md = `# Test execution report

Run ${new Date(raw.startTime).toISOString()} · **${raw.numPassedTests} of ${raw.numTotalTests} passed**, ${raw.numFailedTests} failed · generated by \`tools/test-report.mts\`

## By file

| File | Passed | Failed |
|---|---|---|
${[...byFile].map(([f, c]) => `| ${f} | ${c.pass} | ${c.fail} |`).join('\n')}

## Mandatory P0 end-to-end scenarios (§13)

**${rows.filter(r => r.ok).length} of ${rows.length} covered and passing.**

| # | Scenario | Result | Covered by |
|---|---|---|---|
${rows.map(r => `| ${r.n} | ${r.label} | ${r.ok ? 'Pass' : '**Fail / gap**'} | ${r.hits.map(h => `${h.file.split('/').pop()}: ${h.title}`).join('<br>')}${r.missing.length ? '<br>Missing: ' + r.missing.map(String).join(', ') : ''} |`).join('\n')}

## Not covered by automated tests

- Real vendor behaviour (WhatsApp BSP, IVR, SMS, push, LLM): mocks only until contracts exist.
- Browser end-to-end and accessibility audits: checked by hand in the in-app browser; no automated browser suite yet.
- Network/TLS latency: the load test runs in-process (docs/runbooks/load-test.md).
`;
writeFileSync('docs/test-report.md', md);
console.log(`${raw.numPassedTests}/${raw.numTotalTests} tests · scenarios ${rows.filter(r => r.ok).length}/${rows.length}`);
rows.filter(r => !r.ok).forEach(r => console.log(`#${r.n} gap: missing ${r.missing.map(String).join(', ')} hits ${r.hits.map(h => h.status).join(',')}`));
