import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { hashPassword, requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(['ADMIN', 'MEMBER']).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  dailySendLimit: z.number().int().min(1).max(500).optional(),
});

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = patchSchema.parse(await req.json());

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return fail('User not found', 404);

  // Don't let an admin lock the whole team out by demoting or disabling the last admin.
  if ((body.role === 'MEMBER' || body.active === false) && target.role === 'ADMIN') {
    const otherAdmins = await prisma.user.count({
      where: { role: 'ADMIN', active: true, id: { not: id } },
    });
    if (otherAdmins === 0) {
      return fail('This is the only active admin. Promote someone else first.', 400);
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.role ? { role: body.role } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.dailySendLimit ? { dailySendLimit: body.dailySendLimit } : {}),
      ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
    },
    select: { id: true, name: true, email: true, role: true, active: true, dailySendLimit: true },
  });

  await audit(admin.id, 'USER_UPDATED', 'User', id, {
    ...body,
    password: body.password ? '[changed]' : undefined,
  });
  return ok({ user });
});
