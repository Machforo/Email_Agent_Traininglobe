import { handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'NEEDS_APPROVAL';
  const all = user.role === 'ADMIN' && url.searchParams.get('scope') === 'all';

  const drafts = await prisma.draft.findMany({
    where: {
      ...(all ? {} : { ownerId: user.id }),
      ...(status === 'ALL' ? {} : { status }),
    },
    include: {
      owner: { select: { id: true, name: true } },
      sequence: {
        include: {
          institution: { select: { id: true, name: true, city: true, website: true } },
          contact: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return ok({ drafts });
});
