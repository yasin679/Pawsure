/**
 * Browser stand-in for the parts of `node:crypto` the API uses, so the real API code can run in the in-browser demo.
 * Synchronous on purpose (the API calls these synchronously): SHA-256 from @noble/hashes, AES-256-GCM from
 * @noble/ciphers, randomness from crypto.getRandomValues. Demo only — the server build uses real node:crypto.
 */
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha256';
import { gcm } from '@noble/ciphers/aes';

(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;

// The `buffer` polyfill predates Node's 'base64url' encoding, which the API uses for session and link tokens.
/* eslint-disable @typescript-eslint/no-explicit-any */
const B = Buffer as any, toStr = B.prototype.toString, from = B.from;
B.prototype.toString = function (enc?: string, start?: number, end?: number) {
  return enc === 'base64url' ? toStr.call(this, 'base64', start, end).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : toStr.call(this, enc, start, end);
};
B.from = function (v: unknown, enc?: unknown, len?: unknown) {
  return enc === 'base64url' && typeof v === 'string' ? from.call(B, v.replace(/-/g, '+').replace(/_/g, '/'), 'base64') : from.call(B, v, enc, len);
};

const toBytes = (d: string | Uint8Array, enc?: string) => (typeof d === 'string' ? Buffer.from(d, (enc ?? 'utf8') as BufferEncoding) : d);

export function createHash(alg: string) {
  if (alg !== 'sha256') throw new Error('demo crypto supports sha256 only');
  const parts: Uint8Array[] = [];
  const h = {
    update(d: string | Uint8Array, enc?: string) { parts.push(toBytes(d, enc)); return h; },
    digest(enc?: string) { const out = Buffer.from(sha256(Buffer.concat(parts))); return enc ? out.toString(enc as BufferEncoding) : out; }
  };
  return h as { update(d: string | Uint8Array, enc?: string): typeof h; digest(): Buffer; digest(enc: string): string };
}

export function randomBytes(n: number) { const b = Buffer.alloc(n); crypto.getRandomValues(b); return b; }
export function randomFillSync<T extends Uint8Array>(b: T): T { crypto.getRandomValues(b); return b; }
export function randomInt(min: number, max?: number) {
  if (max === undefined) { max = min; min = 0; }
  const range = max - min, buf = new Uint32Array(1), limit = Math.floor(0x100000000 / range) * range;
  do crypto.getRandomValues(buf); while (buf[0]! >= limit);
  return min + (buf[0]! % range);
}
export function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let r = 0; for (let i = 0; i < a.length; i++) r |= a[i]! ^ b[i]!;
  return r === 0;
}

/** AES-256-GCM with Node's streaming shape: update() buffers, final() does the work. */
export function createCipheriv(_alg: string, key: Uint8Array, iv: Uint8Array) {
  const parts: Uint8Array[] = []; let aad: Uint8Array | undefined; let tag = Buffer.alloc(0);
  return {
    setAAD(a: Uint8Array) { aad = a; },
    update(d: string | Uint8Array, enc?: string) { parts.push(toBytes(d, enc)); return Buffer.alloc(0); },
    final() { const out = gcm(key, iv, aad).encrypt(Buffer.concat(parts)); tag = Buffer.from(out.slice(-16)); return Buffer.from(out.slice(0, -16)); },
    getAuthTag() { return tag; }
  };
}
export function createDecipheriv(_alg: string, key: Uint8Array, iv: Uint8Array) {
  const parts: Uint8Array[] = []; let aad: Uint8Array | undefined; let tag: Uint8Array = new Uint8Array(0);
  return {
    setAAD(a: Uint8Array) { aad = a; },
    setAuthTag(t: Uint8Array) { tag = t; },
    update(d: string | Uint8Array, enc?: string) { parts.push(toBytes(d, enc)); return Buffer.alloc(0); },
    final() { return Buffer.from(gcm(key, iv, aad).decrypt(Buffer.concat([...parts, tag]))); }
  };
}
export default { createHash, randomBytes, randomFillSync, randomInt, timingSafeEqual, createCipheriv, createDecipheriv };
