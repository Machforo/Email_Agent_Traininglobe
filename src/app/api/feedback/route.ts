import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

const schema = z.object({
  lesson: z.string().min(5).max(500),
  agent: z.string().default('COMPOSE'),
  /** Admin-only: apply this rule to everyone's drafts, not just mine. */
  global: z.boolean().optional(),
});

/** The rules the agents are currently following, newest first. */
export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const all = user.role === 'ADMIN' && new URL(req.url).searchParams.get('scope') === 'all';

  const feedback = await prisma.feedback.findMany({
    where: all ? {} : { OR: [{ ownerId: user.id }, { global: true }] },
    include: { owner: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return ok({ feedback });
});

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const body = schema.parse(await req.json());

  if (body.global && user.role !== 'ADMIN') {
    return fail('Only an admin can add a team-wide rule.', 403);
  }

  const feedback = await prisma.feedback.create({
    data: {
      ownerId: user.id,
      agent: body.agent,
      type: 'NOTE',
      note: body.lesson,
      lesson: body.lesson,
      global: body.global ?? false,
    },
  });

  await audit(user.id, 'FEEDBACK_ADDED', 'Feedback', feedback.id);
  return ok({ feedback }, { status: 201 });
});

const patchSchema = z.object({ id: z.string(), active: z.boolean() });

export const PATCH = handler(async (req: Request) => {
  const user = await requireUser();
  const body = patchSchema.parse(await req.json());

  const existing = await prisma.feedback.findUnique({ where: { id: body.id } });
  if (!existing) return fail('Feedback not found', 404);
  if (existing.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  const feedback = await prisma.feedback.update({
    where: { id: body.id },
    data: { active: body.active },
  });
  return ok({ feedback });
});
