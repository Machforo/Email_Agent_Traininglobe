import { prisma } from '@/lib/db';
import { groqKeyCount, WORKER_HEARTBEAT_KEY } from '@/lib/env';
import { NextResponse } from 'next/server';

const WORKER_STALE_MS = 90_000;

/**
 * Liveness for EC2 / nginx. Unauthenticated — no secrets.
 * `worker: "down"` means the AI process is not heartbeating; drafts will stall.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ ok: false, db: 'down', worker: 'unknown' }, { status: 503 });
  }

  const row = await prisma.systemSetting.findUnique({ where: { key: WORKER_HEARTBEAT_KEY } });
  const beatAt = row?.value ? Date.parse(row.value) : NaN;
  const ageMs = Number.isFinite(beatAt) ? Date.now() - beatAt : null;
  const worker = ageMs !== null && ageMs < WORKER_STALE_MS ? 'up' : 'down';

  return NextResponse.json({
    ok: true,
    db: 'up',
    worker,
    workerAgeMs: ageMs,
    groqKeys: groqKeyCount() > 0,
  });
}
