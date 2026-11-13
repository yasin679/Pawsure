// Cuts the welcome mascot (dog and two cats) out of the design board and removes the beige background, so it sits on any
// surface without a visible box (v1.1.0 fix #5). Writes apps/web/public/assets/mascot-family.png. Run: node tools/cut-mascot.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const board = 'data:image/jpeg;base64,' + readFileSync(new URL('../apps/web/public/assets/design-board.jpg', import.meta.url)).toString('base64');
const browser = await chromium.launch({ channel: 'chrome' }); const page = await browser.newPage();
const png = await page.evaluate(async ({ src, x, y, w, h }) => {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, x, y, w, h, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h), p = d.data;
  // background colour = median of the border pixels; flood-fill from the edges so light parts inside the drawing stay
  const at = (i, j) => (j * w + i) * 4, border = [];
  for (let i = 0; i < w; i++) border.push(at(i, 0), at(i, h - 1)); for (let j = 0; j < h; j++) border.push(at(0, j), at(w - 1, j));
  const med = k => border.map(o => p[o + k]).sort((a, b) => a - b)[border.length >> 1], bg = [med(0), med(1), med(2)];
  const near = o => Math.abs(p[o] - bg[0]) + Math.abs(p[o + 1] - bg[1]) + Math.abs(p[o + 2] - bg[2]) < 46;
  const seen = new Uint8Array(w * h), stack = [];
  for (let i = 0; i < w; i++) stack.push([i, 0], [i, h - 1]); for (let j = 0; j < h; j++) stack.push([0, j], [w - 1, j]);
  while (stack.length) { const [i, j] = stack.pop(); if (i < 0 || j < 0 || i >= w || j >= h) continue; const k = j * w + i; if (seen[k]) continue; seen[k] = 1; const o = k * 4; if (!near(o)) continue; p[o + 3] = 0; stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]); }
  // soften the edge: pixels next to removed ones become half transparent
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) { const o = at(i, j); if (p[o + 3] && (!p[at(i + 1, j) + 3] || !p[at(i - 1, j) + 3] || !p[at(i, j + 1) + 3] || !p[at(i, j - 1) + 3])) p[o + 3] = 170; }
  g.putImageData(d, 0, 0); return c.toDataURL('image/png');
}, { src: board, x: 60, y: 785, w: 165, h: 160 });
writeFileSync(new URL('../apps/web/public/assets/mascot-family.png', import.meta.url), Buffer.from(png.split(',')[1], 'base64'));
await browser.close(); console.log('wrote apps/web/public/assets/mascot-family.png');
