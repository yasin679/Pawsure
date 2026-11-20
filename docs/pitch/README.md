# Pawsure pitch video

`pawsure-pitch.mp4`: 3 minutes 4 seconds, 1920 × 1080, minimal style, with real app screenshots, simple infographics, an ElevenLabs voice-over and ElevenLabs background music.

| File | What it is |
|------|------------|
| `pawsure-pitch-4k.mp4` | The 4K master (3840 × 2160), drawn at 2x for sharp text and screenshots |
| `pawsure-pitch.mp4` | A 1080p copy scaled down from the 4K render, for easy sharing and playback |
| `script.md` | The script: scenes, voice-over lines, and where each claim comes from in the PRD v1.5 and the pitch deck |
| `pitch.html` | The film itself, drawn by `render(t)`; open it in a browser to watch it play live (no sound) |
| `timing.js` | When each scene starts, taken from the voice-over's word timings |
| `render.mjs` | Renders `pitch.html` frame by frame and mixes in the audio → `pawsure-pitch.mp4` |
| `shots/` | App screenshots, captured from the demo by `e2e/pitch-shots.spec.ts` |
| `audio/voiceover.mp3` | ElevenLabs v4, voice “Sharanya” |
| `audio/music.mp3` | ElevenLabs Music: soft piano and plucked strings, instrumental (looped with crossfades to fit) |
| `audio/vo-words.json` | Word timings from ElevenLabs Scribe |

To rebuild:

```bash
PITCH_SHOTS=1 npx playwright test e2e/pitch-shots.spec.ts --trace off --workers=1   # refresh screenshots (needs the demo build)
node docs/pitch/render.mjs                                                          # render the video
```
