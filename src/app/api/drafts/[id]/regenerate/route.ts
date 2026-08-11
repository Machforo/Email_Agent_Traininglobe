import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueue, toView } from '@/lib/jobs/queue';

const schema = z.object({
  guidance: z.string().max(2000).optional(),
  templateId: z.string().nullable().optional(),
  forceResearch: z.boolean().optional(),
});

/**
 * Throw the draft away and run the cascade again. Any guidance the reviewer types is
 * stored as feedback first, so the new attempt actually sees it.
 */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = schema.parse(await req.json().catch(() => ({})));

  const draft = await prisma.draft.findUnique({ where: { id } });
  if (!draft) return fail('Draft not found', 404);
  if (draft.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);
  if (draft.status === 'SENT') return fail('This draft has already been sent.', 409);

  if (body.guidance?.trim()) {
    await prisma.feedback.create({
      data: {
        ownerId: draft.ownerId,
        draftId: id,
        agent: 'COMPOSE',
        type: 'NOTE',
        note: body.guidance.trim(),
        lesson: body.guidance.trim(),
      },
    });
  }

  await prisma.draft.update({ where: { id }, data: { status: 'REJECTED' } });

  // Same reasoning as the initial draft: the cascade is far too slow for a request.
  const job = await enqueue(
    'GENERATE_DRAFT',
    draft.ownerId,
    {
      sequenceId: draft.sequenceId,
      stage: draft.stage,
      templateId: body.templateId ?? draft.templateId,
      caseStudyIds: draft.attachCaseStudyIds?.split(',').filter(Boolean),
      forceResearch: body.forceResearch,
    },
    { sequenceId: draft.sequenceId },
  );

  await audit(user.id, 'DRAFT_REGENERATED', 'Draft', id, { jobId: job.id });
  return ok({ job: toView(job) }, { status: 202 });
});
