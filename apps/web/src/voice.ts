/**
 * Voice input for the onboarding conversation: what the owner says is written into the message box.
 * Inside claude.ai (the shared demo) it uses the page's `dictation` capability (Anthropic speech-to-text,
 * asked once); elsewhere the browser's own speech recognition (Chrome, Edge, Safari). No microphone button
 * is shown where neither is available.
 */
import { useEffect, useRef, useState } from 'react';

type Dict = { start(o?: { language?: string }): Promise<void>; stop(): Promise<void>; onPartial(h: (e: { text: string }) => void): () => void; onFinal(h: (e: { text: string }) => void): () => void; onState(h: (e: { state: string; reason?: string }) => void): () => void };
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SR = (): (new () => Rec) | undefined => (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;
const ERR: Record<string, string> = {
  not_granted: 'Microphone access is off for this page. You can type instead.', 'not-allowed': 'Microphone access is off for this page. You can type instead.',
  'service-not-allowed': 'Voice input isn’t allowed here. You can type instead.', unavailable: 'Voice input isn’t available here. You can type instead.',
  'no-speech': 'I didn’t hear anything. Tap the microphone and try again.', rate_limited: 'Voice input is busy. Try again in a moment.'
};

export function useVoice() {
  const dict = useRef<Dict | null>(null); const rec = useRef<Rec | null>(null); const sink = useRef<(t: string) => void>(() => {});
  const [available, setAvailable] = useState(!!SR()); const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState(''); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
    if (!claude?.use) return;
    let offs: (() => void)[] = [];
    claude.use('dictation').then(ns => {
      if (!ns) return;
      const d = ns as Dict; dict.current = d; setAvailable(true);
      offs = [d.onPartial(e => setPartial(e.text)), d.onFinal(e => { setPartial(''); sink.current(e.text); }),
        d.onState(e => { setListening(e.state !== 'idle'); if (e.state === 'idle' && e.reason && !['stopped', 'viewer_stopped', 'hidden'].includes(e.reason)) setError(ERR[e.reason] ?? 'Voice input stopped. You can type instead.'); if (e.reason === 'unavailable') setAvailable(!!SR()); })];
    }).catch(() => { /* no dictation in this view */ });
    return () => { offs.forEach(f => f()); dict.current?.stop().catch(() => {}); rec.current?.stop(); };
  }, []);
  /** Start or stop listening; settled words are passed to `onText` (append them to the message). Call from a click. */
  const toggle = (onText: (t: string) => void) => {
    sink.current = onText; setError(null);
    const d = dict.current;
    if (d) { if (listening) d.stop().catch(() => {}); else d.start().catch((e: { code?: string }) => setError(ERR[e?.code ?? ''] ?? null)); return; }
    if (listening) { rec.current?.stop(); return; }
    const Ctor = SR(); if (!Ctor) { setAvailable(false); return; }
    const r = new Ctor(); rec.current = r;
    r.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-IN'; r.interimResults = true; r.continuous = false;
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]!; if (res.isFinal) sink.current(' ' + res[0].transcript.trim()); else interim += res[0].transcript; }
      setPartial(interim);
    };
    r.onerror = e => { setError(ERR[e.error] ?? 'Voice input stopped. You can type instead.'); };
    r.onend = () => { setListening(false); setPartial(''); };
    try { r.start(); setListening(true); } catch { setError('Voice input couldn’t start. You can type instead.'); }
  };
  return { available, listening, partial, error, toggle };
}
