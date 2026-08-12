import { prisma } from '@/lib/db';
import { NextResponse } from 'next/server';

/**
 * Liveness/readiness for load balancers and EC2 health checks.
 * Unauthenticated on purpose — do not put secrets here.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: 'up' });
  } catch {
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 });
  }
}
