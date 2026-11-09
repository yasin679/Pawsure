# Known limitations, open gates and decisions

Honest list for the pilot hand-over. Nothing below is represented as done anywhere in the product.

## Not built or not connected

- **Vendors:** SMS, WhatsApp, IVR, push, LLM and object storage are mock adapters (docs/runbooks/vendors.md). No webhook signature checks yet; they depend on the chosen vendors.
- **Hosting:** no staging or pilot environment (D-01 open). No staging URL exists.
- **Photo code reading:** codes are checked from the caption or IVR keypad only (D-17); no OCR.
- **Live location:** start/stop only, no coordinates (D-23).
- **Coupon redemption:** points accrue; no coupon vendor.
- **Job runner sharding:** one runner visits every home each minute (≈ 5.6 s for 200 homes in-process); split by household shard before about 1,000 homes.
- **Owner UI languages:** owner app is English; helper and friend messages are en/hi/mr.
- **Automated browser and accessibility tests:** checked by hand in the browser; no Playwright suite yet.
- **Nearby-member fallback, friend thank-you points, owner camera, day care, verified carers:** OFF by design (§4.2).

## Release gates outside the software (§14, §18)

- Helper acceptance (10) and day-2 usability (5–10) tests; owner interviews; gate-app check; ₹149 pre-order test; IVR and WhatsApp cost quotes.
- Legal review: privacy notice, consents, rights, breach wording, care liability; DPDP Rules timing for the 72 h Board report.
- Native-speaker review of Hindi and Marathi helper messages.
- Trademark/domain check for “Pawsure”.
- Named ops rota, on-call owner and privacy lead; partner claims stay at zero until agreements are signed.

## Proposed decisions needing sign-off

See docs/decision-log.md: D-01, D-06 to D-09, D-12 to D-30 (D-10 and D-11 are agreed).
