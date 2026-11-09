/** Monthly food-box code card — PS-024, PS-109. One code per day; rotated monthly or at once on suspected copying. */
export interface CodeCard { householdId: string; month: string; version: number; codes: Record<number, string>; active: boolean }

/** Codes come from a CSPRNG supplied by the caller (crypto.getRandomValues in the API). Never derive them from guessable data. */
export function generateCard(householdId: string, month: string, version: number, daysInMonth: number, random: (n: number) => Uint32Array): CodeCard {
  const r = random(daysInMonth); const codes: Record<number, string> = {};
  for (let d = 1; d <= daysInMonth; d++) codes[d] = String(1000 + ((r[d - 1] ?? 0) % 9000));
  return { householdId, month, version, codes, active: true };
}

/** Old versions stop counting at rotation. */
export function checkCode(cards: CodeCard[], day: number, code: string): 'today' | 'old' | 'wrong' {
  const active = cards.find(c => c.active);
  if (active?.codes[day] === code) return 'today';
  if (cards.some(c => !c.active && Object.values(c.codes).includes(code)) || Object.entries(active?.codes ?? {}).some(([d, c]) => Number(d) !== day && c === code)) return 'old';
  return 'wrong';
}

/** Notification previews must never contain a code value. */
export const redactCodes = (text: string) => text.replace(/\b\d{4}\b/g, '••••');
