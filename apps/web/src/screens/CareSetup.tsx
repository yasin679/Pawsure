/** Routine (PS-010/011), health calendar (PS-040/041/046), helper & code card (PS-020–024, PS-109, PS-110), care circle (PS-005). */
import { useEffect, useState } from 'react';
import { nameError, api, ApiError, fmt, type CodeCardView, type HealthItem, type Helper, type Member, type Pet, type RoutineItem } from '../api';
import { LanguageOptions, AppBar, Banner, Icon, PersonAvatar } from '../ui';

const useLoad = <T,>(path: string, deps: unknown[] = []) => {
  const [data, setData] = useState<T | null>(null); const [n, setN] = useState(0);
  useEffect(() => { api<T>(path).then(setData).catch(() => setData(null)); }, [path, n, ...deps]);
  return [data, () => setN(x => x + 1)] as const;
};
const errText = (e: unknown) => e instanceof ApiError ? (e.status === 403 ? 'Your role can’t change this.' : String(e.body.message ?? (e.body.issues as string[] | undefined)?.join('; ') ?? e.body.error)) : 'Can’t reach Pawsure.';
/** PAW-002 / PAW-008: the same rules as the server, checked before anything is sent. */
export const routineProblems = (t: { title?: string | null; task_type?: string | null; instructions?: string | null }) => {
  const p: { field: 'rtt' | 'rin'; text: string }[] = [];
  if (!t.title?.trim()) p.push({ field: 'rtt', text: 'Give the task a name.' });
  else if (t.title.trim().length > 80) p.push({ field: 'rtt', text: 'Keep the task name under 80 characters.' });
  if ((t.task_type ?? 'feeding') === 'medicine' && !t.instructions?.trim()) p.push({ field: 'rin', text: 'Add the vet’s written instructions for a medicine task.' });
  return p;
};

export function RoutineScreen({ hh, pets, onBack, onChanged }: { hh: string; pets: Pet[]; onBack: () => void; onChanged?: () => void }) {
  const [list, reload] = useLoad<RoutineItem[]>(`/v1/households/${hh}/routine`);
  const [oneOff, setOneOff] = useState(false);
  const [edit, setEdit] = useState<Partial<RoutineItem> & { assignee?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const petName = (id: string) => pets.find(p => p.id === id)?.name ?? id;
  const [shown, setShown] = useState<{ field: string; text: string }[]>([]);
  const [dirty, setDirty] = useState(false); const [leaving, setLeaving] = useState(false);
  const change = (next: typeof edit) => { setEdit(next); setDirty(true); if (shown.length) setShown(routineProblems(next ?? {})); };
  const close = () => { setEdit(null); setShown([]); setDirty(false); setLeaving(false); setErr(null); };
  const fieldErr = (f: string) => shown.find(s => s.field === f)?.text;
  if (edit) return <><AppBar title={edit.id ? 'Edit task' : 'New task'} onBack={() => dirty ? setLeaving(true) : close()} /><main className="body">
    {/* PAW-013: leaving with unsaved changes asks first */}
    {leaving && <div className="card warn" role="alertdialog" aria-label="Discard changes?"><b>Discard your changes to this task?</b><div className="btnrow"><button className="btn" onClick={() => setLeaving(false)}>Keep editing</button><button className="btn dark" onClick={close}>Discard</button></div></div>}
    <div className="field"><label htmlFor="rtt">Task name (required)</label><input id="rtt" className="input" autoFocus={!edit.id} required maxLength={80} aria-invalid={!!fieldErr('rtt')} aria-describedby={fieldErr('rtt') ? 'rtt-err' : undefined} placeholder="e.g. Evening walk" value={edit.title ?? ''} onChange={e => change({ ...edit, title: e.target.value })} />{fieldErr('rtt') && <span id="rtt-err" className="errtext" role="alert">{fieldErr('rtt')}</span>}</div>
    <div className="field"><label htmlFor="rp">Pet</label><select id="rp" className="input" value={edit.pet_id ?? pets[0]?.id} onChange={e => change({ ...edit, pet_id: e.target.value })}>{pets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    <div className="grid2"><div className="field"><label htmlFor="rty">Type</label><select id="rty" className="input" value={edit.task_type ?? 'feeding'} onChange={e => change({ ...edit, task_type: e.target.value })}>{['feeding', 'walk', 'medicine', 'toilet', 'litter', 'water', 'other'].map(t => <option key={t}>{t}</option>)}</select></div>
      <div className="field"><label htmlFor="rdu">Due</label><select id="rdu" className="input" value={edit.due_minute ?? 780} onChange={e => change({ ...edit, due_minute: Number(e.target.value) })}>{Array.from({ length: 34 }, (_, i) => 420 + i * 30).map(m => <option key={m} value={m}>{fmt(m)}</option>)}</select></div></div>
    <div className="field"><label htmlFor="rur">Urgency</label><select id="rur" className="input" value={(edit as { urgency?: string }).urgency ?? (edit.task_type === 'medicine' ? 'MustHappen' : edit.task_type === 'walk' || edit.task_type === 'other' ? 'CanWait' : 'TimeSensitive')} onChange={e => change({ ...edit, urgency: e.target.value } as typeof edit)}><option value="CanWait">Can wait: may be moved or skipped</option><option value="TimeSensitive">Time-sensitive: may be moved, with a warning</option><option value="MustHappen">Must happen: can’t be skipped; alert at +15 min</option></select><span className="hint">Walks can wait, meals are on time, medicine must happen.</span></div>
    <div className="field"><label htmlFor="ras">Who (one named person per task)</label><select id="ras" className="input" value={edit.assignee ?? 'helper'} onChange={e => change({ ...edit, assignee: e.target.value })}><option value="helper">Helper (tracked)</option><option value="co_owner">Co-owner (gets the same reminder)</option><option value="owner">Me / family</option></select></div>
    <div className="field"><label htmlFor="rin">Instructions{edit.task_type === 'medicine' ? ' (required for medicine)' : ''}</label><textarea id="rin" className="input" aria-invalid={!!fieldErr('rin')} value={edit.instructions ?? ''} onChange={e => change({ ...edit, instructions: e.target.value })} /><span className="hint">{edit.task_type === 'medicine' ? 'Copy your vet’s written instructions. Medicine is never passed to your backup.' : 'Shown to whoever does the task.'}</span>{fieldErr('rin') && <span className="errtext" role="alert">{fieldErr('rin')}</span>}</div>
    {!edit.id && <fieldset className="field"><legend>When</legend>
      <label className="row"><input type="radio" name="rwhen" checked={!oneOff} onChange={() => setOneOff(false)} /> Every day, from tomorrow</label>
      <label className="row"><input type="radio" name="rwhen" checked={oneOff} onChange={() => setOneOff(true)} /> Just for today</label>
      <span className="hint">{oneOff ? 'Added to today’s plan now. It won’t repeat. Tasks already planned for today stay as they are.' : 'Today’s plan and history stay as they are.'}</span></fieldset>}
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" onClick={async () => { setErr(null); const probs = routineProblems(edit); setShown(probs); if (probs.length) { document.getElementById(probs[0]!.field)?.focus(); return; } try {
      const today = !edit.id && oneOff;
      const body = { petId: edit.pet_id ?? pets[0]?.id, title: edit.title?.trim(), type: edit.task_type ?? 'feeding', due: edit.due_minute ?? 780, assignee: edit.assignee ?? 'helper', instructions: edit.instructions || undefined, urgency: (edit as { urgency?: string }).urgency, ...(today ? { oneOffToday: true } : {}) };
      const r = await api<{ effectiveFrom: string }>(`/v1/households/${hh}/routine${edit.id ? '/' + edit.id : ''}`, { method: edit.id ? 'PUT' : 'POST', body });
      setMsg(today ? `Added to today’s plan: ${edit.title} at ${fmt(edit.due_minute ?? 780)}. It won’t repeat.` : `Saved. Takes effect from ${r.effectiveFrom}. Today’s plan and history are unchanged.`); close(); setOneOff(false); reload(); onChanged?.();
    } catch (e) { setErr(errText(e)); } }}>Save</button>
  </main></>;
  return <><AppBar title="Routine" onBack={onBack} right={<button className="btn sm primary" onClick={() => setEdit({ task_type: 'feeding', due_minute: 1080, assignee: 'helper', pet_id: pets[0]?.id })}><Icon name="plus" size={16} />Add</button>} /><main className="body">
    {msg && <Banner kind="info" icon="ℹ">{msg}</Banner>}
    <div className="list">{(list ?? []).map(r => <button key={r.id} className="li" onClick={() => setEdit({ ...r, assignee: r.assignee_role === 'helper' ? 'helper' : r.assignee_role === 'co_owner' ? 'co_owner' : 'owner' })}><span className="mono small" style={{ minWidth: 52 }}>{fmt(r.due_minute)}</span><div className="grow"><b>{r.title}</b><div className="small muted">{petName(r.pet_id)} · {r.assignee_role === 'helper' ? 'Helper' : 'Family'} · {(r as RoutineItem & { recurrence?: string }).recurrence === 'once' ? 'today only' : 'from ' + r.effective_from}</div></div><span className="tag">{r.escalation_profile === 'medicine' ? 'Alert +15 · no backup' : r.escalation_profile === 'walk' ? 'Alert +45' : 'Alert +30'}</span></button>)}</div>
    <p className="xs muted">Changes start tomorrow. For today only, tap Add and choose Just for today.</p>
  </main></>;
}

export function HealthScreen({ hh, pets, onBack }: { hh: string; pets: Pet[]; onBack: () => void }) {
  const [list, reload] = useLoad<HealthItem[]>(`/v1/households/${hh}/health`);
  const [add, setAdd] = useState<{ petId: string; kind: string; label: string; givenOn: string; nextDue: string; source: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tag: Record<string, [string, string]> = { overdue: ['Overdue', 'sim'], due: ['Due today', 'sim'], due_soon: ['Due soon', 'owner'], upcoming: ['Upcoming', ''], snoozed: ['Snoozed', ''], done: ['Done', 'flag-on'] };
  if (add) return <><AppBar title="Add a date" onBack={() => setAdd(null)} /><main className="body">
    <div className="field"><label htmlFor="hp">Pet</label><select id="hp" className="input" value={add.petId} onChange={e => setAdd({ ...add, petId: e.target.value })}>{pets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    <div className="field"><label htmlFor="hk">Type</label><select id="hk" className="input" value={add.kind} onChange={e => setAdd({ ...add, kind: e.target.value })}>{[['vaccine', 'Vaccine / booster'], ['deworming', 'Deworming'], ['medication', 'Medication course'], ['followup', 'Vet follow-up'], ['checkup', 'Check-up']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
    <div className="field"><label htmlFor="hl">Name (as on the vet card)</label><input id="hl" className="input" value={add.label} onChange={e => setAdd({ ...add, label: e.target.value })} /></div>
    <div className="grid2"><div className="field"><label htmlFor="hg">Given on</label><input id="hg" type="date" className="input" value={add.givenOn} onChange={e => setAdd({ ...add, givenOn: e.target.value })} /></div><div className="field"><label htmlFor="hn">Next due</label><input id="hn" type="date" className="input" value={add.nextDue} onChange={e => setAdd({ ...add, nextDue: e.target.value })} /></div></div>
    <div className="field"><label htmlFor="hs">Source</label><select id="hs" className="input" value={add.source} onChange={e => setAdd({ ...add, source: e.target.value })}>{['Owner-entered', 'Copied from vet card', 'Vet instruction (owner-entered)'].map(s => <option key={s}>{s}</option>)}</select></div>
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" onClick={async () => { try { await api(`/v1/households/${hh}/health`, { body: { ...add, givenOn: add.givenOn || undefined, nextDue: add.nextDue || undefined } }); setAdd(null); reload(); } catch (e) { setErr(errText(e)); } }}>Save</button>
  </main></>;
  return <><AppBar title="Health calendar" onBack={onBack} right={<button className="btn sm primary" onClick={() => setAdd({ petId: pets[0]?.id ?? '', kind: 'vaccine', label: '', givenOn: '', nextDue: '', source: 'Copied from vet card' })}><Icon name="plus" size={16} />Add</button>} /><main className="body">
    <Banner kind="info" icon="ℹ">Only dates you or your vet entered. No medical advice.</Banner>
    {(list ?? []).map(h => { const [l, c] = tag[h.state] ?? [h.state, '']; return <div key={h.id} className="card"><div className="row"><b className="grow">{h.label}</b><span className={`tag ${c}`}>{l}</span></div>
      <div className="small muted">{pets.find(p => p.id === h.pet_id)?.name} · next due {h.next_due ?? '—'} · given {h.given_on ?? '—'} · {h.source}</div>
      {h.state !== 'done' && <div className="btnrow"><button className="btn sm primary" onClick={() => api(`/v1/households/${hh}/health/${h.id}/done`, { body: {} }).then(reload)}>Done</button><button className="btn sm" onClick={() => api(`/v1/households/${hh}/health/${h.id}/snooze`, { body: {} }).then(reload)}>Snooze 1 day</button></div>}</div>; })}
    <p className="xs muted">Reminders 3 days before and on the day.</p>
  </main></>;
}

export function HelperScreen({ hh, onBack }: { hh: string; onBack: () => void }) {
  const [helpers, reload] = useLoad<Helper[]>(`/v1/households/${hh}/helpers`);
  const [card, reloadCard] = useLoad<CodeCardView>(`/v1/households/${hh}/code-cards/current`);
  const [inv, setInv] = useState({ name: '', phone: '', language: 'mr' }); const [showInvite, setShowInvite] = useState(false);
  const [rotate, setRotate] = useState(false); const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (helpers && !helpers.length) setShowInvite(true); }, [helpers]);
  const C: Record<string, [string, string]> = { yes: ['Consent given', 'flag-on'], pending: ['Waiting for a reply', ''], notnow: ['Said “Not now”', 'sim'], withdrawn: ['Stopped check-ins', 'sim'] };
  const M: Record<string, string> = { photo: 'WhatsApp photo', voice: 'WhatsApp voice note', ivr: 'Missed call + IVR code' };
  return <><AppBar title="Helper and check-ins" onBack={onBack} /><main className="body">
    {msg && <Banner kind="info" icon="ℹ">{msg}</Banner>}
    {(helpers ?? []).map(h => <div key={h.id} className="card"><div className="row"><PersonAvatar lg seed={h.id} name={h.name} /><div className="grow"><h2>{h.name}</h2><div className="small muted">{({ mr: 'Marathi', hi: 'Hindi', en: 'English' } as Record<string, string>)[h.language]} · {h.method ? M[h.method] : 'method not chosen yet'}</div></div><span className={`tag ${C[h.consent]![1]}`}>{C[h.consent]![0]}</span></div>
      {(h.consent === 'notnow' || h.consent === 'withdrawn') && <Banner kind="info" icon="ℹ">Nothing about {h.name} is being recorded. You can use <b>Trusted Helper mode</b> (Today → Change). Their tasks show “Not confirmed”, never “failed”.</Banner>}
      <div className="btnrow">{h.consent !== 'yes' && <button className="btn sm" onClick={() => api(`/v1/households/${hh}/helpers/${h.id}/resend`, { body: {} }).then(() => setMsg('Invite sent again (simulated WhatsApp).'))}>Resend invite</button>}
        <button className="btn sm" onClick={() => api(`/v1/households/${hh}/helpers/${h.id}/practice`, { body: {} }).then(() => setMsg('Practice prompt sent. Nothing is recorded as evidence.'))}>Practice together</button></div>
      <p className="xs muted">No app needed. They reply “change” to switch method.</p></div>)}
    {showInvite ? <div className="card"><h3>Invite a helper</h3>
      <div className="field"><label htmlFor="in">Name</label><input id="in" className="input" value={inv.name} onChange={e => setInv({ ...inv, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="ip">Phone</label><div className="row"><span className="tag">+91</span><input id="ip" className="input mono" inputMode="numeric" maxLength={10} value={inv.phone} onChange={e => setInv({ ...inv, phone: e.target.value })} /></div></div>
      <div className="field"><label htmlFor="il">Their language</label><select id="il" className="input" value={inv.language} onChange={e => setInv({ ...inv, language: e.target.value })}><LanguageOptions forMessages /></select></div>
      <div className="card flat small">Nothing is recorded until they say Yes.</div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" onClick={async () => { setErr(null); const ne = nameError(inv.name); if (ne) { setErr(ne); return; } try { await api(`/v1/households/${hh}/helpers/invite`, { body: { ...inv, phone: '+91' + inv.phone.replace(/\D/g, '') } }); setShowInvite(false); setMsg('Invitation sent on WhatsApp (simulated).'); reload(); } catch (e) { setErr(errText(e)); } }}>Send WhatsApp invite</button></div>
      : <button className="btn block" onClick={() => setShowInvite(true)}><Icon name="plus" size={18} />Invite another helper</button>}

    <h2 style={{ fontSize: 'var(--fs-l)' }}>Food-box code card</h2>
    {card ? <div className="codecard"><div className="row"><b className="grow">{card.month} · version {card.version}</b></div>
      <table aria-label="Daily codes"><tbody>{Array.from({ length: 5 }, (_, r) => <tr key={r}>{Array.from({ length: 7 }, (_, c) => { const dd = r * 7 + c + 1; return card.codes[dd] ? <td key={c} className={dd === card.today ? 'today' : ''}>{dd}<br /><b>{card.codes[dd]}</b></td> : <td key={c} />; })}</tr>)}</tbody></table>
      <div className="xs muted" style={{ marginTop: 6 }}>Keep inside the food box. Show the bowl and type the day’s code. Never your face.</div></div> : <div className="empty">No card yet. A new card is made automatically each month.</div>}
    <div className="btnrow"><button className="btn primary" onClick={() => window.print()}>Print</button><button className="btn warn" onClick={() => setRotate(true)}>Rotate now</button></div>
    {rotate && <div className="card warn"><b>Rotate the card?</b><div className="small">Old codes stop working at once. Print the new card.</div>
      <div className="btnrow"><button className="btn" onClick={() => setRotate(false)}>Cancel</button><button className="btn warn" onClick={() => api(`/v1/households/${hh}/code-cards`, { body: { reason: 'Suspected copying' } }).then(() => { setRotate(false); reloadCard(); setMsg('New card created. Old codes no longer count.'); })}>Rotate</button></div></div>}
    <p className="xs muted">Codes never appear in notifications or logs.</p>
  </main></>;
}

export function CircleScreen({ hh, onBack }: { hh: string; onBack: () => void }) {
  const [list, reload] = useLoad<Member[]>(`/v1/households/${hh}/circle`);
  const [inv, setInv] = useState({ name: '', phone: '', role: 'co_owner' }); const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState<Member | null>(null); const [result, setResult] = useState<{ name: string; channels: { name: string; ms: number }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const R: Record<string, string> = { owner: 'Owner', co_owner: 'Co-owner', backup: 'Backup', family: 'Family', viewer: 'Viewer', helper: 'Helper', friend: 'Friend' };
  const P: Record<string, string> = { co_owner: 'Timeline, routine, alerts, friends', backup: 'Escalations, 15-min look-in links, emergency card (never medicine)', family: 'Timeline, alerts, acknowledge', viewer: 'Timeline only', helper: 'Task prompts, emergency card during a visit, problem reports', owner: 'Everything' };
  return <><AppBar title="Care circle" onBack={onBack} right={<button className="btn sm primary" onClick={() => setShow(true)}><Icon name="plus" size={16} />Invite</button>} /><main className="body">
    {result && <div className="card"><span className="eyebrow">Access removed for {result.name}, target within 60 s</span>{result.channels.map(c => <div key={c.name} className="row small"><span className="grow">{c.name}</span><span className="tag flag-on">Removed in {c.ms} ms</span></div>)}</div>}
    <div className="list">{(list ?? []).map(m => <div key={m.id} className="li"><PersonAvatar seed={m.id} name={m.name ?? ''} /><div className="grow"><b>{m.name} <span className="tag">{R[m.role]}</span></b><div className="small muted">{m.status === 'active' ? P[m.role] : m.status}{m.role === 'backup' && m.backup_address_authorised ? ' · sees address in look-in links' : ''}</div></div>
      {m.status === 'active' && !['owner', 'helper'].includes(m.role) && <button className="btn sm" onClick={() => setConfirm(m)}>Remove</button>}</div>)}</div>
    {confirm && <div className="card warn"><b>Remove {confirm.name}?</b><div className="small">They lose access at once. History is kept.</div>
      <div className="btnrow"><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn danger" onClick={async () => { const r = await api<{ channels: { name: string; ms: number }[] }>(`/v1/households/${hh}/circle/${confirm.id}/revoke`, { body: {} }); setResult({ name: confirm.name, channels: r.channels }); setConfirm(null); reload(); }}>Remove access</button></div></div>}
    {show && <div className="card"><h3>Invite to care circle</h3>
      <div className="field"><label htmlFor="cn">Name</label><input id="cn" className="input" value={inv.name} onChange={e => setInv({ ...inv, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="cp">Phone</label><div className="row"><span className="tag">+91</span><input id="cp" className="input mono" inputMode="numeric" maxLength={10} value={inv.phone} onChange={e => setInv({ ...inv, phone: e.target.value })} /></div></div>
      <div className="field"><label htmlFor="cr">Role</label><select id="cr" className="input" value={inv.role} onChange={e => setInv({ ...inv, role: e.target.value })}>{['co_owner', 'backup', 'family', 'viewer'].map(r => <option key={r} value={r}>{R[r]}: {P[r]}</option>)}</select></div>
      {err && <span className="errtext" role="alert">{err}</span>}
      <button className="btn primary block" onClick={async () => { setErr(null); const ne = nameError(inv.name); if (ne) { setErr(ne); return; } try { await api(`/v1/households/${hh}/circle/invite`, { body: { ...inv, phone: '+91' + inv.phone.replace(/\D/g, '') } }); setShow(false); reload(); } catch (e) { setErr(errText(e)); } }}>Send invite</button></div>}
    <p className="xs muted">They accept by signing in with their own number.</p>
  </main></>;
}
