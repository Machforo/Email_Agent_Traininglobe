import 'dotenv/config';
import cron from 'node-cron';
import { prisma } from '../lib/db';
import { runFollowUps, runHousekeeping, runInboxPoll, type JobResult } from './jobs';
import { drainQueue } from './runner';

/**
 * Background worker. Runs as its own process alongside the Next.js app:
 *
 *   npm run worker
 *
 * Kept separate because Next.js route handlers are request-scoped and would not
 * reliably hold a long-lived IMAP connection or a cron timer.
 */

const POLL_CRON = process.env.WORKER_POLL_CRON ?? '*/5 * * * *';
const FOLLOWUP_CRON = process.env.WORKER_FOLLOWUP_CRON ?? '*/10 * * * *';
/** How often to look for queued work while busy. Short — users watch a spinner. */
const QUEUE_INTERVAL_MS = Number(process.env.WORKER_QUEUE_INTERVAL_MS ?? 3_000);
/**
 * Ceiling once the queue has been empty for a while. 30s is the worst case a user
 * waits before their job is picked up, which is invisible next to a 2-6 minute job.
 */
const QUEUE_MAX_INTERVAL_MS = Number(process.env.WORKER_QUEUE_MAX_INTERVAL_MS ?? 30_000);

let draining = false;

function log(...args: unknown[]) {
  console.log(`[worker ${new Date().toISOString()}]`, ...args);
}

function report(result: JobResult) {
  const bits = [`${result.name}: ${result.processed} processed`];
  if (result.detail) bits.push(result.detail);
  if (result.errors.length) bits.push(`${result.errors.length} error(s)`);
  log(bits.join(' | '));
  for (const e of result.errors.slice(0, 5)) log('  !', e);
}

/**
 * Prevents a scheduled task from overlapping *itself* — an inbox poll that runs long
 * must not have a second one started on top of it.
 *
 * The guard is per task, not global. A single shared flag starved the follow-up
 * scheduler completely: inbox-poll (every 5 min) and follow-ups (every 10 min) fire on
 * the same tick every time follow-ups is due, and because inbox-poll is registered
 * first it always won the flag. Follow-ups then only ever ran once, at startup.
 */
const inFlight = new Set<string>();

async function guarded(name: string, fn: () => Promise<JobResult>) {
  if (inFlight.has(name)) {
    log(`${name} skipped — previous ${name} cycle still running`);
    return;
  }
  inFlight.add(name);
  try {
    report(await fn());
  } catch (err) {
    log(`${name} crashed:`, err);
  } finally {
    inFlight.delete(name);
  }
}

async function main() {
  log('starting');

  const users = await prisma.user.count();
  const withCreds = await prisma.user.count({ where: { smtpPasswordEnc: { not: null } } });
  log(`${users} user(s), ${withCreds} with sending credentials configured`);

  cron.schedule(POLL_CRON, () => void guarded('inbox-poll', runInboxPoll));
  cron.schedule(FOLLOWUP_CRON, () => void guarded('follow-ups', runFollowUps));
  cron.schedule('0 * * * *', () => void guarded('housekeeping', runHousekeeping));

  /*
   * The queue loop is separate from the cron guard on purpose. Draft generation takes
   * minutes, and a user is sitting in front of a spinner waiting for it — it must not
   * be blocked behind an inbox poll, nor block one.
   *
   * It also backs off when there is nothing to do. A fixed 3-second poll means ~28,000
   * queries a day against an idle queue, which on a serverless Postgres (Neon's free
   * tier, for instance) keeps compute permanently awake and burns the monthly
   * allowance for no benefit. Busy stays responsive; idle goes quiet.
   */
  let idleDelay = QUEUE_INTERVAL_MS;

  const loop = async () => {
    if (draining) return schedule(idleDelay);
    draining = true;
    try {
      const before = idleDelay;
      const r = await drainQueue();
      if (r.processed || r.failed) {
        log(`queue: ${r.processed} done, ${r.failed} failed`);
        idleDelay = QUEUE_INTERVAL_MS; // work is arriving — stay responsive
      } else {
        idleDelay = Math.min(idleDelay * 2, QUEUE_MAX_INTERVAL_MS);
      }
      if (idleDelay !== before) log(`queue poll interval ${before}ms → ${idleDelay}ms`);
    } catch (err) {
      log('queue error:', err);
      idleDelay = Math.min(idleDelay * 2, QUEUE_MAX_INTERVAL_MS);
    } finally {
      draining = false;
      schedule(idleDelay);
    }
  };

  const schedule = (ms: number) => {
    setTimeout(() => void loop(), ms);
  };

  schedule(0);

  log(
    `queue ${QUEUE_INTERVAL_MS / 1000}s→${QUEUE_MAX_INTERVAL_MS / 1000}s (backs off when idle) | ` +
      `inbox poll "${POLL_CRON}" | follow-ups "${FOLLOWUP_CRON}" | housekeeping hourly`,
  );

  // Do one pass at startup so a restart doesn't leave overdue work sitting.
  await guarded('follow-ups', runFollowUps);
}

async function shutdown(signal: string) {
  log(`${signal} received, shutting down`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

/*
 * Last-resort guards. A long-running worker must not die because one network socket
 * misbehaved — an IMAP socket timeout surfacing as an unhandled 'error' event took the
 * whole process down once. Log it and keep the schedule alive; the next tick retries.
 */
process.on('uncaughtException', (err) => {
  log('uncaught exception (worker continues):', err);
  inFlight.clear();
});

process.on('unhandledRejection', (reason) => {
  log('unhandled rejection (worker continues):', reason);
  inFlight.clear();
});

main().catch(async (err) => {
  log('fatal:', err);
  await prisma.$disconnect();
  process.exit(1);
});
