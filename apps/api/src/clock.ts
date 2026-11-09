/** IST care-day clock. Care days run midnight–midnight IST (PS-111). */
const IST_OFFSET_MIN = 330;

export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };

/** Fixed/adjustable clock for demos and tests. Only wired in when DEMO_MODE=1; never in production. */
export function demoClock(startIso: string): Clock & { set(iso: string): void; advance(min: number): void } {
  let t = new Date(startIso).getTime();
  return { now: () => new Date(t), set: (iso) => { t = new Date(iso).getTime(); }, advance: (m) => { t += m * 60000; } };
}

export function istDate(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
  return ist.toISOString().slice(0, 10);
}
export function istMinutes(d: Date): number {
  const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}
/** Minutes since IST midnight of `careDate` (may exceed 1440 for late events). */
export function minutesOnDay(d: Date, careDate: string): number {
  const midnight = Date.parse(careDate + 'T00:00:00+05:30');
  return Math.floor((d.getTime() - midnight) / 60000);
}
export function atMinute(careDate: string, minute: number): Date {
  return new Date(Date.parse(careDate + 'T00:00:00+05:30') + minute * 60000);
}
