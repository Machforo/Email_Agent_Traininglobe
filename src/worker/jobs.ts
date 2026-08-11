import { prisma } from '../lib/db';
import { pollAllMailboxes } from '../lib/email/imap';
import { enqueue } from '../lib/jobs/queue';

/**
 * Scheduled work: chase the follow-ups that are due, and look for replies.
 *
 * Nothing here decides to contact someone new. It only advances sequences a human
 * already started, and by default it still stops at the approval step.
 */

export type JobResult = { name: string; processed: number; errors: string[]; detail?: string };

/**
 * Generate follow-ups whose wait period has elapsed.
 *
 * A sequence becomes due `followUpDays` after the previous send. If auto-send is off
 * (the default) the draft lands in the member's approval queue instead of going out.
 */
export async function runFollowUps(): Promise<JobResult> {
  const result: JobResult = { name: 'follow-ups', processed: 0, errors: [] };

  const due = await prisma.sequence.findMany({
    where: {
      status: 'ACTIVE',
      nextActionAt: { lte: new Date() },
    },
    include: {
      owner: true,
      contact: true,
      institution: { select: { name: true } },
      drafts: { where: { status: { in: ['NEEDS_APPROVAL', 'GENERATING'] } }, select: { id: true } },
    },
    take: 25,
  });

  // Job.sequenceId is a denormalised column rather than a relation, so fetch the
  // in-flight ones separately instead of via `include`.
  const inFlight = await prisma.job.findMany({
    where: {
      status: { in: ['QUEUED', 'RUNNING'] },
      sequenceId: { in: due.map((s) => s.id) },
    },
    select: { sequenceId: true },
  });
  const busy = new Set(inFlight.map((j) => j.sequenceId));

  for (const seq of due) {
    try {
      // Don't stack drafts on a sequence the member hasn't dealt with yet, and don't
      // enqueue a second job for one already in the queue.
      if (seq.drafts.length || busy.has(seq.id)) continue;

      if (seq.currentStage > seq.maxFollowUps) {
        await prisma.sequence.update({
          where: { id: seq.id },
          data: { status: 'COMPLETED', nextActionAt: null },
        });
        continue;
      }

      // Never chase someone who opted out or bounced since the last send.
      const suppressed = await prisma.suppression.findUnique({
        where: { email: seq.contact.email.toLowerCase() },
      });
      if (suppressed) {
        await prisma.sequence.update({
          where: { id: seq.id },
          data: {
            status: 'STOPPED',
            nextActionAt: null,
            stoppedReason: `Recipient suppressed (${suppressed.reason})`,
          },
        });
        continue;
      }

      if (!isWithinSendWindow(seq.owner.sendWindowStart, seq.owner.sendWindowEnd)) {
        continue; // try again on a later tick, inside business hours
      }

      // Hand the actual generation to the queue rather than doing it here: it takes
      // minutes, and blocking the scheduler would delay every other due sequence.
      await enqueue(
        'GENERATE_FOLLOWUP',
        seq.ownerId,
        { sequenceId: seq.id, stage: seq.currentStage },
        { sequenceId: seq.id },
      );

      // Clear the due flag now so the next tick doesn't enqueue it again. The send
      // path resets nextActionAt once the follow-up actually goes out.
      await prisma.sequence.update({
        where: { id: seq.id },
        data: { nextActionAt: null },
      });

      result.processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${seq.id}: ${message}`);
      // Push the retry out a few hours so one bad sequence doesn't spin every tick.
      await prisma.sequence.update({
        where: { id: seq.id },
        data: { nextActionAt: new Date(Date.now() + 4 * 3_600_000) },
      });
    }
  }

  return result;
}

/** Check every mailbox for replies and bounces. */
export async function runInboxPoll(): Promise<JobResult> {
  const result: JobResult = { name: 'inbox-poll', processed: 0, errors: [] };
  try {
    const summaries = await pollAllMailboxes();
    for (const s of summaries) {
      result.processed += s.replies + s.bounces;
      for (const e of s.errors) result.errors.push(`${s.userId}: ${e}`);
    }
    result.detail = summaries
      .map((s) => `${s.userId.slice(0, 6)}: scanned ${s.scanned}, ${s.replies} replies, ${s.bounces} bounces`)
      .join(' | ');
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }
  return result;
}

/** Close out sequences that have exhausted their follow-ups. */
export async function runHousekeeping(): Promise<JobResult> {
  const result: JobResult = { name: 'housekeeping', processed: 0, errors: [] };
  try {
    const stale = await prisma.sequence.updateMany({
      where: {
        status: 'ACTIVE',
        nextActionAt: null,
        currentStage: { gt: 3 },
      },
      data: { status: 'COMPLETED' },
    });
    result.processed = stale.count;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }
  return result;
}

/**
 * Business-hours guard. Mail sent at 3am reads as automated, and Gmail is more
 * likely to treat a burst outside working hours as spam.
 */
export function isWithinSendWindow(startHour: number, endHour: number, now = new Date()): boolean {
  const hour = now.getHours();
  const day = now.getDay();
  if (day === 0 || day === 6) return false; // skip weekends
  return hour >= startHour && hour < endHour;
}
