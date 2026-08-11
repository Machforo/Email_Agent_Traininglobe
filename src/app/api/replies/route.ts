import { handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const all = user.role === 'ADMIN' && url.searchParams.get('scope') === 'all';
  const handled = url.searchParams.get('handled');

  const replies = await prisma.reply.findMany({
    where: {
      ...(all ? {} : { sequence: { ownerId: user.id } }),
      ...(handled === null ? {} : { handled: handled === 'true' }),
    },
    include: {
      emailMessage: true,
      sequence: {
        include: {
          institution: { select: { id: true, name: true } },
          contact: true,
          owner: { select: { id: true, name: true } },
          drafts: {
            where: { kind: 'REPLY', status: { in: ['NEEDS_APPROVAL', 'GENERATING'] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return ok({ replies });
});
