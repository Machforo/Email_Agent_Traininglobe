import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueue, toView } from '@/lib/jobs/queue';

const schema = z.object({
  templateId: z.string().nullable().optional(),
  caseStudyIds: z.array(z.string()).optional(),
});

/** Generate the next follow-up on demand, rather than waiting for the scheduler. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = schema.parse(await req.json().catch(() => ({})));

  const sequence = await prisma.sequence.findUnique({
    where: { id },
    include: { drafts: { where: { status: { in: ['NEEDS_APPROVAL', 'GENERATING'] } } } },
  });
  if (!sequence) return fail('Sequence not found', 404);
  if (sequence.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  if (sequence.drafts.length) {
    return fail('There is already a draft waiting for approval on this sequence.', 409);
  }
  if (sequence.currentStage > sequence.maxFollowUps) {
    return fail('This sequence has already used all its follow-ups.', 400);
  }
  if (['STOPPED', 'BOUNCED'].includes(sequence.status)) {
    return fail(`This sequence is ${sequence.status.toLowerCase()} and cannot continue.`, 400);
  }

  const job = await enqueue(
    'GENERATE_FOLLOWUP',
    sequence.ownerId,
    {
      sequenceId: id,
      stage: sequence.currentStage,
      templateId: body.templateId ?? null,
      caseStudyIds: body.caseStudyIds,
    },
    { sequenceId: id },
  );

  // Clear the scheduled slot so the worker's own scheduler doesn't queue it again.
  await prisma.sequence.update({ where: { id }, data: { nextActionAt: null } });

  await audit(user.id, 'FOLLOWUP_GENERATED', 'Sequence', id, { stage: sequence.currentStage });
  return ok({ job: toView(job) }, { status: 202 });
});
