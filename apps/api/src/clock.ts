/** IST care-day clock. Care days run midnight–midnight IST (PS-111). */
const IST_OFFSET_MIN = 330;

export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };

/** Fixed/adjustable clock for demos and tests. Only wired in when DEMO_MODE=1; never in production. */
/**
 * Demo clock. Frozen by default (tests need exact times). With { live: true } it also moves with real time, so
 * real-world waits work in the demo (for example the 30-second wait before resending a sign-in code), while
 * set() and advance() still jump it for walkthroughs.
 */
export function demoClock(startIso: string, opts: { live?: boolean } = {}): Clock & { set(iso: string): void; advance(min: number): void } {
  let t = new Date(startIso).getTime(), base = Date.now();
  const read = () => (opts.live ? t + (Date.now() - base) : t);
  return { now: () => new Date(read()), set: (iso) => { t = new Date(iso).getTime(); base = Date.now(); }, advance: (m) => { t = read() + m * 60000; base = Date.now(); } };
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
