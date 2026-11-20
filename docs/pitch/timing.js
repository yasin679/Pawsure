// Scene start times in seconds, taken from the voice-over's word timings (audio/vo-words.json).
// The voice-over starts 0.6 s into the film, and each scene starts 0.3 s before its first word,
// so a scene starts at its first word + 0.3 s. The last entry is the end of the film.
window.PITCH_TIMES = [0, 4.04, 9.06, 19.82, 30.72, 36.8, 46.4, 56.28, 68.78, 78.44, 84.54, 92.34, 100.06, 106.04, 108.74, 115.72, 134.02, 139.3, 145.46, 153.84, 161.78, 170.06, 177.44, 183.82];
// Two lines were re-recorded and spliced in afterwards (“From our primary research and survey” and
// “Sign up with our personal AI assistant, Pawly”), so times after them are shifted by +0.46 s and +1.42 s
// from audio/vo-words.json.
