import type { CareTask, CareVisit, TaskSignal, VisitSignal } from '../src/index.js';
export const T = (h: number, m = 0) => h * 60 + m;
let n = 0;
export function task(p: Partial<CareTask> = {}): CareTask {
  return { id: p.id ?? 't' + ++n, petId: 'bruno', title: 'Lunch + water', type: 'feeding', due: T(13), minMinutes: 5, visitId: 'v1', assignee: 'sunita', profile: 'standard', signals: [], lifecycle: [{ at: 0, state: 'Planned', actor: 'routine' }], escalation: {}, ...p };
}
export const photo = (at: number, code: 'today' | 'none' | 'wrong' | 'old' = 'today', hash = 'h' + ++n, duplicate = false): TaskSignal => ({ id: 's' + ++n, kind: 'photo', code, imageHash: hash, duplicate, eventTime: at, receivedTime: at, source: 'whatsapp' });
export const voice = (at: number): TaskSignal => ({ id: 's' + ++n, kind: 'voice', namesTask: true, eventTime: at, receivedTime: at, source: 'whatsapp' });
export const ivr = (at: number, codeOk = true): TaskSignal => ({ id: 's' + ++n, kind: 'ivr', codeOk, afterPrompt: true, eventTime: at, receivedTime: at, source: 'ivr' });
export const call = (kind: 'call_arrive' | 'call_exit', at: number, registeredNumber = true): VisitSignal => ({ id: 'c' + ++n, kind, registeredNumber, eventTime: at, receivedTime: at, source: 'ivr' });
export const gate = (at: number): VisitSignal => ({ id: 'g' + ++n, kind: 'gate', ownerProvided: true, eventTime: at, receivedTime: at, source: 'owner' });
export const visit = (signals: VisitSignal[]): CareVisit => ({ id: 'v1', who: 'sunita', signals });
