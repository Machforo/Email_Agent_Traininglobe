import { z } from 'zod';
import { handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const GET = handler(async () => {
  const user = await requireUser();
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
    prisma.notification.count({ where: { userId: user.id, read: false } }),
  ]);
  return ok({ notifications, unread });
});

const schema = z.object({ id: z.string().optional(), all: z.boolean().optional() });

export const PATCH = handler(async (req: Request) => {
  const user = await requireUser();
  const body = schema.parse(await req.json().catch(() => ({})));

  if (body.all) {
    await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
  } else if (body.id) {
    // Scope by userId so one member can't mark another's notifications read.
    await prisma.notification.updateMany({
      where: { id: body.id, userId: user.id },
      data: { read: true },
    });
  }
  return ok({ ok: true });
});
