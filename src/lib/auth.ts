import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { prisma } from './db';

export { hashPassword, verifyPassword } from './password';
export { AuthError } from './errors';

import { AuthError } from './errors';

export const SESSION_COOKIE = 'oa_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Secure cookies only when the public app URL is HTTPS.
 *
 * Tying this to NODE_ENV===production broke EC2 / IP deploys on plain HTTP: the
 * browser refused to store the Secure cookie, so login returned 200 then the next
 * navigation had no session and bounced straight back to /login.
 */
function cookieSecure(): boolean {
  const appUrl = process.env.APP_URL ?? '';
  if (appUrl.startsWith('https://')) return true;
  if (appUrl.startsWith('http://')) return false;
  return process.env.NODE_ENV === 'production';
}

export type SessionPayload = {
  uid: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  name: string;
};

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return new TextEncoder().encode(s);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Loads the full user row for the current session. Deduped per-request by React
 * `cache`, so layouts and pages can call it freely without extra queries.
 */
export const getCurrentUser = cache(async () => {
  const session = await readSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.uid } });
  if (!user || !user.active) return null;
  return user;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('Not authenticated', 401);
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new AuthError('Admin access required', 403);
  return user;
}

