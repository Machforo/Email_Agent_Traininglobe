import { prisma } from '../db';
import type { Job } from '@/generated/prisma/client';

/**
 * The work queue.
 *
 * The web app runs on Vercel, where a request is killed long before the agent cascade
 * finishes (measured at 90-355 seconds against Groq's free tier, versus a 300-second
 * ceiling on Vercel's most generous plan). So the app never does slow or outward-facing
 * work itself — it enqueues, returns a job id, and polls. The single worker on Render
 * is the only thing that executes.
 */

export type JobType = 'GENERATE_DRAFT' | 'GENERATE_FOLLOWUP' | 'SEND_DRAFT' | 'PROCESS_REPLY';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export type JobPayloads = {
  GENERATE_DRAFT: {
    sequenceId: string;
    stage: number;
    templateId?: string | null;
    caseStudyIds?: string[];
    forceResearch?: boolean;
  };
  GENERATE_FOLLOWUP: {
    sequenceId: string;
    stage: number;
    templateId?: string | null;
    caseStudyIds?: string[];
  };
  SEND_DRAFT: {
    draftId: string;
    subject: string;
    body: string;
    attachCaseStudyIds?: string[];
    feedbackNote?: string;
    approvedById: string;
  };
  PROCESS_REPLY: { emailMessageId: string };
};

/** A job that has died mid-flight is reclaimed after this long. */
const STALE_LOCK_MS = 15 * 60 * 1000;

/** Backoff between attempts. Indexed by attempt number. */
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];

export async function enqueue<T extends JobType>(
  type: T,
  ownerId: string,
  payload: JobPayloads[T],
  opts: { sequenceId?: string; draftId?: string; maxAttempts?: number; delayMs?: number } = {},
): Promise<Job> {
  return prisma.job.create({
    data: {
      type,
      ownerId,
      payload: JSON.stringify(payload),
      sequenceId: opts.sequenceId ?? null,
      draftId: opts.draftId ?? null,
      maxAttempts: opts.maxAttempts ?? 3,
      runAfter: opts.delayMs ? new Date(Date.now() + opts.delayMs) : new Date(),
    },
  });
}

/**
 * Claim one job for execution.
 *
 * The update is guarded on `status: 'QUEUED'`, which makes the claim a
 * compare-and-swap: if another worker took the row between the read and the write, the
 * update matches nothing and we return null rather than running it twice. That matters
 * because double-running SEND_DRAFT would email a prospect twice.
 */
export async function claimNext(workerId: string): Promise<Job | null> {
  await reclaimStale();

  const candidate = await prisma.job.findFirst({
    where: { status: 'QUEUED', runAfter: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return null;

  const now = new Date();
  const claimed = await prisma.job.updateMany({
    where: { id: candidate.id, status: 'QUEUED' },
    data: {
      status: 'RUNNING',
      lockedAt: now,
      lockedBy: workerId,
      startedAt: candidate.startedAt ?? now,
      attempts: { increment: 1 },
    },
  });
  if (claimed.count === 0) return null;

  return prisma.job.findUnique({ where: { id: candidate.id } });
}

/** A worker that crashed leaves jobs RUNNING forever; put them back. */
async function reclaimStale() {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS);
  await prisma.job.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
    data: { status: 'QUEUED', lockedAt: null, lockedBy: null },
  });
}

export async function completeJob(id: string, result?: unknown) {
  await prisma.job.update({
    where: { id },
    data: {
      status: 'DONE',
      result: result === undefined ? null : JSON.stringify(result),
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      error: null,
    },
  });
}

/**
 * Record a failure. Retries with backoff until maxAttempts, then gives up and leaves
 * the job FAILED so the UI can show the reason rather than spinning forever.
 */
export async function failJob(id: string, error: unknown) {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return;

  const message = (error instanceof Error ? error.message : String(error)).slice(0, 900);
  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    await prisma.job.update({
      where: { id },
      data: { status: 'FAILED', error: message, finishedAt: new Date(), lockedAt: null, lockedBy: null },
    });
    return;
  }

  const delay = RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? 60_000;
  await prisma.job.update({
    where: { id },
    data: {
      status: 'QUEUED',
      error: message,
      lockedAt: null,
      lockedBy: null,
      runAfter: new Date(Date.now() + delay),
    },
  });
}

export function parsePayload<T extends JobType>(job: Job): JobPayloads[T] {
  return JSON.parse(job.payload) as JobPayloads[T];
}

/** What the UI polls. Deliberately small. */
export type JobView = {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  result: unknown;
  draftId: string | null;
  sequenceId: string | null;
  createdAt: Date;
  /** Human-readable progress line for the spinner. */
  stage: string;
};

export function toView(job: Job): JobView {
  let result: unknown = null;
  try {
    result = job.result ? JSON.parse(job.result) : null;
  } catch {
    result = null;
  }
  return {
    id: job.id,
    type: job.type,
    status: job.status as JobStatus,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    error: job.error,
    result,
    draftId: job.draftId,
    sequenceId: job.sequenceId,
    createdAt: job.createdAt,
    stage: describe(job),
  };
}

function describe(job: Job): string {
  if (job.status === 'DONE') return 'Finished';
  if (job.status === 'FAILED') return 'Failed';
  if (job.status === 'QUEUED') {
    if (job.attempts > 0) return `Retrying (attempt ${job.attempts + 1} of ${job.maxAttempts})`;
    return 'Waiting for the worker';
  }
  switch (job.type) {
    case 'GENERATE_DRAFT':
    case 'GENERATE_FOLLOWUP':
      return 'Researching, writing and fact-checking';
    case 'SEND_DRAFT':
      return 'Sending';
    case 'PROCESS_REPLY':
      return 'Analysing the reply';
    default:
      return 'Working';
  }
}
