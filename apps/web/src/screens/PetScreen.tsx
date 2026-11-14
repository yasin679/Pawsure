/** Pet tab (PS-003, PS-004, PS-035): profile, edit, emergency card; links to routine and health calendar. */
import { t as tr } from '../i18n';
import { useState } from 'react';
import { api, ApiError, type Pet } from '../api';
import { AppBar, Banner, Icon, PetAvatar } from '../ui';

const FIELDS: [keyof Pet, string, string?][] = [['name', 'Name'], ['breed', 'Breed'], ['age', 'Age'], ['food', 'Food and feeding', 'What, how much and when. Shown to whoever feeds your pet.'], ['allergies', 'Allergies', 'Write “None known” if there are none.'], ['medicines', 'Medicine instructions', 'Copy your vet’s written instructions, or write “None”. Pawsure never suggests doses.'], ['fears', 'Fears and habits'], ['handling_note', 'Handling note', 'Shown to anyone covering for the first time, before they accept. For example: nervous with strangers, slips out at the door, reacts on the lead.'], ['notes', 'Emergency notes'], ['vet_name', 'Your vet'], ['vet_phone', 'Vet phone'], ['clinic24_name', 'Nearest 24x7 clinic'], ['clinic24_phone', '24x7 clinic phone'], ['backup_name', 'Backup person'], ['backup_phone', 'Backup phone']];

const REQUIRED: (keyof Pet)[] = ['name', 'food', 'allergies', 'medicines', 'vet_name', 'vet_phone'];

export function PetScreen({ hh, pets, reload, onOpen }: { hh: string; pets: Pet[]; reload: () => void; onOpen: (v: 'routine' | 'health') => void }) {
  const [active, setActive] = useState(pets[0]?.id ?? 'new');
  const [mode, setMode] = useState<'view' | 'edit' | 'card'>('view');
  const pet = pets.find(p => p.id === active);
  const [form, setForm] = useState<Partial<Pet>>({});
  const [err, setErr] = useState<string | null>(null);
  const startEdit = (p?: Pet) => { setForm(p ? { ...p } : { name: '', species: 'Dog' }); setMode('edit'); };
  const save = async () => {
    setErr(null);
    const body: Record<string, unknown> = {}; FIELDS.forEach(([k]) => { const v = form[k]; if (typeof v === 'string' && v.trim() !== '') body[k] = v.trim(); }); body.species = form.species ?? 'Dog';
    const missing = FIELDS.filter(([k]) => REQUIRED.includes(k) && !body[k]).map(([, l]) => l);
    if (missing.length) { setErr(`Please fill in: ${missing.join(', ')}. These go on the emergency card and are shown to whoever cares for your pet.`); return; }
    try { if (pet && active !== 'new') await api(`/v1/households/${hh}/pets/${pet.id}`, { method: 'PATCH', body }); else { const r = await api<{ id: string }>(`/v1/households/${hh}/pets`, { body }); setActive(r.id); } setMode('view'); reload(); }
    catch (e) { setErr(e instanceof ApiError && e.status === 403 ? 'Your role can’t edit pet details.' : 'Couldn’t save. Check the fields and try again.'); }
  };

  if (mode === 'edit') return <><AppBar title={pet && active !== 'new' ? `Edit ${pet.name}` : 'Add a pet'} onBack={() => setMode('view')} /><main className="body">
    <div className="field"><label htmlFor="sp">{tr('Species')}</label><select id="sp" className="input" value={form.species} onChange={e => setForm({ ...form, species: e.target.value })}><option>{tr('Dog')}</option><option>{tr('Cat')}</option><option>{tr('Other')}</option></select></div>
    {FIELDS.map(([k, l, hint]) => <div key={k} className="field"><label htmlFor={'f-' + k}>{l}{REQUIRED.includes(k) && <span aria-hidden="true" style={{ color: 'var(--alert)' }}> *</span>}{REQUIRED.includes(k) && <span className="sr"> (required)</span>}</label><input id={'f-' + k} className="input" value={(form[k] as string) ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} />{hint && <span className="hint">{hint}</span>}</div>)}
    {err && <span className="errtext" role="alert">{err}</span>}
    <button className="btn primary block" onClick={save}>{tr('Save')}</button><p className="xs muted">* Required. “None” is a fine answer.</p>
  </main></>;

  if (mode === 'card' && pet) return <><AppBar title={tr('Emergency card')} onBack={() => setMode('view')} /><main className="body">
    <div className="card danger"><div className="row"><PetAvatar species={pet.species} size={60} /><div><h2>{pet.name}</h2><div className="small">{pet.species} · {pet.breed}</div></div></div>
      <dl className="kv"><dt>{tr('Allergies')}</dt><dd>{pet.allergies || '—'}</dd><dt>{tr('Medicine')}</dt><dd>{pet.medicines || '—'}</dd><dt>{tr('Notes')}</dt><dd>{[pet.fears, pet.notes].filter(Boolean).join(' ') || '—'}</dd></dl></div>
    <div className="list">{[['Own vet', pet.vet_name, pet.vet_phone], ['24x7 clinic', pet.clinic24_name, pet.clinic24_phone], ['Backup', pet.backup_name, pet.backup_phone]].map(([l, n, ph]) => <div key={l} className="li"><span className="avatar icon"><Icon name="phone" size={20} /></span><div className="grow"><b>{l}: {n || '—'}</b><div className="small muted mono">{ph || '—'}</div></div>{ph && <a className="btn sm primary" href={`tel:${ph.replace(/\s/g, '')}`}>{tr('Call')}</a>}</div>)}
      <div className="li"><span className="avatar icon"><Icon name="vaccine" size={20} /></span><div className="grow"><b>Partner tele-consult</b><div className="small muted">Planned, not available until a partner agreement is signed</div></div></div></div>
    <span className="xs muted">{pet.source} · updated {pet.updated_at?.slice(0, 10)}</span>
    <Banner kind="alert" icon="!">{tr('In an emergency, call your vet or the 24x7 clinic.')}</Banner>
  </main></>;

  return <><AppBar title={tr('Pet')} /><main className="body">
    <div className="seg" role="group">{pets.map(p => <button key={p.id} aria-pressed={active === p.id} onClick={() => setActive(p.id)}>{p.name}</button>)}<button aria-pressed={false} onClick={() => { setActive('new'); startEdit(); }}>{tr('+ Add')}</button></div>
    {pet ? <>
      <div className="card"><div className="row"><PetAvatar species={pet.species} size={60} /><div className="grow"><h2>{pet.name}</h2><div className="small muted">{[pet.species, pet.breed, pet.age].filter(Boolean).join(' · ')}</div></div><button className="btn sm" onClick={() => startEdit(pet)}>{tr('Edit')}</button></div>
        <dl className="kv"><dt>{tr('Food')}</dt><dd>{pet.food || '—'}</dd><dt>{tr('Allergies')}</dt><dd>{pet.allergies || '—'}</dd><dt>{tr('Medicine')}</dt><dd>{pet.medicines || '—'}</dd><dt>{tr('Fears / habits')}</dt><dd>{pet.fears || '—'}</dd><dt>{tr('Handling note')}</dt><dd>{pet.handling_note || 'Not added yet'} <span className="xs muted">(shown to first-time carers before they accept)</span></dd></dl>
        <span className="xs muted">{pet.source} · last updated {pet.updated_at?.slice(0, 10)}</span></div>
      <div className="list">
        <button className="li" onClick={() => setMode('card')}><span className="avatar icon"><Icon name="card" size={20} /></span><div className="grow"><b>{tr('Emergency card')}</b><div className="small muted">{tr('Allergies, medicine, vet, 24x7 clinic, backup')}</div></div><span className="chev">›</span></button>
        <button className="li" onClick={() => onOpen('routine')}><span className="avatar icon"><Icon name="list" size={20} /></span><div className="grow"><b>{tr('Routine')}</b><div className="small muted">{tr('Tasks, times, who does them')}</div></div><span className="chev">›</span></button>
        <button className="li" onClick={() => onOpen('health')}><span className="avatar icon"><Icon name="vaccine" size={20} /></span><div className="grow"><b>{tr('Health calendar')}</b><div className="small muted">{tr('Vaccines, deworming, follow-ups')}</div></div><span className="chev">›</span></button>
      </div></> : <div className="empty">{tr('No pets yet. Add one to get started.')}</div>}
  </main></>;
}
