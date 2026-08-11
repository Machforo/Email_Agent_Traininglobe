import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  website: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().optional(),
  type: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  status: z.string().optional(),
});

async function loadOwned(id: string, userId: string, isAdmin: boolean) {
  const institution = await prisma.institution.findUnique({
    where: { id },
    include: {
      contacts: true,
      owner: { select: { id: true, name: true, email: true } },
      sequences: {
        include: {
          contact: true,
          messages: { orderBy: { createdAt: 'asc' } },
          drafts: { orderBy: { createdAt: 'desc' } },
          replies: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!institution) return null;
  if (institution.ownerId !== userId && !isAdmin) return null;
  return institution;
}

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const institution = await loadOwned(id, user.id, user.role === 'ADMIN');
  if (!institution) return fail('Institution not found', 404);
  return ok({ institution });
});

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const existing = await prisma.institution.findUnique({ where: { id } });
  if (!existing) return fail('Institution not found', 404);
  if (existing.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  const body = patchSchema.parse(await req.json());
  const institution = await prisma.institution.update({ where: { id }, data: body });
  await audit(user.id, 'INSTITUTION_UPDATED', 'Institution', id, body);
  return ok({ institution });
});

export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const existing = await prisma.institution.findUnique({ where: { id } });
  if (!existing) return fail('Institution not found', 404);
  if (existing.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  await prisma.institution.delete({ where: { id } });
  await audit(user.id, 'INSTITUTION_DELETED', 'Institution', id, { name: existing.name });
  return ok({ ok: true });
});
