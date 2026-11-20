// Builds public/helper-phone.html, the helper's WhatsApp-style phone shown inside the app demo,
// from the reviewers' walkthrough page (docs/demos/helper-journey.html), so both stay one source.
import { readFileSync, writeFileSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const body = readFileSync(new URL('../../../docs/demos/helper-journey.html', here), 'utf8');
writeFileSync(new URL('../public/helper-phone.html', here), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{height:100%;margin:0}[hidden]{display:none!important}body{font:14px system-ui,sans-serif}</style>
<style>/* inside the app demo: the phone fills the frame, drawn like the owner's iPhone (3px metal edge, 10px black bezel) */
body{padding:0!important;background:transparent!important}.wrap{display:block!important;height:100%;padding:0!important}.stage{height:100%;width:100%}
.phone{width:100%!important;height:100%!important;aspect-ratio:auto!important;max-width:none!important;box-sizing:border-box;border-radius:65px!important;padding:3px!important;
  background:linear-gradient(135deg,#9aa0a6 0%,#d9dde0 18%,#6c7177 45%,#c3c7cb 70%,#80868c 100%)!important;box-shadow:0 0 0 1px #4a4e52!important}
.screen{box-sizing:border-box;border-radius:62px!important;border:10px solid #050505}
.notch{top:11px!important;width:124px!important;height:36px!important;border-radius:18px!important;background:#000!important}
.sbar{height:58px!important;padding:0 34px 0 42px!important;font-size:17px!important}</style>
</head><body>
${body}
</body></html>
`);
