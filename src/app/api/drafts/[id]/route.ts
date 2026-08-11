import { z } from 'zod';
import { fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const draft = await prisma.draft.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, signature: true, smtpEmail: true } },
      agentRuns: { orderBy: { createdAt: 'asc' } },
      sequence: {
        include: {
          institution: true,
          contact: true,
          messages: { orderBy: { createdAt: 'asc' } },
          replies: { orderBy: { createdAt: 'desc' } },
        },
      },
    },
  });

  if (!draft) return fail('Draft not found', 404);
  if (draft.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  const caseStudies = draft.attachCaseStudyIds
    ? await prisma.caseStudy.findMany({
        where: { id: { in: draft.attachCaseStudyIds.split(',').filter(Boolean) } },
      })
    : [];

  return ok({ draft, caseStudies });
});

const patchSchema = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  attachCaseStudyIds: z.array(z.string()).optional(),
});

/** Save the reviewer's edits. The AI original stays on the row so we can diff it later. */
export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const draft = await prisma.draft.findUnique({ where: { id } });
  if (!draft) return fail('Draft not found', 404);
  if (draft.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);
  if (draft.status === 'SENT') return fail('This draft has already been sent.', 409);

  const body = patchSchema.parse(await req.json());

  const updated = await prisma.draft.update({
    where: { id },
    data: {
      ...(body.subject !== undefined ? { subject: body.subject } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.attachCaseStudyIds !== undefined
        ? { attachCaseStudyIds: body.attachCaseStudyIds.join(',') || null }
        : {}),
    },
  });

  return ok({ draft: updated });
});
