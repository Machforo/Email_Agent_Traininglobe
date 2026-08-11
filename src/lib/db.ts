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

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const adapter = new PrismaPg({
    connectionString,
    max: isWorker ? 5 : 2,
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
