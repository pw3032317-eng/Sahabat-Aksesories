import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { storeSettings } from '../db/schema.ts';

export const MOBILE_IDLE_MS = 20 * 60 * 1000; // 20 minutes on mobile
export const DESKTOP_SESSION_MS = 365 * 24 * 60 * 60 * 1000; // persistent on desktop until explicit logout
const SESSION_SECRET_KEY = 'session_signing_secret';

let cachedSecret: string | null = null;
let secretPromise: Promise<string> | null = null;

async function getSigningSecret(): Promise<string> {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  if (cachedSecret) {
    return cachedSecret;
  }
  if (!secretPromise) {
    secretPromise = (async () => {
      try {
        const existing = await db
          .select({ value: storeSettings.value })
          .from(storeSettings)
          .where(eq(storeSettings.key, SESSION_SECRET_KEY))
          .limit(1);
        if (existing[0]?.value) {
          cachedSecret = existing[0].value;
          return cachedSecret;
        }
        const generated = randomBytes(32).toString('hex');
        await db
          .insert(storeSettings)
          .values({
            key: SESSION_SECRET_KEY,
            value: generated,
            updatedAt: new Date(),
          })
          .onConflictDoNothing({ target: storeSettings.key });

        const reread = await db
          .select({ value: storeSettings.value })
          .from(storeSettings)
          .where(eq(storeSettings.key, SESSION_SECRET_KEY))
          .limit(1);
        cachedSecret = reread[0]?.value || generated;
        return cachedSecret;
      } finally {
        secretPromise = null;
      }
    })();
  }
  return secretPromise;
}

export function hashPassword(rawPassword: string): string {
  const password = String(rawPassword || '').trim();
  if (password.length < 4) {
    throw new Error('Password minimal 4 karakter (angka atau huruf)');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(rawPassword: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const password = String(rawPassword || '').trim();
  if (password.length < 4) return false;
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  try {
    const actualBuf = scryptSync(password, salt, 64);
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (actualBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(actualBuf, expectedBuf);
  } catch {
    return false;
  }
}

export interface SessionTokenPayload {
  v: 1;
  uid: number;
  email: string;
  dev?: 'm' | 'd';
  iat: number;
  exp: number;
}

export async function signSessionToken(
  userId: number,
  email: string,
  deviceType: 'mobile' | 'desktop' = 'mobile',
): Promise<{ token: string; expiresAt: number }> {
  const secret = await getSigningSecret();
  const now = Date.now();
  const ttl = deviceType === 'desktop' ? DESKTOP_SESSION_MS : MOBILE_IDLE_MS;
  const exp = now + ttl;
  const payload: SessionTokenPayload = {
    v: 1,
    uid: userId,
    email: email.trim().toLowerCase(),
    dev: deviceType === 'desktop' ? 'd' : 'm',
    iat: now,
    exp,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return {
    token: `sp.${encoded}.${sig}`,
    expiresAt: exp,
  };
}

export async function verifySessionToken(token: string): Promise<SessionTokenPayload | null> {
  if (!token || !token.startsWith('sp.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  if (!encoded || !sig) return null;

  try {
    const secret = await getSigningSecret();
    const expectedSig = createHmac('sha256', secret).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<SessionTokenPayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.uid !== 'number' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    return parsed as SessionTokenPayload;
  } catch {
    return null;
  }
}
