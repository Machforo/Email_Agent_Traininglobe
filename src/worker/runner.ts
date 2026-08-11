import { runJob } from '../lib/jobs/handlers';
import { claimNext, completeJob, failJob } from '../lib/jobs/queue';

/**
 * Drains the job queue.
 *
 * Jobs run one at a time on purpose. Each one makes several LLM calls that share a
 * strict per-model token budget, so running two concurrently just means both spend
 * their time waiting on the rate limiter. Serial is simpler and no slower in practice.
 */

const WORKER_ID = `${process.pid}@${new Date().toISOString()}`;

export type DrainResult = { processed: number; failed: number; errors: string[] };

export async function drainQueue(maxJobs = 5): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, failed: 0, errors: [] };

  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNext(WORKER_ID);
    if (!job) break;

    const started = Date.now();
    try {
      const output = await runJob(job);
      await completeJob(job.id, output);
      result.processed++;
      console.log(
        `[job] ${job.type} ${job.id} done in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failJob(job.id, err);
      result.failed++;
      result.errors.push(`${job.type} ${job.id}: ${message}`);
      console.error(
        `[job] ${job.type} ${job.id} failed on attempt ${job.attempts}/${job.maxAttempts}: ${message}`,
      );
    }
  }

  return result;
}
