/** The demo runs inside an artifact frame where service workers are not allowed, so PWA registration is a no-op. */
export const registerSW = (_opts?: unknown) => () => Promise.resolve();
