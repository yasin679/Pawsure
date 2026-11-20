// Scene start times in seconds, taken from the voice-over's word timings (audio/vo-words.json).
// The voice-over starts 0.6 s into the film, and each scene starts 0.3 s before its first word,
// so a scene starts at its first word + 0.3 s. The last entry is the end of the film.
window.PITCH_TIMES = [0, 4.04, 9.06, 19.82, 30.72, 36.8, 46.4, 56.28, 68.78, 78.44, 84.54, 93.06, 100.78, 106.76, 109.46, 116.44, 134.74, 140.02, 146.18, 154.56, 162.5, 170.78, 178.16, 184.54];
// Two lines were re-recorded and spliced in afterwards (“From our primary research and survey” and
// “Sign-up is a short chat with Pawly, your AI assistant”), so times after them are shifted by +0.46 s and +2.14 s
// from audio/vo-words.json.
