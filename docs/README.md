# Documentation

## Document set (v1.0)

| ID | Document | For | Read online | PDF |
|---|---|---|---|---|
| PS-UG-01 | User Guide | Pet owners, care circle, helpers, friends | [user-guide.md](user-guide.md) | [PDF](pdf/PS-UG-01_User_Guide.pdf) |
| PS-IG-02 | Installation and Administration Guide | Administrators, operations team, infrastructure | [installation-and-administration.md](installation-and-administration.md) | [PDF](pdf/PS-IG-02_Installation_and_Administration_Guide.pdf) |
| PS-QS-03 | Quick Start | New pet owners | [quick-start.md](quick-start.md) | [PDF](pdf/PS-QS-03_Quick_Start.pdf) |
| PS-FAQ-04 | FAQ and Troubleshooting | Everyone | [faq-and-troubleshooting.md](faq-and-troubleshooting.md) | [PDF](pdf/PS-FAQ-04_FAQ_and_Troubleshooting.pdf) |
| PS-TD-05 | Technical Design | Developers, reviewers, security | [technical-design.md](technical-design.md) | [PDF](pdf/PS-TD-05_Technical_Design.pdf) |
| PS-UAT-06 | UAT Test Cases | Testers, sign-off owners | [uat-test-cases.md](uat-test-cases.md) | [PDF](pdf/PS-UAT-06_UAT_Test_Cases.pdf) |
| PS-RN-07 | Release Notes v1.0 | Everyone | [release-notes.md](release-notes.md) | [PDF](pdf/PS-RN-07_Release_Notes_v1.0.pdf) |
| PS-TE-08 | Test Evidence v1.0 | Testers, auditors | — | [Excel](test-evidence/PS-TE-08_Test_Evidence_v1.0.xlsx) |

## Reference

| Document | What it is |
|---|---|
| [api.md](api.md) | API reference, generated from the route table (112 routes) |
| [permission-matrix.md](permission-matrix.md) | Role × resource × action matrix, generated from the code |
| [traceability.md](traceability.md) | PRD requirements → code → tests, generated |
| [test-report.md](test-report.md) | Latest test run and the 24 mandatory P0 scenarios |
| [architecture.md](architecture.md) | Phase 0 architecture notes (superseded by PS-TD-05) |
| [decision-log.md](decision-log.md) | Decisions D-01 to D-39 and their status |
| [known-limitations.md](known-limitations.md) | What is not built or connected, and release gates |
| [runbooks/](runbooks/) | Pilot, monitoring, support, deployment and rollback, restore, vendors, drills, load test |

## Rebuilding

The Markdown files are the source. Screenshots in `images/` are captured from the demo build; the PDFs are generated from the Markdown in the Pawsure design (cover, document control, contents with page numbers, running headers and footers, drawn diagrams). The UAT cases and the test evidence come from the latest automated runs.

```bash
pip install markdown pypdf playwright
npm run docs:shots      # recapture screenshots (demo build on :4174)
npm run docs:pdf        # regenerate UAT cases and all PDFs
npm run e2e:sheet       # rebuild the test evidence workbook from the latest runs
```
