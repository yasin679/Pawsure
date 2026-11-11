"""
Generates docs/uat-test-cases.md (PS-UAT-06) from e2e/cases.json and the latest Playwright results,
so the UAT document always matches the automated tests.  Run: python docs/build/gen_uat.py
"""
import json, re, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
cat = json.loads((ROOT / 'e2e/cases.json').read_text(encoding='utf-8'))
pw = json.loads((ROOT / 'e2e/results/results.json').read_text(encoding='utf-8'))
status, titles = {}, {}
def walk(s):
    for x in s.get('suites', []): walk(x)
    for sp in s.get('specs', []):
        m = re.match(r'^([A-Z]\d+)\s+(.*)$', sp['title'])
        if m:
            titles[m.group(1)] = m.group(2)
            status[m.group(1)] = 'Pass' if sp['tests'][0]['results'][-1]['status'] == 'passed' else 'Fail'
for s in pw['suites']: walk(s)
run = datetime.datetime.fromisoformat(pw['stats']['startTime'].replace('Z', '+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
HIGH = set('ADEGMN')
cell = lambda t: t.replace('|', '\\|').replace('\n', '<br>')
key = lambda i: (i[0], int(i[1:]))
ids = sorted(cat['cases'], key=key)
passed = sum(1 for i in ids if status.get(i) == 'Pass')

out = [f"""---
id: PS-UAT-06
title: UAT Test Cases
subtitle: {len(ids)} acceptance test cases with steps, expected results and the latest result
audience: Testers, product owner and sign-off owners
---

# UAT Test Cases

## 1 About these test cases

Each case below is also an automated end-to-end test (Playwright, in Chrome) that drives the real screens against the demo build. A tester can run it by hand with the steps shown, or all of them with `npm run e2e`. The **P/F** column shows the result of the latest automated run.

| Item | Value |
|---|---|
| Latest run | {run:%d %b %Y, %H:%M} IST |
| Result | **{passed} of {len(ids)} passed** |
| Build | Demo build (the real app, API and database in the browser), Chrome, 390 px phone width; console at 1280 px |
| Demo numbers | Owner 98000 00021 · Co-owner 98000 00022 · Backup 97000 00008 · Helper 90000 00035 · Friends 99000 00012, 98000 00077, 97000 00090 · Staff 98110 00001–4 |
| Evidence | PS-TE-08 Test Evidence workbook; `e2e/report` (HTML report with traces on failure) |

Priority: **H** high (sign-in, daily care, helper check-ins, Find cover, security), **M** medium.

> [!NOTE]
> The demo clock starts at 9:00 AM on 6 Nov 2026. Steps that say “clock to” use the demo bar (**+5m**, **+15m**, **+1h**).
"""]
n = 2
for area, name in cat['areas'].items():
    rows = [i for i in ids if i.startswith(area) and re.match(rf'^{area}\d+$', i)]
    if not rows: continue
    out.append(f"\n## {n} {name}\n\n| ID | Pri | Test | Steps | Expected result | P/F |\n|---|---|---|---|---|---|")
    for i in rows:
        c = cat['cases'][i]
        out.append(f"| {i} | {'H' if area in HIGH else 'M'} | {cell(titles.get(i, ''))} | {cell(c['steps'])} | {cell(c['expected'])} | {status.get(i, 'Not run')} |")
    n += 1
out.append(f"""
## {n} Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Product owner | | Accept / Reject | |
| Operations lead | | Accept / Reject | |
| Privacy lead | | Accept / Reject | |
| QA | | Accept / Reject | |
""")
(ROOT / 'docs/uat-test-cases.md').write_text('\n'.join(out), encoding='utf-8')
print(f'uat-test-cases.md: {len(ids)} cases, {passed} passed')
