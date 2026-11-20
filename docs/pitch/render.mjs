// Renders docs/pitch/pitch.html to an MP4, frame by frame, and mixes in the voice-over and music.
// Usage: node docs/pitch/render.mjs   (needs Playwright's Chromium and ffmpeg)
// Inputs: docs/pitch/audio/voiceover.mp3 and docs/pitch/audio/music.mp3 (from ElevenLabs), docs/pitch/timing.json (scene starts).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const out = path.join(dir, 'pawsure-pitch.mp4');
const vo = path.join(dir, 'audio/voiceover.mp3'), music = path.join(dir, 'audio/music.mp3');

// a project copy of Playwright may not have its own browser; fall back to the machine's Chromium
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' }));
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto('file://' + path.join(dir, 'pitch.html') + '?frames');
await page.evaluate(() => window.ready);
const duration = await page.evaluate(() => window.DURATION);
const frames = Math.round(duration * FPS);

const hasAudio = existsSync(vo) && existsSync(music);
const args = ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
if (hasAudio) args.push('-i', vo, '-i', music, '-filter_complex',
  // music low under the voice, ducked further while she speaks; both faded at the ends
  `[1:a]adelay=600:all=1,apad,asplit=2[v][vs];[2:a]apad,volume=0.22,afade=t=in:d=1.5,afade=t=out:st=${duration - 3.5}:d=3.5[m];` +
  `[m][vs]sidechaincompress=threshold=0.05:ratio=3:attack=30:release=500[md];[md][v]amix=inputs=2:normalize=0,atrim=0:${duration},loudnorm=I=-16:TP=-1.5:LRA=11[a]`,
  '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(duration), out);
const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });

for (let f = 0; f < frames; f++) {
  await page.evaluate(t => window.render(t), f / FPS);
  const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if (f % 150 === 0) console.log(`frame ${f}/${frames}`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await browser.close();
console.log('wrote', out);
