/**
 * Kept out of auth.ts, which is marked `server-only`. The worker and the seed script
 * run as plain Node processes and pull in lib/api.ts for notifications and audit
 * logging; if that transitively imported auth.ts the whole worker would refuse to
 * start.
 */
export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
    this.name = 'AuthError';
  }
}
