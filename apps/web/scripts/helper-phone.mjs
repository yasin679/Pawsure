// Builds public/helper-phone.html, the helper's WhatsApp-style phone shown inside the app demo,
// from the reviewers' walkthrough page (docs/demos/helper-journey.html), so both stay one source.
import { readFileSync, writeFileSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const body = readFileSync(new URL('../../../docs/demos/helper-journey.html', here), 'utf8');
writeFileSync(new URL('../public/helper-phone.html', here), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{height:100%;margin:0}[hidden]{display:none!important}body{font:14px system-ui,sans-serif}</style>
</head><body>
${body}
</body></html>
`);
