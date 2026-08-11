import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from './errors';
import { prisma } from './db';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Wraps a route handler so thrown AuthError / ZodError become clean JSON responses
 * instead of 500s, and unexpected errors are logged server-side without leaking
 * internals to the client.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof AuthError) return fail(err.message, err.status);
      if (err instanceof ZodError) {
        return fail('Validation failed', 422, {
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      console.error('[api]', err);
      const message = err instanceof Error ? err.message : 'Internal server error';
      return fail(message, 500);
    }
  };
}

export async function audit(
  userId: string | null,
  action: string,
  entity?: string,
  entityId?: string,
  meta?: unknown,
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        meta: meta === undefined ? null : JSON.stringify(meta),
      },
    });
  } catch (e) {
    console.error('[audit] failed', e);
  }
}

export async function notify(
  userId: string,
  type: string,
  title: string,
  body?: string,
  link?: string,
) {
  try {
    await prisma.notification.create({ data: { userId, type, title, body, link } });
  } catch (e) {
    console.error('[notify] failed', e);
  }
}
