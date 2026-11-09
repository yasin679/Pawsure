/**
 * Ask Pawsure request schema + deterministic fallback parser (PS-055, PS-056, PS-065, PS-125).
 * The production LLM adapter must return a `ParsedRequest`; `validateParse` decides what still needs clarifying.
 * This rules parser is the offline/mock implementation and the fallback when the LLM times out (8 s) or is unavailable.
 */
import type { Minutes } from '../types.js';

export type FFTask = 'feed' | 'walk' | 'meds' | 'water' | 'litter' | 'toilet';
export type Access = 'Key handover' | 'Someone at home' | 'Friend has key';
export interface ParsedRequest {
  tasks: FFTask[];
  petId: string | null;
  time: Minutes | null;
  durationMin: number;
  access: Access | null;
  lift: 'Lift' | 'Stairs needed' | null;
  urgency: 'Urgent' | 'Today';
  medsInstructions: string | null;
  sources: Partial<Record<'time' | 'access' | 'pet', string>>;
}
export interface Clarification { field: 'time' | 'access' | 'meds' | 'tasks'; question: string; options: { value: string; label: string }[] }
export interface ParseResult { parsed: ParsedRequest; clarifications: Clarification[]; confidence: number; parser: 'rules' | 'llm' }

export const CRITICAL_FIELDS = ['time', 'tasks', 'meds', 'access'] as const;
const fmt = (m: Minutes) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

/** A bare hour resolves to its next occurrence today; if AM and PM are both ahead it is ambiguous; if passed it must be asked. */
export function resolveHour(hh: number, mm: number, ampm: string | undefined, now: Minutes): Minutes | 'ambiguous' | null {
  let h = hh;
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (ampm === 'am' || ampm === 'pm' || h >= 13 || h === 0) { const m = h * 60 + mm; return m > now ? m : null; }
  if (ampm === 'baje') { const pm = ((h % 12) + 12) * 60 + mm; return pm > now ? pm : null; }
  const am = (h % 12) * 60 + mm, pm = ((h % 12) + 12) * 60 + mm;
  if (am > now && pm > now) return 'ambiguous';
  return pm > now ? pm : null;
}

export interface ParseContext { now: Minutes; pets: { id: string; name: string; species: string; medsInstructions: string }[]; defaultAccess: Access | null; defaultAccessLabel?: string }

export function parseRequestRules(text: string, ctx: ParseContext): ParseResult {
  const low = ` ${text.toLowerCase()} `.replace(/\s+/g, ' ');
  const tasks = new Set<FFTask>();
  if (/feed|food|dinner|lunch|meal|khana|kibble|sachet/.test(low)) tasks.add('feed');
  if (/walk|take (him|her) down|stroll|potty|go down/.test(low)) tasks.add('walk');
  if (/medicine|tablet|pill|dose|supplement|meds|injection|drops/.test(low)) tasks.add('meds');
  if (/water/.test(low)) tasks.add('water');
  if (/litter/.test(low)) tasks.add('litter');
  if (/toilet pad|pee pad/.test(low)) tasks.add('toilet');
  const sources: ParsedRequest['sources'] = {};
  let petId: string | null = null;
  for (const p of ctx.pets) if (low.includes(p.name.toLowerCase())) petId = p.id;
  if (!petId) { const cat = ctx.pets.find(p => p.species === 'Cat'); petId = (/\bcat\b/.test(low) && cat ? cat.id : ctx.pets[0]?.id) ?? null; sources.pet = 'assumed'; }
  const clar: Clarification[] = [];
  let rest = low;
  const until = rest.match(/(?:until|till|back by|back at)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (until) rest = rest.replace(until[0], ' ');
  let time: Minutes | null = null, urgency: ParsedRequest['urgency'] = 'Today';
  const tm = rest.match(/(?:at|by|around|@)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|baje)?/) || rest.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?/) || rest.match(/\b(\d{1,2})()\s*(am|pm)\b/);
  const opts = (xs: Minutes[]) => xs.map(m => ({ value: String(m), label: fmt(m) }));
  if (!tm && /\b(right now|asap|immediately|urgent|now)\b/.test(rest)) { time = ctx.now + 15; urgency = 'Urgent'; sources.time = 'as soon as possible'; }
  else if (tm) {
    const hh = Number(tm[1]), mm = tm[2] ? Number(tm[2]) : 0, ap = tm[3] || undefined;
    const r = resolveHour(hh, mm, ap, ctx.now);
    if (r === 'ambiguous') clar.push({ field: 'time', question: `Did you mean ${hh} AM or ${hh} PM?`, options: opts([(hh % 12) * 60 + mm, ((hh % 12) + 12) * 60 + mm]) });
    else if (r == null) clar.push({ field: 'time', question: 'That time has passed today. When should the friend come?', options: opts([ctx.now + 30, 18 * 60, 19 * 60]) });
    else { time = r; sources.time = ap ? 'as written' : 'next occurrence today'; }
  } else {
    const vague = rest.match(/evening|tonight|later|afternoon|sometime|morning/);
    clar.push({ field: 'time', question: vague ? `“${vague[0]}” is not a specific time. When exactly?` : 'What time should the friend come?', options: opts([17 * 60, 18 * 60, 19 * 60]) });
  }
  let access: Access | null = null;
  if (/spare key|the key|\bkey\b/.test(low)) { access = 'Key handover'; sources.access = 'as written'; }
  else if (/someone (is )?home|is home|maid is there|door (will be )?open/.test(low)) { access = 'Someone at home'; sources.access = 'as written'; }
  else if (/let (them|her|him)sel(f|ves) in|get in somehow|let in|access/.test(low)) clar.push({ field: 'access', question: 'How will the friend get in? This is shared only after you confirm someone.', options: [{ value: 'Key handover', label: 'Key handover via backup' }, { value: 'Someone at home', label: 'Someone is at home' }, { value: 'Friend has key', label: 'Friend already has a key' }] });
  else if (ctx.defaultAccess) { access = ctx.defaultAccess; sources.access = ctx.defaultAccessLabel ?? 'from your profile'; }
  else clar.push({ field: 'access', question: 'How will the friend get in?', options: [{ value: 'Key handover', label: 'Key handover' }, { value: 'Someone at home', label: 'Someone is at home' }] });
  const pet = ctx.pets.find(p => p.id === petId);
  if (tasks.has('meds')) clar.push({ field: 'meds', question: 'Pawsure only passes on your written medicine instructions and never suggests a dose. Which instructions?', options: [{ value: 'profile', label: `Use ${pet?.name ?? 'the pet'}’s profile: ${pet?.medsInstructions ?? '—'}` }, { value: 'remove', label: 'Remove the medicine task' }] });
  if (!tasks.size) clar.push({ field: 'tasks', question: 'What should the friend do?', options: [{ value: 'feed', label: 'Feed' }, { value: 'walk', label: 'Short walk' }, { value: 'feed+walk', label: 'Feed + short walk' }] });
  const dm = low.match(/for (\d{1,3})\s*(min|mins|minutes)/);
  const durationMin = dm ? Number(dm[1]) : ((tasks.has('walk') ? 15 : 0) + (tasks.has('feed') ? 10 : 0) + (tasks.has('meds') ? 5 : 0) + (tasks.has('litter') || tasks.has('toilet') ? 5 : 0)) || 15;
  let lift: ParsedRequest['lift'] = null;
  if (/lift (is )?(not working|broken|down)|stairs only|use the stairs/.test(low)) lift = 'Stairs needed'; else if (/\blift\b|elevator/.test(low)) lift = 'Lift';
  const confidence = text.trim().length < 12 || (!tasks.size && time == null) ? 0.3 : 0.9;
  return { parsed: { tasks: [...tasks], petId, time, durationMin, access, lift, urgency, medsInstructions: null, sources }, clarifications: clar, confidence, parser: 'rules' };
}

/** Search is blocked while any critical field is missing or a clarification is open (C2). */
export function searchBlockedReasons(p: ParsedRequest, openClarifications: Clarification[]): string[] {
  const r: string[] = openClarifications.map(c => `clarify:${c.field}`);
  if (p.time == null) r.push('missing:time');
  if (!p.tasks.length) r.push('missing:tasks');
  if (!p.access) r.push('missing:access');
  if (p.tasks.includes('meds') && !p.medsInstructions) r.push('missing:meds_instructions');
  return [...new Set(r)];
}

/** PS-125 metric: did the owner change a critical field the AI parsed? */
export function correctedCriticalFields(before: ParsedRequest, after: ParsedRequest): string[] {
  const out: string[] = [];
  if (before.time !== after.time) out.push('time');
  if ([...before.tasks].sort().join() !== [...after.tasks].sort().join()) out.push(before.tasks.includes('meds') !== after.tasks.includes('meds') ? 'meds' : 'tasks');
  if (before.access !== after.access) out.push('access');
  return out;
}

/** Friend free-text reply → proposed time (PS-067). Ambiguous replies return null and stay pending. */
export function parseProposedTime(text: string): Minutes | null {
  const low = text.toLowerCase();
  const m = low.match(/(\d{1,2})[:.](\d{2})/) || low.match(/\b(\d{1,2})\s*(baje|pm|am|la|vajta|ko)\b/);
  if (!m) return null;
  let hh = Number(m[1]); const mm = m[2] && /^\d+$/.test(m[2]) ? Number(m[2]) : 0;
  if (hh < 12 && !/(^|[^a-z])am([^a-z]|$)|a\.m\./.test(low)) hh += 12;
  return hh * 60 + mm;
}
