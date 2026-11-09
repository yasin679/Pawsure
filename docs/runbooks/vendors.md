# Vendors: what is still needed, and failover

**No vendor is connected.** Every channel runs through a mock adapter (`apps/api/src/adapters.ts`) that records what would be sent. Nothing is claimed as integrated until a contract, approved templates and credentials exist and a staging test passes.

| Channel | Needed before pilot | Credentials (env, names only) | Failover in code |
|---|---|---|---|
| SMS OTP | DLT registration (entity, sender ID, OTP template) | `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_DLT_TEMPLATE_ID` | Retry once; no fallback for OTP (user asks again; the API returns 503) |
| WhatsApp BSP | Meta Business verification; utility templates approved in en/hi/mr; webhook signing secret | `WA_BSP_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_WEBHOOK_SECRET` | Retry once, then SMS fallback (needs a DLT “alert” template, decision D-29) |
| IVR / missed call | Number, keypad flow, call-back webhook; quote at 10,000 calls/month (stop if > ₹0.50/call) | `IVR_API_KEY`, `IVR_NUMBER`, `IVR_WEBHOOK_SECRET` | Automated call → SMS fallback |
| Push | Web push VAPID keys | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Logged as undelivered; WhatsApp and calls carry critical steps |
| LLM (Ask Pawsure) | Vendor DPA, India data terms, no training on inputs | `LLM_API_KEY` | 8 s timeout → rules parser / manual form (always works) |
| Object storage (photos, voice) | India region, private bucket, signed links ≤ 5 min | `STORAGE_BUCKET`, `STORAGE_KEY` | — (evidence references only; never public URLs) |

Every attempt, retry and fallback is written to `delivery_log` with a masked recipient and shown in Console → Service health.

## Drill: vendor outage (demo mode)

```bash
curl -X POST localhost:8787/demo/outage -H 'content-type: application/json' -d '{"channel":"whatsapp","down":true}'
```

Then trigger a helper message (Sunita’s phone in the demo bar → “points”): Service health shows the failed attempts and the SMS fallback. Set `down:false` to recover. Do the same with `sms` and `whatsapp` together to see an “undelivered” alert and the on-call page.
