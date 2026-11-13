export * from './types.js';
export * from './trust.js';
export * from './lifecycle.js';
export * from './escalation.js';
export * from './coveredDay.js';
export * from './emergency.js';
export * from './rewards.js';
export * from './codeCard.js';
export * from './permissions.js';
export * from './friendfinder/parse.js';
export * from './friendfinder/match.js';
export * from './friendfinder/stateMachine.js';
export * from './pilot.js';
export * from './cover/config.js';
export * from './cover/stateMachine.js';
export * from './cover/planner.js';

/** Feature switches with their pilot defaults (master prompt §4.2). */
export const FLAG_DEFAULTS = {
  helperRewards: { default: 'cohort', note: 'ON for 10 of 20 households (PS-126)' },
  helperShareRecord: { default: false, note: 'OFF; may enable after week 2 (PS-104)' },
  nearbyMemberFallback: { default: false, locked: true, note: 'OFF until ID-check process approved (PS-062)' },
  sameSocietyFallback: { default: false, locked: true, note: 'Built, OFF until the verification rule is decided (PS-141, PRD 20.3)' },
  friendThankYouPoints: { default: false, note: 'OFF until funding approved (PS-107)' },
  ownerCameraLookIn: { default: false, note: 'OFF in pilot (PS-008/PS-037)' },
  dayCare: { default: false, locked: true, note: 'P1' },
  verifiedCarers: { default: false, locked: true, note: 'P2' }
} as const;
export * from './daily.js';
export * from './ledger.js';
