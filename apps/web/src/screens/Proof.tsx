/**
 * Proof sheet (16 Nov): a photo of the bowl or pet, from the camera or the gallery, plus today's 4-digit code from
 * the card in the food box. Used by helpers, friends and backups. The photo is shrunk on the phone before sending.
 */
import { useEffect, useRef, useState } from 'react';
import { API, ApiError } from '../api';

export interface ProofBody { photo?: string | null; code?: string | null }

/** Shrink a picked image to at most 640 px and under ~58 KB as a JPEG data URL. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    for (const max of [640, 520, 420, 340]) {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.72, 0.6, 0.5, 0.4]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 58000) return d; }
    }
    throw new Error('too_large');
  } finally { URL.revokeObjectURL(url); }
}

export function ProofSheet({ title, householdId, onSend, onClose, allowNoProof }: { title: string; householdId?: string; onSend: (b: ProofBody) => Promise<{ message?: string }>; onClose: () => void; allowNoProof?: boolean }) {
  const [photo, setPhoto] = useState<string | null>(null); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [reading, setReading] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null); const [hint, setHint] = useState<string | null>(null);
  const cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null);
  // Demo only: today's code, so the demo works without the printed card.
  useEffect(() => { if (householdId) fetch(`${API}/demo/code-today/${householdId}`).then(r => r.ok ? r.json() : null).then(j => setHint(j?.code ?? null)).catch(() => {}); }, [householdId]);
  // While a picked photo is still being shrunk, sending waits, so a quick tap never sends the code without the photo.
  const pick = async (f?: File | null) => { if (!f) return; setErr(null); setReading(true); try { setPhoto(await shrink(f)); } catch { setErr('Couldn’t read that photo. Try another one.'); } finally { setReading(false); } };
  const send = async (b: ProofBody) => {
    setBusy(true); setErr(null);
    try { const r = await onSend(b); setDone(r.message ?? 'Sent.'); }
    catch (e) { setErr(e instanceof ApiError && typeof e.body.message === 'string' ? e.body.message : 'Couldn’t send. Try again.'); }
    finally { setBusy(false); }
  };
  return <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}><div className="sheet proof" onClick={e => e.stopPropagation()}>
    <h2>{title}</h2>
    {done ? <><p className="proof-done" role="status">{done}</p><button className="btn primary block" onClick={onClose}>Close</button></> : <>
      <p className="small muted">Send a photo of the bowl or your pet, and today’s code from the card in the food box.</p>
      <div className="proof-photo">{photo ? <img src={photo} alt="Your proof photo" /> : <span>{reading ? 'Loading the photo…' : 'No photo yet'}</span>}</div>
      <div className="btnrow">
        <button type="button" className="btn" onClick={() => cam.current?.click()}>📷 Take photo</button>
        <button type="button" className="btn" onClick={() => gal.current?.click()}>🖼 Choose from gallery</button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden aria-label="Take a photo" onChange={e => pick(e.target.files?.[0])} />
      <input ref={gal} type="file" accept="image/*" hidden aria-label="Choose a photo from the gallery" onChange={e => pick(e.target.files?.[0])} />
      <div className="field"><label htmlFor="pcode">Today’s code</label><input id="pcode" className="input mono" inputMode="numeric" maxLength={4} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="4 digits from the card" style={{ letterSpacing: '.3em', fontSize: '1.2rem' }} />
        {hint && <span className="hint">Demo: today’s code is <b className="mono">{hint}</b></span>}</div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block lg" disabled={busy || reading || (!photo && code.length !== 4)} onClick={() => send({ photo, code: code.length === 4 ? code : null })}>{busy ? 'Sending…' : 'Send proof'}</button>
      {allowNoProof && <button type="button" className="linkbtn" style={{ alignSelf: 'center', padding: 0 }} disabled={busy || reading} onClick={() => send({})}>I can’t send proof: mark done anyway</button>}
      <button type="button" className="btn ghost block" onClick={onClose}>Cancel</button>
    </>}
  </div></div>;
}
