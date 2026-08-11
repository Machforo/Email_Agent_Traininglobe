import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { runFollowUps, runHousekeeping, runInboxPoll } from '@/worker/jobs';

const schema = z.object({ job: z.enum(['inbox-poll', 'follow-ups', 'housekeeping']) });

/** Run a scheduled job on demand, so the team isn't waiting on the next cron tick. */
export const POST = handler(async (req: Request) => {
  const admin = await requireAdmin();
  const { job } = schema.parse(await req.json());

  const runner = { 'inbox-poll': runInboxPoll, 'follow-ups': runFollowUps, housekeeping: runHousekeeping }[job];

  try {
    const result = await runner();
    await audit(admin.id, 'JOB_RUN', 'Job', job, { processed: result.processed });
    return ok({ result });
  } catch (err) {
    return fail(`Job failed: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});
