/**
 * DEMO ONLY: presets for the 14 new v1.4 acceptance rows (PRD 17.1). Each one moves the demo clock and plays the
 * simulated phones up to the scenario's starting point, then tells the presenter what to tap. They use the same API,
 * webhooks and job runner as everything else; nothing is faked on screen. Best right after the demo loads.
 */
import { api } from '../api';

const SUNITA = '+919000000035', DESAI = '+919800000040', ANKITA = '+919700000008', PRIYA = '+919900000012';
const DAY = '2026-11-06';
const at = (hm: string) => `${DAY}T${hm}:00+05:30`;
const clock = async (hm: string) => { await api('/demo/clock', { body: { set: at(hm) }, auth: false }); await api('/jobs/tick', { body: {}, auth: false }); };
const hook = (from: string, b: Record<string, unknown>) => api('/webhooks/whatsapp', { body: { messageId: 'preset-' + Math.random().toString(36).slice(2), from, ...b }, auth: false });
const reminderButton = async (kind: 'yes' | 'cant' | 'sub') => {
  const t = await api<{ template: string | null; buttons: { id: string }[] | null }[]>('/demo/helper-thread/m_sunita', { auth: false });
  return t.filter(m => m.template === 'cover_reminder').at(-1)?.buttons?.find(b => b.id.startsWith('cover_' + kind))?.id;
};
const job = async (hh: string) => (await api<{ jobs: { id: string; active: boolean }[] }>(`/v1/households/${hh}/cover`)).jobs.filter(j => j.active).at(-1)!.id;
const friendRequest = async (hh: string, text: string, friend: string) => {
  const r = await api<{ id: string }>(`/v1/households/${hh}/requests`, { body: { text } });
  await api(`/v1/households/${hh}/requests/${r.id}/search`, { body: {} });
  await api(`/v1/households/${hh}/requests/${r.id}/approve`, { body: { friendIds: [friend], mode: 'one', approved: true } });
  return r.id;
};

export interface Preset { id: string; title: string; hint: string; run: (hh: string) => Promise<void> }
export const PRESETS: Preset[] = [
  { id: 'O1', title: 'Helper can’t make it at 2:30', hint: 'Show Sunita’s phone → tap येऊ शकत नाही (Can’t make it). Then Show backups’ phones → Mrs Desai: I have read this → Yes. Back on Today: Confirm Mrs Desai, then the gate and key checklist.', run: async () => { await clock('14:30'); } },
  { id: 'O2', title: 'No reply by 3:15', hint: 'The 2:30 reminder is on Sunita’s phone. Don’t reply: tap +15m three times to reach 3:15. Today shows At risk with “no reply”.', run: async () => { await clock('14:30'); await clock('14:35'); } },
  { id: 'O3', title: 'Helper says “can’t come” at 11 AM', hint: 'Show Sunita’s phone → tap ✕ “येऊ शकत नाही” (can’t come). The 1 PM visit goes At risk at once and she gets no prompts for it.', run: async () => { await clock('11:00'); } },
  { id: 'O4', title: 'Send someone else (substitute)', hint: 'Show Sunita’s phone → दुसऱ्याला पाठवते (Send someone else) → Send name. Today: Approve लता. Show backups’ phones → लता → Open the task link.', run: async () => { await clock('14:30'); } },
  { id: 'O5', title: 'Backups in order, owner stops the list', hint: 'Today → See what’s happening: Mrs Desai and Ankita asked first (key holders). Tap +5m twice: the next pair. Then Stop asking.', run: async (hh) => { await clock('14:30'); const b = await reminderButton('cant'); if (b) await hook(SUNITA, { type: 'button', payload: b }); void hh; } },
  { id: 'O6', title: 'Friend cancels after the cutoff', hint: 'Priya was confirmed for 5 PM and has just cancelled at 4:45. Today: At risk, backups asked; See what’s happening says Friend Finder was not started.', run: async (hh) => { await clock('15:30'); const id = await friendRequest(hh, 'Can someone feed Bruno at 5 pm? Spare key with Ankita.', 'u_priya'); await hook(PRIYA, { type: 'button', payload: `ff_yes:${id}` }); await api(`/v1/households/${hh}/requests/${id}/confirm`, { body: { friendId: 'u_priya' } }); await clock('16:45'); await hook(PRIYA, { type: 'button', payload: `ff_cancel:${id}` }); await api('/jobs/tick', { body: {}, auth: false }); } },
  { id: 'O7', title: 'Cover not found: medicine', hint: 'The Cover not found sheet opens: no Move or Skip for the supplement. Tap +15m: your care circle is called (see Show backups’ phones / the rail of calls).', run: async (hh) => { await clock('11:40'); await hook(SUNITA, { type: 'text', text: "I can't come today" }); const j = await job(hh); await hook(ANKITA, { type: 'button', payload: `cb_yes:${j}` }); await api(`/v1/households/${hh}/cover/jobs/${j}/confirm`, { body: { personId: 'bk_ankita' } }); await clock('11:55'); await clock('12:30'); } },
  { id: 'O8', title: 'Cover not found: a walk that can wait', hint: 'The Cover not found sheet offers Move and Skip. Tap Move it → Move it. Day report → Cover history shows who was asked.', run: async (hh) => { await api(`/v1/households/${hh}/routine`, { body: { petId: 'bruno', title: 'Evening play walk', type: 'walk', due: 1110, assignee: 'helper', oneOffToday: true } }); for (const t of ['17:00', '17:45', '17:55', '18:05', '18:15']) await clock(t); } },
  { id: 'O9', title: 'Leaving with nobody confirmed', hint: 'Sunita is marked unavailable. Tap I’m leaving → read the warning → Leave anyway → choose a plan B → I’m leaving. Today shows No cover planned.', run: async (hh) => { await api(`/v1/households/${hh}/day`, { method: 'PUT', body: { helperUnavailable: true, reason: 'Unwell' } }); } },
  { id: 'O10', title: 'I’m delayed 7 → 9 PM', hint: 'Tap I’m delayed → 9:00 PM → See what changes → Ask Sunita first. Show Sunita’s phone → फक्त 8:00 PM पर्यंत (Only until 8). Today: a request for the dinner only.', run: async (hh) => { await api(`/v1/households/${hh}/day/leaving`, { body: { checklist: null, returnAt: 1140 } }); await clock('18:30'); } },
  { id: 'O11', title: 'Gate and key reminder', hint: 'Mrs Desai is covering 4 PM and the checklist isn’t done. Tap +5m: the owner gets one reminder at 3:45. Then tick the gate and pick the key plan.', run: async (hh) => { await clock('14:30'); const b = await reminderButton('cant'); if (b) await hook(SUNITA, { type: 'button', payload: b }); const j = await job(hh); await hook(DESAI, { type: 'button', payload: `cb_read:${j}` }); await hook(DESAI, { type: 'button', payload: `cb_yes:${j}` }); await api(`/v1/households/${hh}/cover/jobs/${j}/confirm`, { body: { personId: 'bk_desai' } }); await clock('15:40'); } },
  { id: 'O12', title: 'First-time friend reads the handling note', hint: 'Show friends’ phones → Rahul: Yes is refused until he taps I have read this. Then Yes, and confirm on Find cover.', run: async (hh) => { await clock('18:00'); await friendRequest(hh, 'Can someone feed Bruno at 7:30 pm? Spare key with Ankita.', 'u_rahul'); } },
  { id: 'O13', title: 'Newcomer with nobody', hint: 'Me → Sign out, then sign up with a new number (for example 98112 22777). After the profile, answer “No one yet” to see the circle builder.', run: async () => {} },
  { id: 'O14', title: 'Cluster advisory', hint: 'Ops console → sign in as the ops lead (98110 00002) → Cluster advisory → Send. Back to the owner app, tap +5m: Sunita has tomorrow’s reminder this evening.', run: async () => { await clock('18:40'); } }
];
