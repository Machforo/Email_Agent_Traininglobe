import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * Prisma client, shared by the Next.js app (Vercel) and the worker (Render) against
 * one managed Postgres.
 *
 * Pool sizing matters here: Vercel runs many short-lived serverless instances, each of
 * which would otherwise open its own pool and exhaust Postgres connection slots. The
 * app therefore keeps a deliberately small pool, while the worker — a single
 * long-lived process doing real work — gets a slightly larger one.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const isWorker = process.env.APP_ROLE === 'worker';

/**
 * True when pointed at the local PGlite dev harness (`npm run pg`).
 *
 * PGlite's socket server multiplexes several connections onto one single-threaded
 * database, and its extended-query handling desyncs when two pooled connections
 * interleave — surfacing as `08P01: bind message supplies 1 parameters, but prepared
 * statement "" requires 3`. Capping each process to a single connection keeps its
 * traffic strictly sequential, which PGlite handles correctly. Real Postgres has no
 * such limitation, so this only applies locally.
 */
function isLocalPglite(url: string): boolean {
  return /localhost:5433|127\.0\.0\.1:5433/.test(url);
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const poolSize = isLocalPglite(connectionString) ? 1 : isWorker ? 5 : 2;

  const adapter = new PrismaPg({
    connectionString,
    max: poolSize,
    // Serverless instances are frozen between requests; drop idle sockets quickly so
    // Postgres reclaims the slot rather than holding it for a instance that may never
    // wake again.
    idleTimeoutMillis: isWorker ? 30_000 : 10_000,
    connectionTimeoutMillis: 15_000,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
