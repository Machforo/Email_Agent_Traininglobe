import path from 'node:path';
import { config } from 'dotenv';

/**
 * Shared env rules for EC2. Worker boot and `npm run ec2:check` use the same list
 * so a missing Groq key fails before anyone stares at "Waiting for the worker".
 */
export const REQUIRED_ENV = ['DATABASE_URL', 'AUTH_SECRET', 'ENCRYPTION_KEY', 'APP_URL'] as const;

export function loadEnvFromRoot(root = path.resolve(process.cwd())): string {
  const envPath = path.join(root, '.env');
  config({ path: envPath });
  return envPath;
}

export function missingEnv(): string[] {
  const missing: string[] = [];
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]?.trim()) missing.push(key);
  }
  const groq = (process.env.GROQ_API_KEYS ?? process.env.GROQ_API_KEY ?? '').trim();
  if (!groq) missing.push('GROQ_API_KEYS');
  return missing;
}

export function groqKeyCount(): number {
  return (process.env.GROQ_API_KEYS ?? process.env.GROQ_API_KEY ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean).length;
}

export const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
