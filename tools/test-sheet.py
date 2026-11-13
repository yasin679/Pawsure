"""
Builds docs/test-evidence/PS-TE-08_Test_Evidence_v1.1.0.xlsx from the latest test runs:
  e2e/results/results.json (Playwright), .data/vitest.json (Vitest), e2e/cases.json (steps / expected), docs/test-report.md (P0 scenarios).
Run after `npm run e2e` and `npx vitest run --reporter=json --outputFile=.data/vitest.json`:  python tools/test-sheet.py
"""
import json, re, datetime
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import CellIsRule
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
pw = json.loads((ROOT / 'e2e/results/results.json').read_text(encoding='utf-8'))
vt = json.loads((ROOT / '.data/vitest.json').read_text(encoding='utf-8'))
cat = json.loads((ROOT / 'e2e/cases.json').read_text(encoding='utf-8'))

FONT = 'Arial'
H_FILL = PatternFill('solid', start_color='20201D'); H_FONT = Font(name=FONT, bold=True, color='FFFDF0')
PASS_FILL = PatternFill('solid', start_color='E2F2E2'); FAIL_FILL = PatternFill('solid', start_color='FBE1DC')
THIN = Side(style='thin', color='CFC8AC'); BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical='top')
def style_table(ws, header_row, ncols, nrows, widths):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=header_row, column=c); cell.fill = H_FILL; cell.font = H_FONT; cell.alignment = Alignment(wrap_text=True, vertical='center'); cell.border = BORDER
        ws.column_dimensions[get_column_letter(c)].width = widths[c - 1]
    for r in range(header_row + 1, header_row + nrows + 1):
        for c in range(1, ncols + 1):
            cell = ws.cell(row=r, column=c); cell.font = Font(name=FONT, size=10); cell.alignment = WRAP; cell.border = BORDER
    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)
    ws.auto_filter.ref = f'A{header_row}:{get_column_letter(ncols)}{header_row + max(nrows, 1)}'
def status_colours(ws, col, first, last):
    rng = f'{col}{first}:{col}{last}'
    ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"Passed"'], fill=PASS_FILL))
    ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"Failed"'], fill=FAIL_FILL))

# ---------- collect Playwright results ----------
run_at = datetime.datetime.fromisoformat(pw['stats']['startTime'].replace('Z', '+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
e2e = []
def walk(suite):
    for s in suite.get('suites', []): walk(s)
    for sp in suite.get('specs', []):
        m = re.match(r'^([A-Z]\d+)\s+(.*)$', sp['title'])
        if not m: continue
        res = sp['tests'][0]['results'][-1]
        err = (res.get('error') or {}).get('message', '')
        e2e.append({'id': m.group(1), 'title': m.group(2), 'file': sp['file'], 'status': 'Passed' if res['status'] == 'passed' else 'Failed', 'secs': round(res['duration'] / 1000, 1), 'error': re.sub(r'\x1b\[[0-9;]*m', '', err)[:400]})
for s in pw['suites']: walk(s)
order = lambda c: (c['id'][0], int(c['id'][1:]))
e2e.sort(key=order)

wb = Workbook()
# ---------- E2E sheet ----------
ws = wb.active; ws.title = 'E2E Test Cases'
hdr = ['Test ID', 'Area', 'Role / actor', 'Preconditions', 'Test case', 'Steps', 'Expected result', 'Actual result', 'Status', 'Duration (s)', 'Spec file']
ws.append(hdr)
for c in e2e:
    meta = cat['cases'].get(c['id'], {})
    actual = 'As expected: every check in the test passed.' if c['status'] == 'Passed' else 'FAILED: ' + c['error']
    ws.append([c['id'], cat['areas'][c['id'][0]], meta.get('role', ''), meta.get('pre', ''), c['title'], meta.get('steps', ''), meta.get('expected', ''), actual, c['status'], c['secs'], c['file']])
n_e2e = len(e2e)
style_table(ws, 1, len(hdr), n_e2e, [8, 22, 18, 22, 42, 44, 42, 30, 10, 11, 22])
status_colours(ws, 'I', 2, n_e2e + 1)
E2E_LAST = n_e2e + 1

# ---------- API / rules sheet ----------
wa = wb.create_sheet('API & Rules Tests')
ah = ['#', 'Layer', 'Test file', 'Suite', 'Test', 'Status', 'Duration (ms)']
wa.append(ah)
rows = []
for f in vt['testResults']:
    rel = f['name'].replace('\\', '/').split('Pawsure-App/')[-1]
    layer = 'Domain rules' if rel.startswith('packages/domain') else 'Database' if rel.startswith('packages/db') else 'API integration'
    if 'security' in rel: layer = 'Security red-team'
    if 'acceptance' in rel: layer = 'P0 acceptance'
    for a in f['assertionResults']:
        rows.append([layer, rel, ' › '.join(a['ancestorTitles']), a['title'], 'Passed' if a['status'] == 'passed' else 'Failed', round(a.get('duration') or 0)])
for i, r in enumerate(rows, 1): wa.append([i] + r)
n_api = len(rows)
style_table(wa, 1, len(ah), n_api, [6, 18, 34, 40, 60, 10, 13])
status_colours(wa, 'F', 2, n_api + 1)
API_LAST = n_api + 1

# ---------- P0 scenarios (from docs/test-report.md) ----------
wp = wb.create_sheet('P0 Scenarios')
wp.append(['#', 'Mandatory P0 scenario (master prompt §13)', 'Result', 'Covered by (automated tests)'])
md = (ROOT / 'docs/test-report.md').read_text(encoding='utf-8')
scen = [l for l in md.splitlines() if re.match(r'^\| \d+ \|', l)]
for l in scen:
    parts = [p.strip() for p in l.strip('|').split('|')]
    wp.append([int(parts[0]), parts[1], 'Passed' if parts[2] == 'Pass' else 'Failed', parts[3].replace('<br>', '\n')])
style_table(wp, 1, 4, len(scen), [6, 60, 10, 80])
status_colours(wp, 'C', 2, len(scen) + 1)

# ---------- defects ----------
wd = wb.create_sheet('Defects Found & Fixed')
wd.append(['#', 'Area', 'Defect found during testing', 'Fix', 'Verified by', 'Status'])
for i, d in enumerate(cat['defects'], 1): wd.append([i] + d + ['Fixed and re-tested'])
style_table(wd, 1, 6, len(cat['defects']), [5, 14, 60, 50, 18, 18])


# ---------- security checks ----------
wsx = wb.create_sheet('Security Checks')
wsx.append(['#', 'Check', 'What was tried', 'Result', 'Evidence'])
for i, r in enumerate(cat.get('security', []), 1): wsx.append([i] + r)
style_table(wsx, 1, 5, len(cat.get('security', [])), [5, 26, 46, 52, 30])

# ---------- summary (formulas over the other sheets) ----------
s = wb.create_sheet('Summary', 0)
s['A1'] = 'PS-TE-08 Test Evidence v1.1.0 — Pawsure P0 test execution summary'; s['A1'].font = Font(name=FONT, bold=True, size=16)
s['A2'] = f'Run on {run_at:%d %b %Y, %H:%M} IST · demo build (real app, API and database in the browser) · Chrome via Playwright 1.48 · Vitest 2'; s['A2'].font = Font(name=FONT, size=10, italic=True)
s.append([])
s.append(['Area', 'Test cases', 'Passed', 'Failed', 'Pass rate'])
hr = s.max_row
area_rows = []
for k, name in cat['areas'].items():
    r = s.max_row + 1
    s.append([name,
              f"=COUNTIF('E2E Test Cases'!$B$2:$B${E2E_LAST},A{r})",
              f"=COUNTIFS('E2E Test Cases'!$B$2:$B${E2E_LAST},A{r},'E2E Test Cases'!$I$2:$I${E2E_LAST},\"Passed\")",
              f"=COUNTIFS('E2E Test Cases'!$B$2:$B${E2E_LAST},A{r},'E2E Test Cases'!$I$2:$I${E2E_LAST},\"Failed\")",
              f'=IF(B{r}=0,"-",C{r}/B{r})'])
    area_rows.append(r)
tr = s.max_row + 1
s.append(['End-to-end total (screens)', f'=SUM(B{area_rows[0]}:B{area_rows[-1]})', f'=SUM(C{area_rows[0]}:C{area_rows[-1]})', f'=SUM(D{area_rows[0]}:D{area_rows[-1]})', f'=IF(B{tr}=0,"-",C{tr}/B{tr})'])
ar = s.max_row + 1
s.append(['API, rules, security and acceptance tests', f"=COUNTA('API & Rules Tests'!$E$2:$E${API_LAST})", f"=COUNTIF('API & Rules Tests'!$F$2:$F${API_LAST},\"Passed\")", f"=COUNTIF('API & Rules Tests'!$F$2:$F${API_LAST},\"Failed\")", f'=IF(B{ar}=0,"-",C{ar}/B{ar})'])
pr = s.max_row + 1
s.append(['Mandatory P0 scenarios (§13)', f"=COUNTA('P0 Scenarios'!$B$2:$B${len(scen) + 1})", f"=COUNTIF('P0 Scenarios'!$C$2:$C${len(scen) + 1},\"Passed\")", f"=COUNTIF('P0 Scenarios'!$C$2:$C${len(scen) + 1},\"Failed\")", f'=IF(B{pr}=0,"-",C{pr}/B{pr})'])
gr = s.max_row + 1
s.append(['All automated tests', f'=B{tr}+B{ar}', f'=C{tr}+C{ar}', f'=D{tr}+D{ar}', f'=IF(B{gr}=0,"-",C{gr}/B{gr})'])
for c in range(1, 6):
    cell = s.cell(row=hr, column=c); cell.fill = H_FILL; cell.font = H_FONT; cell.border = BORDER
for r in range(hr + 1, gr + 1):
    for c in range(1, 6):
        cell = s.cell(row=r, column=c); cell.font = Font(name=FONT, size=10, bold=r >= tr); cell.border = BORDER
    s.cell(row=r, column=5).number_format = '0.0%'
s.append([])
vr = s.max_row + 1
s.append(['Verdict', f'=IF(AND(D{gr}=0,D{pr}=0),"All flows working: every test passed","Failures found: see the red rows")'])
s.cell(row=vr, column=1).font = Font(name=FONT, bold=True, size=12); s.cell(row=vr, column=2).font = Font(name=FONT, bold=True, size=12)
s.append([])
s.append(['Defects found and fixed during this testing', f"=COUNTA('Defects Found & Fixed'!$C$2:$C${len(cat['defects']) + 1})"])
s.append([])
s.append(['Notes']); s.cell(row=s.max_row, column=1).font = Font(name=FONT, bold=True)
for n in cat['notes']:
    s.append([n]); s.cell(row=s.max_row, column=1).font = Font(name=FONT, size=10)
s.column_dimensions['A'].width = 44
for col in 'BCDE': s.column_dimensions[col].width = 13
wb.calculation.fullCalcOnLoad = True  # Excel computes the summary formulas on open
out = ROOT / 'docs/test-evidence/PS-TE-08_Test_Evidence_v1.1.0.xlsx'
out.parent.mkdir(exist_ok=True)
wb.save(out)
print(json.dumps({'file': str(out), 'e2e': n_e2e, 'e2e_passed': sum(c['status'] == 'Passed' for c in e2e), 'api': n_api, 'api_passed': sum(r[4] == 'Passed' for r in rows), 'scenarios': len(scen), 'scen_passed': sum(1 for l in scen if '| Pass |' in l), 'missing_catalog': [c['id'] for c in e2e if c['id'] not in cat['cases']]}))
