/** Sign-in and onboarding: OTP (PS-001), consent (PS-002), household + owner profile (PS-050 anchor). */
import { useEffect, useState } from 'react';
import { api, ApiError, session, setSessionMode } from '../api';
import { AppBar, Art, Banner, Icon } from '../ui';
import { CircleBuilder } from './Cover';
import { SocietyFields } from './Friends';

type Step = 'welcome' | 'phone' | 'otp' | 'consent' | 'profile';
const ERR: Record<string, string> = {
  invalid_code: 'That code doesn’t match. Check the SMS and try again.', expired_code: 'This code has expired. Request a new one.',
  too_many_attempts: 'Too many wrong attempts. Request a new code.', rate_limited: 'Too many codes requested. Try again in 15 minutes.',
  too_soon: 'Please wait 30 seconds before asking for another code.', invalid_input: 'Enter a 10-digit Indian mobile number starting with 6–9.',
  terms_and_privacy_required: 'Please accept the Terms and the Privacy Notice to continue.'
};

/** Every seeded person who can sign in (packages/db/src/seed.ts). Tap a number to fill the field. */
const DEMO_PEOPLE: [group: string, people: [name: string, role: string, phone: string][]][] = [
  ['Neha’s home', [['Neha', 'owner', '9800000021'], ['Rohan', 'co-owner', '9800000022'], ['Sunita', 'helper · Marathi', '9000000035'], ['Ankita', 'backup', '9700000008']]],
  ['Friends', [['Priya', 'friend', '9900000012'], ['Arjun', 'friend · Hindi', '9800000077'], ['Kavya', 'friend', '9600000045'], ['Meera', 'friend · Marathi', '9700000090'], ['Farhan', 'friend', '9500000031']]],
  ['Ops console (staff sign-in)', [['Ops on shift', 'ops', '9811000001'], ['Ops lead', 'ops lead', '9811000002'], ['Privacy lead', 'privacy', '9811000003'], ['Auditor', 'auditor', '9811000004']]]
];
const spaced = (p: string) => `${p.slice(0, 5)} ${p.slice(5)}`;
function DemoNumbers({ onPick }: { onPick: (phone: string) => void }) {
  return <details className="card flat small demo-numbers" open>
    <summary><b>Demo numbers</b> <span className="muted">· tap one to fill it in, or use any new number to start fresh</span></summary>
    {DEMO_PEOPLE.map(([g, ps]) => <div key={g}><div className="eyebrow">{g}</div><div className="list">
      {ps.map(([n, r, p]) => <button key={p} type="button" className="li" onClick={() => onPick(p)} aria-label={`Use ${n}'s number, ${r}`}>
        <div className="grow"><b>{n}</b> <span className="muted">{r}</span></div><span className="mono">{spaced(p)}</span></button>)}
    </div></div>)}
    <div className="xs muted">Backups who aren’t members (Mrs Desai, Ritu, Vikram) don’t sign in: they reply on the simulated phones (Show backups’ phones).</div>
  </details>;
}

export function Onboarding({ onDone, start = 'welcome' }: { onDone: () => void; start?: Step }) {
  const [step, setStep] = useState<Step>(start);
  const [newHh, setNewHh] = useState<string | null>(null);
  // Already signed in but setup not finished (for example after leaving and coming back): continue setup.
  useEffect(() => {
    if (start !== 'welcome' || !session.get()) return;
    api<{ memberships: unknown[] }>('/v1/me').then(async me => {
      if (me.memberships.length) return onDone();
      const fr = await api<{ links: unknown[]; profile: unknown }>('/v1/me/friend');
      if (fr.links.length || fr.profile) onDone(); else setStep('consent');
    }).catch(() => { /* not signed in any more: stay on the welcome screen */ });
  }, []);
  const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [demoCode, setDemoCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [c, setC] = useState({ terms: false, privacy: false, alerts: true, research: false });
  const [p, setP] = useState({ displayName: '', language: 'en', city: '', societyId: '', society: '', tower: '', flat: '' });
  const run = async (fn: () => Promise<void>) => { setErr(null); setBusy(true); try { await fn(); } catch (e) { setErr(e instanceof ApiError ? ERR[String(e.body.error)] ?? 'Something went wrong. Try again.' : 'Can’t reach Pawsure. Check your connection.'); } finally { setBusy(false); } };
  const e164 = '+91' + phone.replace(/\D/g, '');

  // PS-140: newcomer circle builder (no day-care list)
  if ((step as string) === 'circle' && newHh) return <><AppBar title="Your circle" /><div className="body">
    <div className="art-stage"><Art name="wave" width={130} /></div><h2>Do you have anyone who can look in on your pet?</h2><p className="muted">A family member, neighbour or friend who could step in if your helper can’t come.</p>
    <button className="btn primary block" onClick={onDone}>Yes, I have someone</button><button className="btn block" onClick={() => setStep('builder' as Step)}>No one yet</button>
    <p className="xs muted">You can change this later in Me → Backups.</p></div></>;
  if ((step as string) === 'builder' && newHh) return <CircleBuilder hh={newHh} onDone={onDone} />;
  if (step === 'welcome') return <div className="body">
    <div className="hero-ill"><img className="mascot" src={`${import.meta.env.BASE_URL}assets/mascot-family.png`} width={210} height={204} alt="Dog and two cats in yellow headbands" /><span className="eyebrow">Pawsure</span><h1>Be sure, whoever’s caring.</h1><p>Plan your pet’s day, see evidence of what happened, and find a friend when your usual help can’t come.</p></div>
    <div className="card"><div className="stack small">
      <div className="row top"><span className="avatar icon"><Icon name="check" size={20} /></span><div><b>Evidence, task by task.</b><br /><span className="muted">Each task shows how strong the evidence is. Some days it will be incomplete, and the app will say so.</span></div></div>
      <div className="row top"><span className="avatar icon"><Icon name="friends" size={20} /></span><div><b>Your own friends first.</b><br /><span className="muted">Nothing is sent to anyone until you approve it.</span></div></div>
      <div className="row top"><span className="avatar icon"><Icon name="bell" size={20} /></span><div><b>Alerts that escalate.</b><br /><span className="muted">If a check-in is missed, you hear first, then your backup.</span></div></div>
    </div></div>
    <button className="btn primary block" onClick={() => setStep('phone')}>Get started</button>
    <p className="xs muted" style={{ textAlign: 'center' }}>Pawsure is not a veterinary or emergency service.</p>
  </div>;

  if (step === 'phone') return <><AppBar title="Your mobile number" onBack={() => setStep('welcome')} /><div className="body">
    <p className="muted">We’ll send a 6-digit code by SMS. Friends never see your number.</p>
    <div className="field"><label htmlFor="ph">Mobile number</label><div className="row"><span className="tag">+91</span><input id="ph" className="input mono" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={phone} onChange={e => setPhone(e.target.value)} placeholder="98765 43210" /></div></div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" disabled={busy} onClick={() => run(async () => { const r = await api<{ demoCode?: string }>('/auth/otp/request', { body: { phone: e164 }, auth: false }); setDemoCode(r.demoCode ?? null); setStep('otp'); })}>Send code</button>
    <DemoNumbers onPick={setPhone} />
  </div></>;

  if (step === 'otp') return <><AppBar title="Enter the code" onBack={() => setStep('phone')} /><div className="body">
    <p className="muted">Sent to {e164}.</p>
    <div className="field"><label htmlFor="otp">6-digit code</label><input id="otp" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value)} style={{ fontSize: '1.4rem', letterSpacing: '.4em', textAlign: 'center' }} /></div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" disabled={busy || code.length !== 6} onClick={() => run(async () => {
      const r = await api<{ token: string; userId: string; isNew: boolean }>('/auth/otp/verify', { body: { phone: e164, code }, auth: false });
      session.set({ token: r.token, userId: r.userId });
      const me = await api<{ memberships: unknown[]; consents: unknown[] }>('/v1/me');
      if (me.memberships.length) { onDone(); return; }
      if (await api('/admin/me').then(() => true, () => false)) { const s = session.get(); session.set(null); setSessionMode('staff'); session.set(s); location.hash = 'admin'; return; }
      const fr = await api<{ links: unknown[]; profile: unknown }>('/v1/me/friend');
      if (fr.links.length || fr.profile) onDone(); else setStep('consent');
    })}>Verify</button>
    <button className="btn ghost block" disabled={busy} onClick={() => run(async () => { const r = await api<{ demoCode?: string }>('/auth/otp/request', { body: { phone: e164 }, auth: false }); setDemoCode(r.demoCode ?? null); })}>Resend code</button>
    {demoCode && <Banner kind="sim" icon="⚙">Demo mode: no SMS is sent. Your code is <b className="mono">{demoCode}</b>.</Banner>}
  </div></>;

  if (step === 'consent') return <><AppBar title="Terms and privacy" /><div className="body">
    <div className="card">
      <label className="check"><input type="checkbox" checked={c.terms} onChange={e => setC({ ...c, terms: e.target.checked })} /><span><b>I accept the Terms of Use</b> (v T-1.0)</span></label>
      <label className="check"><input type="checkbox" checked={c.privacy} onChange={e => setC({ ...c, privacy: e.target.checked })} /><span><b>I have read the Privacy Notice</b> (v PN-1.0): what we collect, why, how long, and your rights under the DPDP Act</span></label>
    </div>
    <div className="card"><span className="eyebrow">Optional</span>
      <label className="switch"><span className="grow"><b>Care alerts on WhatsApp and calls</b><br /><span className="xs muted">Missed check-ins and emergencies</span></span><input type="checkbox" role="switch" checked={c.alerts} onChange={e => setC({ ...c, alerts: e.target.checked })} /></label>
      <label className="switch"><span className="grow"><b>Pilot research interviews</b></span><input type="checkbox" role="switch" checked={c.research} onChange={e => setC({ ...c, research: e.target.checked })} /></label>
    </div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" disabled={busy} onClick={() => run(async () => {
      await api('/v1/consents', { body: { language: 'en', items: [{ kind: 'terms', version: 'T-1.0', granted: c.terms }, { kind: 'privacy', version: 'PN-1.0', granted: c.privacy }, { kind: 'alerts', version: 'C-1.0', granted: c.alerts }, { kind: 'research', version: 'C-1.0', granted: c.research }] } });
      setStep('profile');
    })}>Continue</button>
    <p className="xs muted">We store the version and time of each choice. Legal text is pending counsel review.</p>
  </div></>;

  return <><AppBar title="About you" /><div className="body">
    <div className="field"><label htmlFor="nm">Your name</label><input id="nm" className="input" value={p.displayName} onChange={e => setP({ ...p, displayName: e.target.value })} /></div>
    <div className="field"><label htmlFor="lg">App language</label><select id="lg" className="input" value={p.language} onChange={e => setP({ ...p, language: e.target.value })}><option value="en">English</option><option value="hi">हिन्दी (Hindi)</option><option value="mr">मराठी (Marathi)</option></select></div>
    <SocietyFields value={p} onChange={v => setP({ ...p, ...v })} />
    <span className="hint">Your location anchor. Friends see society and tower only.</span>
    <div className="grid2"><div className="field"><label htmlFor="tw">Tower / wing</label><input id="tw" className="input" value={p.tower} onChange={e => setP({ ...p, tower: e.target.value })} /></div><div className="field"><label htmlFor="fl">Flat (private)</label><input id="fl" className="input" value={p.flat} onChange={e => setP({ ...p, flat: e.target.value })} /></div></div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" disabled={busy || !p.displayName || !p.city || (!p.societyId && p.society.trim().length < 2)} onClick={() => run(async () => { const r = await api<{ id: string }>('/v1/households', { body: { displayName: p.displayName, language: p.language, city: p.city, ...(p.societyId ? { societyId: p.societyId } : { society: p.society }), tower: p.tower || undefined, flat: p.flat || undefined } }); setNewHh(r.id); setStep('circle' as Step); })}>Continue</button>
  </div></>;
}
