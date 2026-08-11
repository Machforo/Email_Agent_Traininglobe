import { fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { toView } from '@/lib/jobs/queue';

/**
 * Job status, polled by the UI while the worker does the slow work.
 *
 * Deliberately cheap: a single indexed lookup, no joins. The client hits this every
 * couple of seconds for minutes at a time.
 */
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return fail('Job not found', 404);
  if (job.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  return ok({ job: toView(job) });
});
