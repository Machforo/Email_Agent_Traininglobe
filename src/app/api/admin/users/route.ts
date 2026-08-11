import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { hashPassword, requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
  dailySendLimit: z.number().int().min(1).max(500).optional(),
});

export const GET = handler(async () => {
  await requireAdmin();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      smtpEmail: true,
      smtpVerifiedAt: true,
      dailySendLimit: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { institutions: true, sequences: true, messages: true } },
    },
  });
  return ok({ users });
});

export const POST = handler(async (req: Request) => {
  const admin = await requireAdmin();
  const body = createSchema.parse(await req.json());
  const email = body.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return fail('A user with that email already exists', 409);

  const user = await prisma.user.create({
    data: {
      name: body.name.trim(),
      email,
      passwordHash: await hashPassword(body.password),
      role: body.role,
      ...(body.dailySendLimit ? { dailySendLimit: body.dailySendLimit } : {}),
    },
    select: { id: true, name: true, email: true, role: true, active: true },
  });

  await audit(admin.id, 'USER_CREATED', 'User', user.id, { email, role: body.role });
  return ok({ user }, { status: 201 });
});
