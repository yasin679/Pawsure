/** Sign-in and onboarding: OTP (PS-001), consent (PS-002), then the Pawly conversation for household + owner profile (PS-050 anchor) and circle (PS-140). */
import { t as tr } from '../i18n';
import { useEffect, useState } from 'react';
import { api, ApiError, session, setSessionMode } from '../api';
import { LangSwitch, AppBar, Banner } from '../ui';
import { Intake } from './Intake';
import { Intro, introSeen } from './Intro';

type Step = 'intro' | 'phone' | 'otp' | 'consent' | 'profile';
/** Log in: number + code, then straight home. Sign up: number + code, then consent and the Pawly conversation. */
type Mode = 'login' | 'signup';
const ERR: Record<string, string> = {
  invalid_code: 'That code doesn’t match. Check the SMS and try again.', expired_code: 'This code has expired. Request a new one.',
  too_many_attempts: 'Too many wrong attempts. Request a new code.', rate_limited: 'Too many codes requested. Try again in 15 minutes.',
  too_soon: 'Please wait 30 seconds before asking for another code.', invalid_input: 'Enter a 10-digit Indian mobile number starting with 6–9.',
  terms_and_privacy_required: 'Please accept the Terms and the Privacy Notice to continue.'
};

/** Plain-language summaries of the Terms and the Privacy Notice. The version label is what Pawsure records with your OK. */
const LEGAL = {
  terms: { title: 'Terms of Use', version: 'T-1.0 · 1 Nov 2026', points: [
    'Pawsure helps you plan your pet’s care and see what happened. It is not a vet or an emergency service.',
    'Check-ins are evidence, not a guarantee. Some days will be incomplete and the app says so.',
    'You choose who is asked for help. Nothing is sent to friends until you approve it.',
    'Use your own phone number and treat helpers and friends with respect.',
    'You can stop using Pawsure and ask us to delete your data at any time.'] },
  privacy: { title: 'Privacy Notice', version: 'PN-1.0 · 1 Nov 2026', points: [
    'What we keep: your name, number, society, pets, routine, and the check-ins for each task.',
    'Why: to run your pet’s day, send alerts, and show you what happened.',
    'Who sees it: you, the people you add, and the friend you confirm for one visit (flat and key only then).',
    'How long: photos and voice notes 90 days, request text 90 days, messages 12 months. Live location is deleted 24 hours after a visit.',
    'Your rights under India’s DPDP Act: see, correct or delete your data, and withdraw consent, in Me → Your data rights.'] }
};
function LegalSheet({ kind, onClose }: { kind: 'terms' | 'privacy'; onClose: () => void }) {
  const d = LEGAL[kind];
  return <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={d.title} onClick={onClose}><div className="sheet legal" onClick={e => e.stopPropagation()}>
    <h2>{d.title}</h2><p className="xs muted">Version {d.version}. Pawsure records this version and the time you agree.</p>
    <ul>{d.points.map(t => <li key={t}>{t}</li>)}</ul>
    <p className="xs muted">{tr('This is a summary. The full legal text is being reviewed by counsel before launch.')}</p>
    <button className="btn primary block" onClick={onClose}>{tr('Got it')}</button>
  </div></div>;
}

export function Onboarding({ onDone, start = 'phone' }: { onDone: () => void; start?: Step }) {
  // First visit: the welcome screens come before Log in / Sign up.
  const [step, setStep] = useState<Step>(start === 'phone' && !session.get() && !introSeen() ? 'intro' : start);
  const [mode, setMode] = useState<Mode>('login');
  // A number with no account, entered on Log in, goes straight into sign-up (with a note saying so).
  const [newNumber, setNewNumber] = useState(false);
  // Already signed in but setup not finished (for example after leaving and coming back): continue setup.
  useEffect(() => {
    if (start !== 'phone' || !session.get()) return;
    api<{ memberships: unknown[] }>('/v1/me').then(async me => {
      if (me.memberships.length) return onDone();
      const fr = await api<{ links: unknown[]; profile: unknown }>('/v1/me/friend');
      if (fr.links.length || fr.profile) onDone(); else setStep('consent');
    }).catch(() => { /* not signed in any more: stay on the sign-in screen */ });
  }, []);
  const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [demoCode, setDemoCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [c, setC] = useState({ terms: false, privacy: false, alerts: true }); const [doc, setDoc] = useState<'terms' | 'privacy' | null>(null);
  const run = async (fn: () => Promise<void>) => { setErr(null); setBusy(true); try { await fn(); } catch (e) { setErr(e instanceof ApiError ? ERR[String(e.body.error)] ?? 'Something went wrong. Try again.' : 'Can’t reach Pawsure. Check your connection.'); } finally { setBusy(false); } };
  const e164 = '+91' + phone.replace(/\D/g, '');

  if (step === 'intro') return <Intro onDone={m => { setMode(m); setStep('phone'); }} />;

  if (step === 'phone') return <div className="login">
    <div className="login-lang"><LangSwitch compact /></div>
    <div className="login-hero">
      <img className="login-mascot" src={`${import.meta.env.BASE_URL}assets/mascot-family.png`} width={178} height={173} alt="" />
      <div className="brandmark"><div><div className="login-word">Pawsure</div><p className="login-tag">{tr('Be sure, whoever’s caring.')}</p></div></div>
    </div>
    <div className="login-sheet">
      <div className="authtabs" role="group" aria-label="Log in or sign up">
        <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setErr(null); }}>{tr('Log in')}</button>
        <button type="button" aria-pressed={mode === 'signup'} onClick={() => { setMode('signup'); setErr(null); }}>{tr('Sign up')}</button>
      </div>
      <h1>{mode === 'login' ? tr('Welcome back') : tr('Create your account')}</h1>
      <p className="muted small">{mode === 'login' ? tr('Enter your number and we’ll text you a 6-digit code. You’ll go straight to your home.') : tr('Set up your pet’s home in about two minutes. First, we’ll text you a 6-digit code.')}</p>
      <div className="field"><label htmlFor="ph">{tr('Mobile number')}</label><div className="phone-in"><span className="cc">+91</span><input id="ph" className="input mono" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={phone} onChange={e => setPhone(e.target.value)} placeholder="98765 43210" /></div></div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block lg" disabled={busy} onClick={() => run(async () => { const r = await api<{ demoCode?: string }>('/auth/otp/request', { body: { phone: e164 }, auth: false }); setDemoCode(r.demoCode ?? null); setStep('otp'); })}>{tr('Send code')}</button>
    </div>
  </div>;

  if (step === 'otp') return <><AppBar title={tr('Enter the code')} onBack={() => setStep('phone')} /><div className="body">
    <p className="muted">Sent to {e164}.</p>
    <div className="field"><label htmlFor="otp">{tr('6-digit code')}</label><input id="otp" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value)} style={{ fontSize: '1.4rem', letterSpacing: '.4em', textAlign: 'center' }} /></div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" disabled={busy || code.length !== 6} onClick={() => run(async () => {
      const r = await api<{ token: string; userId: string; isNew: boolean }>('/auth/otp/verify', { body: { phone: e164, code }, auth: false });
      session.set({ token: r.token, userId: r.userId });
      const me = await api<{ memberships: unknown[]; consents: unknown[] }>('/v1/me');
      if (me.memberships.length) { onDone(); return; }
      if (await api('/admin/me').then(() => true, () => false)) { const s = session.get(); session.set(null); setSessionMode('staff'); session.set(s); location.hash = 'admin'; return; }
      const fr = await api<{ links: unknown[]; profile: unknown }>('/v1/me/friend');
      if (fr.links.length || fr.profile) onDone(); else { if (mode === 'login') setNewNumber(true); setStep('consent'); }
    })}>{tr('Verify')}</button>
    <button className="btn ghost block" disabled={busy} onClick={() => run(async () => { const r = await api<{ demoCode?: string }>('/auth/otp/request', { body: { phone: e164 }, auth: false }); setDemoCode(r.demoCode ?? null); })}>{tr('Resend code')}</button>
    {demoCode && <Banner kind="sim" icon="⚙">Demo mode: no SMS is sent. Your code is <b className="mono">{demoCode}</b>.</Banner>}
  </div></>;

  if (step === 'consent') return <><AppBar title={tr('Before you start')} /><div className="body">
    {newNumber && <Banner kind="info" icon="👋">{tr('There’s no account for this number yet, so let’s set one up. It takes about three minutes.')}</Banner>}
    <p className="muted" style={{ margin: 0 }}>{tr('Pawsure stores your pet’s routine and sends alerts when care is missed. For that we need your OK.')}</p>
    <div className="card">
      <label className="check"><input type="checkbox" checked={c.terms} onChange={e => setC({ ...c, terms: e.target.checked })} /><span><b>{tr('I accept the Terms of Use')}</b></span></label>
      <button type="button" className="linkbtn" onClick={() => setDoc('terms')}>{tr('Read the Terms (1 min)')}</button>
      <label className="check"><input type="checkbox" checked={c.privacy} onChange={e => setC({ ...c, privacy: e.target.checked })} /><span><b>{tr('I have read the Privacy Notice')}</b></span></label>
      <button type="button" className="linkbtn" onClick={() => setDoc('privacy')}>{tr('Read the Privacy Notice (1 min)')}</button>
    </div>
    <div className="card"><span className="eyebrow">{tr('Optional')}</span>
      <label className="switch"><span className="grow"><b>{tr('Care alerts on WhatsApp and calls')}</b><br /><span className="xs muted">{tr('Missed check-ins and emergencies')}</span></span><input type="checkbox" role="switch" checked={c.alerts} onChange={e => setC({ ...c, alerts: e.target.checked })} /></label>
    </div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" disabled={busy} onClick={() => run(async () => {
      await api('/v1/consents', { body: { language: 'en', items: [{ kind: 'terms', version: 'T-1.0', granted: c.terms }, { kind: 'privacy', version: 'PN-1.0', granted: c.privacy }, { kind: 'alerts', version: 'C-1.0', granted: c.alerts }] } });
      setStep('profile');
    })}>{tr('Continue')}</button>
    <p className="xs muted">{tr('You can withdraw any time in Me → Your data rights.')}</p>
    {doc && <LegalSheet kind={doc} onClose={() => setDoc(null)} />}
  </div></>;

  // About you + Your circle: a conversation with Pawly (Intake.tsx), one question at a time.
  return <Intake onDone={onDone} />;
}
