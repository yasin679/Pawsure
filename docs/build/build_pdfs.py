#!/usr/bin/env python3
"""
Builds the PDF versions of the Pawsure guides in docs/ from their Markdown sources, in the Pawsure design.

    pip install markdown pypdf playwright       (uses the installed Google Chrome)
    python docs/build/build_pdfs.py             # all documents
    python docs/build/build_pdfs.py user-guide  # one document

Each PDF gets a cover, a document-control page, a table of contents with page numbers, running headers and
footers. Mermaid diagrams are drawn. Output goes to docs/pdf/.
"""
import base64
import html
import io
import re
import sys
from pathlib import Path

import markdown
from playwright.sync_api import sync_playwright
from pypdf import PdfReader, PdfWriter

DOCS = Path(__file__).resolve().parent.parent
OUT = DOCS / "pdf"
PRODUCT = "Pawsure"
VERSION = "1.0"
DATE = "10-Nov-2026"
AUTHOR = "Yasin Jariwala"
CLASSIFICATION = "Internal — pilot"
REPO = "github.com/yasin679/Pawsure"

DOCUMENTS = [
    ("user-guide", "PS-UG-01_User_Guide"),
    ("installation-and-administration", "PS-IG-02_Installation_and_Administration_Guide"),
    ("quick-start", "PS-QS-03_Quick_Start"),
    ("faq-and-troubleshooting", "PS-FAQ-04_FAQ_and_Troubleshooting"),
    ("technical-design", "PS-TD-05_Technical_Design"),
    ("uat-test-cases", "PS-UAT-06_UAT_Test_Cases"),
    ("release-notes", "PS-RN-07_Release_Notes_v1.0"),
]
EXTRA_RELATED = [("PS-TE-08", "Test Evidence v1.0 (Excel workbook)")]
HISTORY = [("1.0", DATE, AUTHOR, "First release: P0 pilot build (phases 0–5), full test pass, login isolation and security hardening")]

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Nunito:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&family=Noto+Sans+Devanagari:wght@400;600&display=swap">'
MERMAID = '<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script><script>mermaid.initialize({startOnLoad:true,theme:"base",themeVariables:{fontFamily:"Nunito, sans-serif",primaryColor:"#FFF1BC",primaryBorderColor:"#20201D",primaryTextColor:"#20201D",lineColor:"#47463E",secondaryColor:"#F4EED8",tertiaryColor:"#FFFDF0"}});</script>'
CALLOUT_TITLES = {"NOTE": "Note", "TIP": "Tip", "IMPORTANT": "Important", "WARNING": "Warning", "CAUTION": "Caution"}
# Phone screenshots are tall: show them narrower than wide (console) screenshots.
PHONE_W, WIDE_W = 46, 100


def front_matter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    meta = {}
    if m:
        for line in m.group(1).splitlines():
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
        text = text[m.end():]
    return meta, text


def md_to_html(text):
    return markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"], output_format="html5")


def callouts(text):
    """GitHub alert blocks (> [!NOTE] ...) to <div class="callout ..."> with Markdown inside."""
    out, lines, i = [], text.split("\n"), 0
    while i < len(lines):
        m = re.match(r"^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$", lines[i])
        if not m:
            out.append(lines[i]); i += 1; continue
        kind, body = m.group(1), []
        i += 1
        while i < len(lines) and lines[i].startswith(">"):
            body.append(lines[i][2:] if lines[i].startswith("> ") else lines[i][1:]); i += 1
        out.append(f'\n<div class="callout {kind.lower()}">{md_to_html(chr(10).join(body))}</div>\n')
    return "\n".join(out)


def mermaid_blocks(text):
    return re.sub(r"```mermaid\n(.*?)```", lambda m: f'<div class="diagram"><pre class="mermaid">{html.escape(m.group(1))}</pre></div>', text, flags=re.S)


def figures(body):
    """A paragraph holding only an image becomes a figure with its alt text as the caption."""
    def fig(m):
        alt, src = html.unescape(m.group(1)), m.group(2)
        wide = re.match(r"images/(5\d|6\d)-", src) is not None  # console screenshots
        width = WIDE_W if wide else PHONE_W
        return (f'<figure class="{"wide" if wide else "phone"}"><img src="{src}" style="max-width:{width}%" alt="{html.escape(alt)}">'
                f'<figcaption>{html.escape(alt)}</figcaption></figure>')
    return re.sub(r'<p><img alt="([^"]*)" src="([^"]+)"\s*/?></p>', fig, body)


def body_html(md_text):
    text = mermaid_blocks(callouts(md_text))
    text = re.sub(r"^# .*\n", "", text, count=1, flags=re.M)  # the title is on the cover
    body = figures(md_to_html(text))
    heads = []
    def anchor(m):
        level, title = int(m.group(1)), m.group(2)
        hid = f"h{len(heads)}"
        heads.append((level, re.sub(r"<[^>]+>", "", html.unescape(title)), hid))
        cls = ' class="chapter"' if level == 2 else ""
        return f'<h{level} id="{hid}"{cls}>{title}</h{level}>'
    body = re.sub(r"<h([23])>(.*?)</h\1>", anchor, body)
    body = re.sub(r"<table>(\s*<thead>\s*<tr>\s*<th>ID</th>\s*<th>Pri</th>)", r'<table class="cases">\1', body)
    body = re.sub(r"<td>(Pass)</td>", r'<td><span class="st st-pass">PASS</span></td>', body)
    body = re.sub(r"<td>(Fail|Not run)</td>", r'<td><span class="st st-fail">\1</span></td>', body)
    body = marker_tables(body)
    return body, heads


def marker_tables(body):
    """In a table right after a figure whose first header is '#', render the number as a marker like the screenshots."""
    def fix(table):
        if not re.search(r"<thead>\s*<tr>\s*<th>#</th>", table):
            return table
        table = table.replace("<th>#</th>", '<th style="width:22pt;text-align:center">#</th>', 1)
        return re.sub(r"<tr>\s*<td>(\d+)</td>", r'<tr><td class="mk"><span>\1</span></td>', table)
    return re.sub(r"<table>.*?</table>", lambda m: fix(m.group(0)), body, flags=re.S)


def related_rows(current_id):
    rows = []
    for slug, _ in DOCUMENTS:
        meta, _ = front_matter((DOCS / f"{slug}.md").read_text(encoding="utf-8"))
        if meta["id"] != current_id:
            rows.append(f"<tr><td>{meta['id']}</td><td>{html.escape(meta['title'])}</td></tr>")
    rows += [f"<tr><td>{i}</td><td>{html.escape(t)}</td></tr>" for i, t in EXTRA_RELATED]
    return "".join(rows)


CSS = """
@page { size: A4; }
:root { --ink:#20201D; --ink2:#47463E; --ink3:#6E6A57; --line:#E9E2C7; --line2:#CFC8AC; --cream:#FFFDF0; --beige:#F4EED8; --yellow:#FFC400; --ysoft:#FFF1BC;
  --marigold:#A84C08; --msoft:#FFE6D0; --alert:#B3261E; --asoft:#FBE1DC; --info:#2D5B87; --isoft:#E3EDF7; --ok:#2B7034; --oksoft:#E2F2E2; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10pt/1.55 "Nunito", "Noto Sans Devanagari", "Segoe UI", sans-serif; color: var(--ink); }
h2, h3, h4 { font-family: "Baloo 2", "Nunito", sans-serif; color: var(--ink); break-after: avoid; line-height: 1.2; }
h2.chapter { font-size: 21pt; font-weight: 700; margin: 0 0 10pt; padding-bottom: 5pt; border-bottom: 4pt solid var(--yellow); break-before: page; }
h2.chapter.first { break-before: auto; }
.flow h2.chapter { break-before: auto; margin-top: 20pt; }
h3 { font-size: 13.5pt; font-weight: 700; margin: 16pt 0 5pt; }
h3::before { content: ""; display: inline-block; width: 7pt; height: 7pt; border-radius: 50%; background: var(--yellow); border: 1.2pt solid var(--ink); margin-right: 6pt; transform: translateY(-1.5pt); }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; } li { margin: 0 0 3pt; }
strong { font-weight: 800; }
a { color: var(--marigold); text-decoration: none; }
code { font: 8.4pt "JetBrains Mono", "Cascadia Mono", monospace; background: var(--beige); border-radius: 3pt; padding: 0 3pt; color: #5a3a10; }
pre { background: #fbf8ec; border: .6pt solid var(--line); border-left: 3.5pt solid var(--yellow); border-radius: 6pt; padding: 7pt 9pt; margin: 0 0 9pt;
  white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.2pt; line-height: 1.45; color: var(--ink); }
table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 4pt 0 11pt; font-size: 8.9pt; border: .7pt solid var(--line2); border-radius: 7pt; overflow: hidden; }
thead { display: table-header-group; }
th { background: var(--ink); color: var(--cream); text-align: left; font-weight: 700; padding: 5pt 7pt; font-size: 8.5pt; }
td { padding: 4.5pt 7pt; border-top: .6pt solid var(--line); vertical-align: top; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) td { background: #fdfbf2; }
figure { margin: 6pt 0 10pt; text-align: center; break-inside: avoid; break-after: avoid; }
figure img { width: auto; max-height: 150mm; border: .8pt solid var(--line2); border-radius: 9pt; }
figure.wide img { max-height: 120mm; }
figcaption { font-size: 8.4pt; color: var(--ink3); margin-top: 4pt; font-weight: 600; }
.diagram { break-inside: avoid; margin: 6pt 0 12pt; text-align: center; }
.diagram pre.mermaid { background: none; border: 0; padding: 0; white-space: pre; }
.diagram svg { max-width: 100%; height: auto; max-height: 150mm; }
.callout { border-radius: 8pt; padding: 8pt 11pt 4pt; margin: 4pt 0 11pt; border: 1.2pt solid; break-inside: avoid; }
.callout p:first-child strong:first-child { display: block; margin-bottom: 1pt; }
.callout.note { background: var(--isoft); border-color: var(--info); }
.callout.tip { background: var(--oksoft); border-color: var(--ok); }
.callout.important { background: var(--ysoft); border-color: var(--ink); }
.callout.warning { background: var(--msoft); border-color: var(--marigold); }
.callout.caution { background: var(--asoft); border-color: var(--alert); }
.st { display: inline-block; font: 800 7pt "Nunito", sans-serif; letter-spacing: .04em; padding: 1.5pt 6pt; border-radius: 8pt; white-space: nowrap; }
.st-pass { background: var(--oksoft); color: var(--ok); } .st-fail { background: var(--asoft); color: var(--alert); }
td.mk { width: 22pt; text-align: center; padding-top: 4pt; }
td.mk span { display: inline-block; width: 15pt; height: 15pt; line-height: 15pt; border-radius: 50%; background: var(--marigold); color: #fff; font-weight: 800; font-size: 7.8pt; }
.compact table { font-size: 7.9pt; } .compact td { padding: 3.5pt 5pt; }
.compact table.cases { table-layout: fixed; }
.compact table.cases th:nth-child(1) { width: 7%; } .compact table.cases th:nth-child(2) { width: 5%; }
.compact table.cases th:nth-child(3) { width: 22%; } .compact table.cases th:nth-child(4) { width: 30%; }
.compact table.cases th:nth-child(5) { width: 27%; } .compact table.cases th:nth-child(6) { width: 9%; }
.compact table.cases td:first-child { white-space: nowrap; font-weight: 800; color: var(--marigold); }
.front h2 { font-family: "Baloo 2", sans-serif; font-size: 16pt; margin: 0 0 8pt; border: 0; }
.front table td:first-child { width: 34%; color: var(--ink2); font-weight: 700; }
.front section { margin-bottom: 20pt; }
.toc div { display: flex; align-items: baseline; gap: 4pt; padding: 1.3pt 0; }
.toc .l2 { font-weight: 800; margin-top: 4pt; }
.toc .l3 { padding-left: 16pt; color: var(--ink2); font-size: 9pt; }
.toc .dots { flex: 1; border-bottom: .9pt dotted var(--line2); transform: translateY(-3pt); }
.toc .pg { min-width: 14pt; text-align: right; font-variant-numeric: tabular-nums; }
"""

COVER_CSS = """
@page { size: A4; margin: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "Nunito", sans-serif; }
.cover { width: 210mm; height: 296.5mm; background: #FFFDF0; color: #20201D; position: relative; overflow: hidden; }
.cover .band { position: absolute; left: 0; right: 0; top: 0; height: 92mm; background: #FFC400; border-bottom: 1.4mm solid #20201D; }
.cover .blob { position: absolute; right: -30mm; top: 40mm; width: 120mm; height: 120mm; border-radius: 50%; background: #FFF1BC; border: 1.2mm solid #20201D; }
.cover .art { position: absolute; right: 18mm; top: 46mm; width: 86mm; height: 84mm; background-repeat: no-repeat; background-color: #fff; border: 1.2mm solid #20201D; border-radius: 9mm; box-shadow: 2.5mm 2.5mm 0 #20201D; }
.cover .brand { position: absolute; left: 20mm; top: 22mm; display: flex; gap: 4mm; align-items: center; }
.cover .mark { width: 15mm; height: 15mm; border-radius: 4.5mm; background: #20201D; display: grid; place-items: center; }
.cover .brand b { display: block; font: 800 24pt/1 "Baloo 2", sans-serif; }
.cover .brand small { display: block; font-size: 9pt; font-weight: 700; margin-top: 1mm; color: #47463E; }
.cover .titles { position: absolute; left: 20mm; right: 22mm; top: 146mm; }
.cover .eyebrow { display: inline-block; background: #20201D; color: #FFC400; letter-spacing: .14em; font-size: 8.5pt; font-weight: 800; text-transform: uppercase; padding: 1.4mm 3.2mm; border-radius: 10mm; margin-bottom: 6mm; }
.cover h1 { font: 800 38pt/1.02 "Baloo 2", sans-serif; margin: 0 0 5mm; }
.cover .sub { font-size: 13.5pt; color: #47463E; line-height: 1.45; max-width: 150mm; font-weight: 600; }
.cover .meta { position: absolute; left: 20mm; right: 20mm; bottom: 34mm; border-left: 2.2mm solid #FFC400; padding: 1mm 0 1mm 6mm; font-size: 9.5pt; color: #47463E; line-height: 1.8; }
.cover .meta b { color: #20201D; }
.cover .foot { position: absolute; left: 20mm; right: 20mm; bottom: 14mm; display: flex; justify-content: space-between; font-size: 8pt; color: #6E6A57; border-top: .4mm solid #CFC8AC; padding-top: 3mm; font-weight: 700; }
"""
PAW = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#FFC400" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="15.5" rx="4.2" ry="3.6"/><circle cx="6.2" cy="10.6" r="1.8"/><circle cx="9.6" cy="6.6" r="1.9"/><circle cx="14.4" cy="6.6" r="1.9"/><circle cx="17.8" cy="10.6" r="1.8"/></svg>'


def cover_art():
    """The ‘family’ mascot crop from the design board (same crop as the app: x 60, y 785, 165 × 160 of 1600 × 1072)."""
    board = DOCS.parent / "apps/web/public/assets/design-board.jpg"
    data = base64.b64encode(board.read_bytes()).decode()
    scale = 86 / 165  # mm per source pixel for an 86 mm wide crop
    return (f"background-image:url(data:image/jpeg;base64,{data});background-size:{1600*scale:.1f}mm {1072*scale:.1f}mm;"
            f"background-position:-{60*scale:.1f}mm -{785*scale:.1f}mm")


def build(slug, out_name, browser, art_style):
    meta, md_text = front_matter((DOCS / f"{slug}.md").read_text(encoding="utf-8"))
    body, heads = body_html(md_text)
    body = body.replace('<h2 id="h0" class="chapter">', '<h2 id="h0" class="chapter first">', 1)
    title, doc_id = meta["title"], meta["id"]
    cls = (" compact" if slug == "uat-test-cases" else "") + (" flow" if slug in ("uat-test-cases", "release-notes", "quick-start") else "")

    def page_html(toc_pages):
        toc = "".join(f'<div class="l{lvl}"><span>{html.escape(t)}</span><span class="dots"></span><span class="pg">{toc_pages.get(hid, "")}</span></div>' for lvl, t, hid in heads)
        history = "".join(f"<tr><td>{v}</td><td>{d}</td><td>{a}</td><td>{html.escape(c)}</td></tr>" for v, d, a, c in HISTORY)
        front = f"""
<div class="front">
<section><h2>Document control</h2><table><tbody>
<tr><td>Document</td><td>{html.escape(title)}</td></tr><tr><td>Document ID</td><td>{doc_id}</td></tr>
<tr><td>Version</td><td>{VERSION}</td></tr><tr><td>Date</td><td>{DATE}</td></tr>
<tr><td>Prepared by</td><td>{AUTHOR}</td></tr><tr><td>Product</td><td>{PRODUCT} v{VERSION} (P0 pilot build)</td></tr>
<tr><td>Audience</td><td>{html.escape(meta.get('audience', ''))}</td></tr><tr><td>Classification</td><td>{CLASSIFICATION}</td></tr>
<tr><td>Source</td><td>{REPO} · docs/{slug}.md</td></tr>
</tbody></table></section>
<section><h2>Version history</h2><table><thead><tr><th style="width:12%">Version</th><th style="width:16%">Date</th><th style="width:20%">Author</th><th>Changes</th></tr></thead><tbody>{history}</tbody></table></section>
<section><h2>Related documents</h2><table><thead><tr><th style="width:22%">ID</th><th>Document</th></tr></thead><tbody>{related_rows(doc_id)}</tbody></table></section>
</div>
<div style="break-before:page"></div>
<div class="front"><h2>Contents</h2><div class="toc">{toc}</div></div>
<div style="break-before:page"></div>
"""
        return f'<!doctype html><html><head><meta charset="utf-8">{FONTS}<style>{CSS}</style>{MERMAID}</head><body class="{cls}">{front}{body}</body></html>'

    header = (f'<div style="width:100%;font:7.5pt Nunito,sans-serif;color:#6E6A57;padding:0 16mm;display:flex;justify-content:space-between">'
              f'<span><b style="color:#20201D">{PRODUCT}</b> <span style="display:inline-block;width:6pt;height:6pt;border-radius:50%;background:#FFC400;border:.8pt solid #20201D;vertical-align:middle"></span></span><span>{html.escape(title)}</span></div>')
    footer = (f'<div style="width:100%;font:7.5pt Nunito,sans-serif;color:#6E6A57;padding:0 16mm;display:flex;justify-content:space-between">'
              f'<span>{doc_id} · Version {VERSION} · {CLASSIFICATION}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>')
    page = browser.new_page()
    tmp = DOCS / f".build-{slug}.html"   # loaded from a file so relative image paths resolve

    def render(html_text):
        tmp.write_text(html_text, encoding="utf-8")
        page.goto(tmp.as_uri(), wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        if "mermaid" in html_text and 'class="mermaid"' in html_text:
            page.wait_for_function("[...document.querySelectorAll('pre.mermaid')].every(p => p.querySelector('svg'))", timeout=30000)
        return page.pdf(format="A4", print_background=True, display_header_footer=True, header_template=header, footer_template=footer,
                        margin={"top": "19mm", "bottom": "17mm", "left": "16mm", "right": "16mm"})

    # Pass 1 finds the page of every heading; pass 2 writes the page numbers into the contents.
    first = render(page_html({}))
    texts = [re.sub(r"\s+", " ", p.extract_text() or "") for p in PdfReader(io.BytesIO(first)).pages]
    pages, start = {}, 2
    for lvl, t, hid in heads:
        needle = re.sub(r"\s+", " ", t).strip()
        for i in range(start, len(texts)):
            if needle in texts[i]:
                pages[hid] = i + 1  # matches the footer numbering (the cover is not numbered)
                start = i
                break
    body_pdf = render(page_html(pages))
    tmp.unlink(missing_ok=True)

    meta_line = f"<b>Document ID</b> {doc_id} · <b>Version</b> {VERSION} · <b>Date</b> {DATE}<br><b>Prepared by</b> {AUTHOR}<br><b>Audience</b> {html.escape(meta.get('audience', ''))}"
    cover = f"""<!doctype html><html><head><meta charset="utf-8">{FONTS}<style>{COVER_CSS}</style></head><body><div class="cover">
<div class="band"></div><div class="blob"></div><div class="art" style="{art_style}"></div>
<div class="brand"><div class="mark">{PAW}</div><div><b>{PRODUCT}</b><small>Be sure, whoever’s caring.</small></div></div>
<div class="titles"><div class="eyebrow">{doc_id}</div><h1>{html.escape(title)}</h1><div class="sub">{html.escape(meta.get('subtitle', ''))}</div></div>
<div class="meta">{meta_line}</div>
<div class="foot"><span>{CLASSIFICATION}</span><span>{PRODUCT} v{VERSION}</span></div></div></body></html>"""
    page.set_content(cover, wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    cover_pdf = page.pdf(format="A4", print_background=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
    page.close()

    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(cover_pdf)), pages=(0, 1))
    writer.append(PdfReader(io.BytesIO(body_pdf)))
    writer.add_metadata({"/Title": f"{PRODUCT} – {title}", "/Author": AUTHOR, "/Subject": f"{doc_id} v{VERSION}", "/Creator": PRODUCT})
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{out_name}.pdf"
    with open(path, "wb") as f:
        writer.write(f)
    print(f"{path.relative_to(DOCS.parent)}  ({len(writer.pages)} pages)")


def main():
    only = set(sys.argv[1:])
    art = cover_art()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        for slug, out_name in DOCUMENTS:
            if not only or slug in only:
                build(slug, out_name, browser, art)
        browser.close()


if __name__ == "__main__":
    main()
