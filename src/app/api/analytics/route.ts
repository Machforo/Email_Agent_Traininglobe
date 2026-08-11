import { handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getLeaderboard, getStats } from '@/lib/analytics';

export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 30), 7), 90);
  const scope = url.searchParams.get('scope') ?? 'me';
  const userId = url.searchParams.get('userId');

  const isAdmin = user.role === 'ADMIN';
  // Only an admin may look beyond their own numbers.
  const targetOwner = isAdmin ? (scope === 'all' ? null : (userId ?? user.id)) : user.id;

  const stats = await getStats(targetOwner, days);
  const leaderboard = isAdmin ? await getLeaderboard() : undefined;

  return ok({ stats, leaderboard, isAdmin });
});
