import bcrypt from 'bcryptjs';

/**
 * Kept separate from auth.ts, which is marked `server-only` and therefore cannot be
 * imported by plain Node scripts (the seed script and the worker both need hashing).
 */

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
