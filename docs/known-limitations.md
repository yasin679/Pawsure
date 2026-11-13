# Known limitations, open gates and decisions

Honest list for the pilot hand-over. Nothing below is represented as done anywhere in the product.

## Not built or not connected

- **Vendors:** SMS, WhatsApp, IVR, push, LLM and object storage are mock adapters (docs/runbooks/vendors.md). Webhooks are protected by a shared secret (WEBHOOK_SECRET) until each vendor's own signature check is added (D-06, D-37).
- **Hosting:** no staging or pilot environment (D-01 open). No staging URL exists.
- **Photo code reading:** codes are checked from the caption or IVR keypad only (D-17); no OCR.
- **Live location:** start/stop only, no coordinates (D-23).
- **Coupon redemption:** points accrue; no coupon vendor.
- **Job runner sharding:** one runner visits every home each minute. With cover continuity this takes about 9 s for 200 homes in-process, and about 30 s in the 8 PM run when every home has an early task tomorrow (docs/runbooks/load-test.md). Split it by household shard before about 400 homes, sooner than the 1,000 planned for 1.0.
- **Owner UI languages:** owner app is English; helper and friend messages are en/hi/mr.
- **Developer-tool dependencies:** npm audit still reports issues in Vitest and Vite (developer machines only; they never ship). Upgrade their major versions before running them in shared CI.
- **Accessibility:** no automated accessibility audit yet (the Playwright suite covers flows, not WCAG).
- **Cover continuity (1.1.0) runs on mock vendors:** reminders, cover requests, one-time links, the cover-not-found call, the 15-minute care-circle call and the cluster advisory are recorded by the mock WhatsApp, SMS and voice adapters; nothing reaches a phone. The 9 new templates are drafts, not submitted to Meta (no WhatsApp provider yet).
- **Weekly thin-circle check** tests key holders only; “nobody available on weekdays” needs availability data for backups that isn’t collected yet.
- **Society invite links and pet-parent swaps** are recorded, but there is no join page or swap matching yet.
- **Same-society member fallback (PS-141):** built behind a locked switch that stays OFF until the verification rule is decided.
- **Nearby-member fallback, friend thank-you points, owner camera, day care, verified carers:** OFF by design (§4.2).

## Release gates outside the software (§14, §18)

- Helper acceptance (10) and day-2 usability (5–10) tests; owner interviews; gate-app check; ₹149 pre-order test; IVR and WhatsApp cost quotes.
- Legal review: privacy notice, consents, rights, breach wording, care liability; DPDP Rules timing for the 72 h Board report.
- Native-speaker review of Hindi and Marathi helper messages.
- Trademark/domain check for “Pawsure”.
- Named ops rota, on-call owner and privacy lead; partner claims stay at zero until agreements are signed.

## Proposed decisions needing sign-off

See docs/decision-log.md: D-01, D-06 to D-09, D-12 to D-30 (D-10 and D-11 are agreed).
