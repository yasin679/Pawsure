/** Emergency severity matrix — PS-124, PRD 10.6. Pawsure is not an emergency or vet service and never promises a response. */
import type { Minutes } from './types.js';

export type Severity = 'S1' | 'S2' | 'S3';
export const CATEGORIES: Record<Severity, string[]> = {
  S1: ['pet_hurt', 'bite', 'collapse_breathing', 'pet_missing', 'door_key_security'],
  S2: ['vomiting', 'not_eating', 'limping', 'unusual_behaviour'],
  S3: ['food_out', 'water_out', 'pads_out', 'pet_outside']
};
export const severityOf = (category: string): Severity => (Object.keys(CATEGORIES) as Severity[]).find(k => CATEGORIES[k].includes(category)) ?? 'S3';

export type Channel = 'whatsapp' | 'call' | 'push' | 'ops_queue';
export interface NotifyStep { offset: number; to: 'owner' | 'backup' | 'owner+backup' | 'care_circle' | 'helper' | 'ops'; channels: Channel[]; purpose: string; stopsOnAck: boolean }

export const SEVERITY_PLAN: Record<Severity, NotifyStep[]> = {
  S1: [
    { offset: 0, to: 'owner+backup', channels: ['whatsapp', 'call'], purpose: 'alert', stopsOnAck: false },
    { offset: 0, to: 'helper', channels: ['whatsapp'], purpose: 'emergency_card', stopsOnAck: false },
    { offset: 0, to: 'ops', channels: ['ops_queue'], purpose: 'open_case', stopsOnAck: false },
    { offset: 5, to: 'owner+backup', channels: ['call'], purpose: 'repeat_call_1', stopsOnAck: true },
    { offset: 10, to: 'owner+backup', channels: ['call'], purpose: 'repeat_call_2', stopsOnAck: true },
    { offset: 15, to: 'owner+backup', channels: ['call'], purpose: 'repeat_call_3', stopsOnAck: true },
    { offset: 15, to: 'care_circle', channels: ['call'], purpose: 'call_everyone', stopsOnAck: true },
    { offset: 15, to: 'helper', channels: ['whatsapp'], purpose: 'call_vet_directly', stopsOnAck: true }
  ],
  S2: [
    { offset: 0, to: 'owner', channels: ['whatsapp', 'push'], purpose: 'alert', stopsOnAck: false },
    { offset: 15, to: 'backup', channels: ['whatsapp'], purpose: 'alert_backup', stopsOnAck: true },
    { offset: 30, to: 'owner+backup', channels: ['call'], purpose: 'call', stopsOnAck: true },
    { offset: 30, to: 'ops', channels: ['ops_queue'], purpose: 'review', stopsOnAck: true }
  ],
  S3: [
    { offset: 0, to: 'owner', channels: ['whatsapp', 'push'], purpose: 'alert', stopsOnAck: false },
    { offset: 30, to: 'backup', channels: ['whatsapp'], purpose: 'alert_backup', stopsOnAck: true }
  ]
};

export interface Incident { id: string; severity: Severity; category: string; reportedAt: Minutes; ackAt?: Minutes; resolvedAt?: Minutes; resolutionNote?: string }

/** Steps due at `now` that have not been stopped by acknowledgement. Idempotency is the caller's job (key = incident id + step index). */
export function dueSteps(inc: Incident, now: Minutes): { index: number; step: NotifyStep; at: Minutes }[] {
  if (inc.resolvedAt != null) return [];
  return SEVERITY_PLAN[inc.severity].map((step, index) => ({ index, step, at: inc.reportedAt + step.offset }))
    .filter(x => now >= x.at && !(x.step.stopsOnAck && inc.ackAt != null && inc.ackAt <= x.at));
}

export function resolveIncident(inc: Incident, at: Minutes, note: string): Incident {
  if (!note.trim()) throw new Error('A resolution note is required to close an incident');
  return { ...inc, resolvedAt: at, resolutionNote: note, ackAt: inc.ackAt ?? at };
}
