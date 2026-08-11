import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const sequence = await prisma.sequence.findUnique({
    where: { id },
    include: {
      institution: true,
      contact: true,
      owner: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: 'asc' }, include: { events: true } },
      drafts: { orderBy: { createdAt: 'desc' }, include: { agentRuns: true } },
      replies: { orderBy: { createdAt: 'desc' } },
      agentRuns: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!sequence) return fail('Sequence not found', 404);
  if (sequence.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  return ok({ sequence });
});

const patchSchema = z.object({
  status: z.enum(['ACTIVE', 'STOPPED', 'COMPLETED']).optional(),
  followUpDays: z.number().int().min(1).max(30).optional(),
  maxFollowUps: z.number().int().min(0).max(3).optional(),
  nextActionAt: z.string().datetime().nullable().optional(),
  stoppedReason: z.string().optional(),
});

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const sequence = await prisma.sequence.findUnique({ where: { id } });
  if (!sequence) return fail('Sequence not found', 404);
  if (sequence.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  const body = patchSchema.parse(await req.json());

  const updated = await prisma.sequence.update({
    where: { id },
    data: {
      ...(body.status ? { status: body.status } : {}),
      ...(body.followUpDays !== undefined ? { followUpDays: body.followUpDays } : {}),
      ...(body.maxFollowUps !== undefined ? { maxFollowUps: body.maxFollowUps } : {}),
      ...(body.stoppedReason ? { stoppedReason: body.stoppedReason } : {}),
      ...(body.nextActionAt !== undefined
        ? { nextActionAt: body.nextActionAt ? new Date(body.nextActionAt) : null }
        : {}),
      // Stopping a sequence must also cancel the pending follow-up.
      ...(body.status === 'STOPPED' ? { nextActionAt: null } : {}),
    },
  });

  await audit(user.id, 'SEQUENCE_UPDATED', 'Sequence', id, body);
  return ok({ sequence: updated });
});
