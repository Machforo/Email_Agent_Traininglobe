import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  stage: z.enum(['INITIAL', 'FOLLOWUP_1', 'FOLLOWUP_2', 'FOLLOWUP_3', 'REPLY']).optional(),
  subject: z.string().min(1).optional(),
  body: z.string().min(10).optional(),
  guidance: z.string().nullable().optional(),
  isShared: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const existing = await prisma.template.findUnique({ where: { id } });
  if (!existing) return fail('Template not found', 404);
  if (existing.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  const body = patchSchema.parse(await req.json());
  const template = await prisma.template.update({ where: { id }, data: body });
  await audit(user.id, 'TEMPLATE_UPDATED', 'Template', id);
  return ok({ template });
});

export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const existing = await prisma.template.findUnique({ where: { id } });
  if (!existing) return fail('Template not found', 404);
  if (existing.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  await prisma.template.delete({ where: { id } });
  await audit(user.id, 'TEMPLATE_DELETED', 'Template', id, { name: existing.name });
  return ok({ ok: true });
});
