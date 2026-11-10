/** App shell: session, household, frozen navigation (PS-108), look-in route, demo tools in DEMO_MODE. */
import { useCallback, useEffect, useState } from 'react';
import { api, API, ApiError, endSession, session, fmt, type DayView, type Incident, type Me, type Pet } from './api';
import { AppBar, Art, Icon } from './ui';
import { Onboarding } from './screens/Onboarding';
import { Today } from './screens/Today';
import { PetScreen } from './screens/PetScreen';
import { RoutineScreen, HealthScreen, HelperScreen, CircleScreen } from './screens/CareSetup';
import { LookIn } from './screens/LookIn';
import { HelperSim } from './screens/HelperSim';
import { FindCover } from './screens/FindCover';
import { Friends, PrivacyScreen } from './screens/Friends';
import { FriendHome } from './screens/FriendHome';
import { FriendSim } from './screens/FriendSim';
import { WalletScreen, RightsScreen } from './screens/Account';
import { AdminApp } from './screens/Admin';
import { HelperHome, CircleHome } from './screens/RoleHomes';

type Tab = 'today' | 'find' | 'friends' | 'pet' | 'me';
type Sub = null | 'routine' | 'health' | 'helper' | 'circle' | 'privacy' | 'wallet' | 'rights';
const TABS: [Tab, string, string][] = [['today', 'Today', 'home'], ['find', 'Find cover', 'search'], ['friends', 'Friends', 'friends'], ['pet', 'Pet', 'paw'], ['me', 'Me', 'user']];

export function App() {
  // The hosted app uses /admin; the shareable demo can't use paths, so it also accepts #admin.
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const h = () => setHash(location.hash); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);
  const isAdmin = location.pathname.startsWith('/admin') || hash === '#admin';
  // Backup look-in links: /l/<token> when hosted; #lookin-<token> in the shareable demo, which can't use paths.
  const lookinToken = location.pathname.startsWith('/l/') ? location.pathname.slice(3) : hash.startsWith('#lookin-') ? hash.slice(8) : null;
  const [authed, setAuthed] = useState(!!session.get());
  const [tab, setTab] = useState<Tab>('today'); const [sub, setSub] = useState<Sub>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [day, setDay] = useState<DayView | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [invites, setInvites] = useState<{ id: string; role: string; society: string }[]>([]);
  const [demo, setDemo] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [isFriend, setIsFriend] = useState(false); const [draft, setDraft] = useState('');
  const hh = me?.memberships[0]?.household_id;

  const load = useCallback(async () => {
    try {
      const m = await api<Me>('/v1/me'); setMe(m);
      setInvites(await api('/v1/invitations'));
      const h = m.memberships[0]?.household_id;
      if (!h) { const f = await api<{ links: unknown[]; profile: unknown }>('/v1/me/friend'); setIsFriend(f.links.length > 0 || !!f.profile); return; }
      if (['helper', 'backup', 'family', 'viewer'].includes(m.memberships[0]?.role ?? '')) return;
      const [p, d, i] = await Promise.all([api<Pet[]>(`/v1/households/${h}/pets`), api<DayView>(`/v1/households/${h}/today`), api<Incident[]>(`/v1/households/${h}/incidents`).catch(() => [])]);
      setPets(p); setDay(d); setIncidents(i);
    } catch (e) { if (e instanceof ApiError && e.status === 401) { session.set(null); setAuthed(false); } }
  }, []);
  useEffect(() => { if (authed && !lookinToken && !isAdmin) load(); }, [authed, load, lookinToken, isAdmin]);
  useEffect(() => { fetch(API + '/health').then(r => r.json()).then(h => setDemo(!!h.demoMode)).catch(() => setDemo(false)); }, []);
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); addEventListener('online', on); addEventListener('offline', off); return () => { removeEventListener('online', on); removeEventListener('offline', off); }; }, []);

  if (isAdmin) return <AdminApp />;
  if (lookinToken) return <div className="pwa"><AppBar title="Pawsure look-in" onBack={hash.startsWith('#lookin-') ? () => { location.hash = ''; } : undefined} /><LookIn token={lookinToken} /></div>;
  if (!authed) return <div className="pwa">{!online && <div className="offline">You’re offline. Your helper’s missed-call check-ins still work.</div>}<Onboarding onDone={() => setAuthed(true)} /></div>;
  const role = me?.memberships[0]?.role;
  const signOut = async (everywhere = false) => { await endSession(everywhere); setAuthed(false); setMe(null); setDay(null); setPets([]); setIncidents([]); setInvites([]); setIsFriend(false); setDraft(''); setTab('today'); setSub(null); };
  const signOutAll = () => signOut(true);
  if (!hh && isFriend) return <div className="pwa">{demo && <DemoBar hh="" day={null} onChange={load} friendOnly />}<FriendHome name={me?.user.display_name ?? ''} onSignOut={() => signOut()} /></div>;
  if (me && role === 'helper') return <div className="pwa">{sub === 'rights' ? <RightsScreen me={me} onBack={() => setSub(null)} reload={load} /> : <HelperHome me={me} onRights={() => setSub('rights')} onSignOut={() => signOut()} onSignOutAll={signOutAll} />}</div>;
  if (me && role && ['backup', 'family', 'viewer'].includes(role)) return <div className="pwa">{sub === 'rights' ? <RightsScreen me={me} onBack={() => setSub(null)} reload={load} /> : <CircleHome me={me} onRights={() => setSub('rights')} onSignOut={() => signOut()} onSignOutAll={signOutAll} />}</div>;
  const go = (t: Tab) => { setTab(t); setSub(null); if (t === 'today') load(); };

  return <div className="pwa">
    {!online && <div className="offline">You’re offline. Showing the last saved view; missed-call check-ins still reach Pawsure.</div>}
    {demo && hh && <DemoBar hh={hh} day={day} onChange={load} />}
    {sub === 'routine' && hh && <RoutineScreen hh={hh} pets={pets} onBack={() => setSub(null)} />}
    {sub === 'health' && hh && <HealthScreen hh={hh} pets={pets} onBack={() => setSub(null)} />}
    {sub === 'helper' && hh && <HelperScreen hh={hh} onBack={() => setSub(null)} />}
    {sub === 'circle' && hh && <CircleScreen hh={hh} onBack={() => { setSub(null); load(); }} />}
    {sub === 'privacy' && hh && <PrivacyScreen hh={hh} onBack={() => setSub(null)} />}
    {sub === 'wallet' && hh && <WalletScreen hh={hh} onBack={() => setSub(null)} />}
    {sub === 'rights' && <RightsScreen me={me} onBack={() => setSub(null)} reload={load} />}
    {!sub && tab === 'today' && hh && <Today hh={hh} day={day} pets={pets} incidents={incidents} ownerName={me?.user.display_name ?? ''} reload={load} onFindCover={(text) => { if (text) setDraft(text); go('find'); }} />}
    {!sub && tab === 'pet' && hh && <PetScreen hh={hh} pets={pets} reload={load} onOpen={setSub} />}
    {!sub && tab === 'find' && hh && <FindCover hh={hh} pets={pets} draft={draft} onDraft={setDraft} />}
    {!sub && tab === 'friends' && hh && <Friends hh={hh} onAsk={(n) => { setDraft(`Can ${n.split(' ')[0]} feed ${pets[0]?.name ?? 'my pet'} at 6 pm today?`); go('find'); }} />}
    {!sub && tab === 'me' && <><AppBar title="Me" /><main className="body">
      {invites.map(i => <div key={i.id} className="card info"><b>You’re invited as {i.role.replace('_', '-')}</b><div className="small">{i.society}</div><button className="btn primary sm" onClick={() => api(`/v1/invitations/${i.id}/accept`, { body: {} }).then(load)}>Accept</button></div>)}
      <div className="card"><div className="row"><span className="avatar lg">{(me?.user.display_name ?? '?').split(' ').map(s => s[0]).join('').slice(0, 2)}</span><div className="grow"><h2>{me?.user.display_name}</h2><div className="small muted">{me?.memberships[0]?.society} · {me?.memberships[0]?.tower} · {role?.replace('_', '-')}</div></div></div></div>
      <div className="list">
        <button className="li" onClick={() => setSub('privacy')}><span className="avatar icon"><Icon name="shield" size={20} /></span><div className="grow"><b>Profile and what friends see</b><div className="small muted">Society/tower anchor, privacy, nearby members (off)</div></div><span className="chev">›</span></button>
        <button className="li" onClick={() => setSub('helper')}><span className="avatar icon"><Icon name="user" size={20} /></span><div className="grow"><b>Helper and check-ins</b><div className="small muted">Invite, consent, method, food-box code card</div></div><span className="chev">›</span></button>
        <button className="li" onClick={() => setSub('circle')}><span className="avatar icon"><Icon name="friends" size={20} /></span><div className="grow"><b>Care circle</b><div className="small muted">Co-owners, backup, roles, remove access</div></div><span className="chev">›</span></button>
        {(role === 'owner' || role === 'co_owner') && <button className="li" onClick={() => setSub('wallet')}><span className="avatar icon"><Icon name="star" size={20} /></span><div className="grow"><b>Wallet and points</b><div className="small muted">Your helper’s points from this home</div></div><span className="chev">›</span></button>}
        <button className="li" onClick={() => setSub('rights')}><span className="avatar icon"><Icon name="shield" size={20} /></span><div className="grow"><b>Your data rights</b><div className="small muted">See, correct or delete your data; consents; complaints</div></div><span className="chev">›</span></button>
      </div>
      <div className="card"><span className="eyebrow">Consents</span>{me?.consents.map((c, i) => <div key={i} className="row small"><span className="grow">{c.kind} <span className="mono muted">{c.version}</span></span><span className={`tag ${c.granted ? 'flag-on' : 'flag-off'}`}>{c.granted ? 'Given' : 'Not given'}</span></div>)}</div>
      <button className="btn ghost block" onClick={() => signOut()}>Sign out</button>
      <button className="btn ghost block" onClick={signOutAll}>Sign out of all devices</button>
    </main></>}
    <nav className="tabbar" aria-label="Primary">{TABS.map(([k, l, i]) => <button key={k} aria-current={tab === k && !sub ? 'page' : 'false'} onClick={() => go(k)}><Icon name={i} size={22} />{l}</button>)}</nav>
  </div>;
}

/** Demo-only controls: simulated clock + Sunita's simulated phone. Hidden when the API is not in DEMO_MODE. */
function DemoBar({ hh, day, onChange, friendOnly }: { hh: string; day: DayView | null; onChange: () => void; friendOnly?: boolean }) {
  const [busy, setBusy] = useState(false); const [phone, setPhone] = useState(false); const [friends, setFriends] = useState(false); const [llm, setLlm] = useState('ok');
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await api('/jobs/tick', { body: {}, auth: false }); await onChange(); } finally { setBusy(false); } };
  return <>
    <div className="demobar" role="region" aria-label="Demo controls">
      <span>DEMO</span><span className="t">{day ? fmt(day.now) : '—'}</span>
      {[5, 15, 60].map(m => <button key={m} disabled={busy} onClick={() => act(() => api('/demo/clock', { body: { advance: m }, auth: false }))}>+{m === 60 ? '1h' : m + 'm'}</button>)}
      {!friendOnly && <button aria-pressed={phone} onClick={() => { setPhone(!phone); setFriends(false); }}>{phone ? 'Hide' : 'Show'} Sunita’s phone</button>}
      {!friendOnly && <button aria-pressed={friends} onClick={() => { setFriends(!friends); setPhone(false); }}>{friends ? 'Hide' : 'Show'} friends’ phones</button>}
      <button onClick={() => { location.hash = 'admin'; }}>Ops console</button>
      {!friendOnly && <label title="No real AI model is connected. This switch simulates one so the fallbacks can be tried.">AI (simulated) <select value={llm} onChange={e => { const m = e.target.value; setLlm(m); api('/demo/llm', { body: { mode: m }, auth: false }); }} style={{ background: 'transparent', color: 'inherit', border: '1px solid #ffffff44', borderRadius: 99 }}><option value="ok">working</option><option value="timeout">times out (8 s)</option><option value="down">unavailable</option><option value="lowconf">low confidence</option></select></label>}
    </div>
    {phone && <HelperSim hh={hh} day={day} onChange={onChange} />}
    {friends && <FriendSim onChange={onChange} />}
  </>;
}
