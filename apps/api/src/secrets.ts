/** Code-card encryption at rest (AES-256-GCM). Production key comes from the secrets manager / KMS (CODE_CARD_KEY, 32 bytes base64). */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const key = () => {
  const k = process.env.CODE_CARD_KEY;
  if (k) return Buffer.from(k, 'base64');
  if (process.env.NODE_ENV === 'production') throw new Error('CODE_CARD_KEY is required in production');
  return createHash('sha256').update('pawsure-demo-code-card-key').digest();
};

export function seal(plain: unknown): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
export function open<T>(sealed: string): T {
  const [iv, tag, enc] = sealed.split('.').map(s => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key(), iv!); d.setAuthTag(tag!);
  return JSON.parse(Buffer.concat([d.update(enc!), d.final()]).toString('utf8')) as T;
}
