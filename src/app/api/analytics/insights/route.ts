import { fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getStats } from '@/lib/analytics';
import { generateInsights } from '@/lib/ai/agents';

/** AI read of the numbers: what's working, what isn't, and what to change. */
export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? 'me';
  const isAdmin = user.role === 'ADMIN';
  const targetOwner = isAdmin && scope === 'all' ? null : user.id;

  const stats = await getStats(targetOwner, 30);

  if (stats.sent === 0) {
    return ok({
      insights: {
        headline: 'No mail has been sent yet, so there is nothing to analyse.',
        strengths: [],
        problems: [],
        recommendations: [
          {
            action: 'Add an institution and run your first outreach draft.',
            why: 'Insights need sent-mail data to work from.',
            expectedImpact: 'Stats appear here after your first few sends.',
          },
        ],
        benchmark: 'Not applicable yet.',
      },
      stats,
    });
  }

  try {
    const insights = await generateInsights(
      {
        sent: stats.sent,
        delivered: stats.delivered,
        bounced: stats.bounced,
        opened: stats.opened,
        clicked: stats.clicked,
        repliedConversations: stats.replied,
        positiveReplies: stats.positiveReplies,
        negativeReplies: stats.negativeReplies,
        meetingsRequested: stats.meetingsRequested,
        rates: stats.rates,
        avgResponseHours: stats.avgResponseHours,
        perStagePerformance: stats.byStage,
        institutionsInPipeline: stats.institutions,
        activeSequences: stats.activeSequences,
        unsubscribes: stats.unsubscribed,
      },
      targetOwner ? `Individual member: ${user.name}` : 'Whole team',
    );
    return ok({ insights, stats });
  } catch (err) {
    return fail(
      `Could not generate insights: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }
});
