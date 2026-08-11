import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

const schema = z.object({
  reason: z.string().max(2000).optional(),
  /** Regenerate immediately using the reason as extra guidance. */
  regenerate: z.boolean().optional(),
});

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = schema.parse(await req.json().catch(() => ({})));

  const draft = await prisma.draft.findUnique({ where: { id } });
  if (!draft) return fail('Draft not found', 404);
  if (draft.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);
  if (draft.status === 'SENT') return fail('This draft has already been sent.', 409);

  await prisma.draft.update({
    where: { id },
    data: { status: 'REJECTED', rejectedNote: body.reason ?? null },
  });

  // A rejection is the strongest signal we get — always remember why.
  if (body.reason?.trim()) {
    await prisma.feedback.create({
      data: {
        ownerId: draft.ownerId,
        draftId: id,
        agent: 'COMPOSE',
        type: 'REJECTION',
        note: body.reason.trim(),
        lesson: body.reason.trim(),
        originalText: draft.body.slice(0, 4000),
      },
    });
  }

  // Put the sequence back to a state the member can act on.
  const remaining = await prisma.draft.count({
    where: { sequenceId: draft.sequenceId, status: { in: ['NEEDS_APPROVAL', 'GENERATING'] } },
  });
  if (!remaining) {
    const sent = await prisma.emailMessage.count({
      where: { sequenceId: draft.sequenceId, direction: 'OUT' },
    });
    await prisma.sequence.update({
      where: { id: draft.sequenceId },
      data: { status: sent > 0 ? 'ACTIVE' : 'DRAFTING' },
    });
  }

  await audit(user.id, 'DRAFT_REJECTED', 'Draft', id, { reason: body.reason });
  return ok({ ok: true });
});
