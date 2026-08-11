import { prisma } from './db';
import { pct } from './utils';

/**
 * Outreach statistics.
 *
 * `ownerId` scopes everything to one team member; passing null gives the org-wide
 * view the admin console uses. All rates are computed against sent volume so the
 * member view and the admin roll-up are directly comparable.
 */

export type Stats = {
  scope: string;
  sent: number;
  delivered: number;
  bounced: number;
  hardBounced: number;
  opened: number;
  clicked: number;
  replied: number;
  positiveReplies: number;
  negativeReplies: number;
  meetingsRequested: number;
  institutions: number;
  activeSequences: number;
  pendingApproval: number;
  followUpsInFlight: number;
  completed: number;
  unsubscribed: number;
  rates: {
    delivery: number;
    bounce: number;
    open: number;
    click: number;
    reply: number;
    positive: number;
  };
  avgResponseHours: number | null;
  byStage: { stage: string; sent: number; replied: number; replyRate: number }[];
  timeline: { date: string; sent: number; replies: number; opens: number }[];
  sequenceStatus: { status: string; count: number }[];
};

const STAGE_LABELS = ['Initial', 'Follow-up 1', 'Follow-up 2', 'Follow-up 3'];

export async function getStats(ownerId: string | null, days = 30): Promise<Stats> {
  const ownerWhere = ownerId ? { ownerId } : {};
  const since = new Date(Date.now() - days * 86_400_000);

  // Message-level activity is scoped to the selected window so the numbers agree with
  // the "last N days" label and the timeline chart. Sequence and institution counts
  // stay unfiltered — those describe the current state of the pipeline, not activity.
  const [outbound, inbound, replies, sequences, institutions, suppressions] = await Promise.all([
    prisma.emailMessage.findMany({
      where: { ...ownerWhere, direction: 'OUT', createdAt: { gte: since } },
      select: {
        id: true,
        stage: true,
        status: true,
        sentAt: true,
        openedAt: true,
        clickCount: true,
        bounceType: true,
        sequenceId: true,
      },
    }),
    prisma.emailMessage.findMany({
      where: { ...ownerWhere, direction: 'IN', createdAt: { gte: since } },
      select: { id: true, sequenceId: true, receivedAt: true },
    }),
    prisma.reply.findMany({
      where: {
        ...(ownerId ? { sequence: { ownerId } } : {}),
        createdAt: { gte: since },
      },
      select: { sentiment: true, intent: true, sequenceId: true, createdAt: true },
    }),
    prisma.sequence.findMany({
      where: ownerWhere,
      select: { id: true, status: true, currentStage: true, nextActionAt: true },
    }),
    prisma.institution.count({ where: ownerWhere }),
    prisma.suppression.count(),
  ]);

  const sent = outbound.length;
  const bounced = outbound.filter((m) => m.status === 'BOUNCED').length;
  const hardBounced = outbound.filter((m) => m.bounceType === 'HARD').length;
  const delivered = sent - bounced;
  const opened = outbound.filter((m) => m.openedAt).length;
  const clicked = outbound.filter((m) => m.clickCount > 0).length;

  // A sequence counts as "replied" once, not once per inbound mail.
  const repliedSequenceIds = new Set(inbound.map((m) => m.sequenceId));
  const replied = repliedSequenceIds.size;

  const positiveReplies = replies.filter((r) => r.sentiment === 'POSITIVE').length;
  const negativeReplies = replies.filter((r) => r.sentiment === 'NEGATIVE').length;
  const meetingsRequested = replies.filter((r) => r.intent === 'MEETING_REQUEST').length;

  const activeSequences = sequences.filter((s) => s.status === 'ACTIVE').length;
  const pendingApproval = sequences.filter((s) => s.status === 'PENDING_APPROVAL').length;
  const completed = sequences.filter((s) => s.status === 'COMPLETED').length;
  const followUpsInFlight = sequences.filter(
    (s) => s.status === 'ACTIVE' && s.nextActionAt !== null && s.currentStage > 0,
  ).length;

  /* Average time from our send to their reply. */
  const firstSentBySequence = new Map<string, Date>();
  for (const m of outbound) {
    if (!m.sentAt) continue;
    const cur = firstSentBySequence.get(m.sequenceId);
    if (!cur || m.sentAt < cur) firstSentBySequence.set(m.sequenceId, m.sentAt);
  }
  const gaps: number[] = [];
  for (const m of inbound) {
    const sentAt = firstSentBySequence.get(m.sequenceId);
    if (sentAt && m.receivedAt) {
      const h = (m.receivedAt.getTime() - sentAt.getTime()) / 3_600_000;
      if (h > 0) gaps.push(h);
    }
  }
  const avgResponseHours = gaps.length
    ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10
    : null;

  /* Per-stage effectiveness: which touch actually earns replies. */
  const byStage = STAGE_LABELS.map((label, stage) => {
    const stageMsgs = outbound.filter((m) => m.stage === stage);
    const stageSeqs = new Set(stageMsgs.map((m) => m.sequenceId));
    const stageReplies = [...stageSeqs].filter((id) => repliedSequenceIds.has(id)).length;
    return {
      stage: label,
      sent: stageMsgs.length,
      replied: stageReplies,
      replyRate: pct(stageReplies, stageMsgs.length),
    };
  }).filter((s) => s.sent > 0 || s.stage === 'Initial');

  /* Daily timeline for the chart. */
  const timeline: { date: string; sent: number; replies: number; opens: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    timeline.push({
      date: key,
      sent: outbound.filter((m) => m.sentAt && sameDay(m.sentAt, key)).length,
      replies: inbound.filter((m) => m.receivedAt && sameDay(m.receivedAt, key)).length,
      opens: outbound.filter((m) => m.openedAt && sameDay(m.openedAt, key)).length,
    });
  }

  const statusCounts = new Map<string, number>();
  for (const s of sequences) statusCounts.set(s.status, (statusCounts.get(s.status) ?? 0) + 1);

  return {
    scope: ownerId ? 'user' : 'org',
    sent,
    delivered,
    bounced,
    hardBounced,
    opened,
    clicked,
    replied,
    positiveReplies,
    negativeReplies,
    meetingsRequested,
    institutions,
    activeSequences,
    pendingApproval,
    followUpsInFlight,
    completed,
    unsubscribed: suppressions,
    rates: {
      delivery: pct(delivered, sent),
      bounce: pct(bounced, sent),
      open: pct(opened, delivered),
      click: pct(clicked, delivered),
      reply: pct(replied, delivered),
      positive: pct(positiveReplies, delivered),
    },
    avgResponseHours,
    byStage,
    timeline: timeline.filter((_, i) => i >= timeline.length - days),
    sequenceStatus: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
  };

  function sameDay(d: Date, key: string) {
    return d.toISOString().slice(0, 10) === key;
  }
}

export type LeaderboardRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  institutions: number;
  sent: number;
  replied: number;
  bounced: number;
  positive: number;
  replyRate: number;
  pendingApproval: number;
  lastActivity: Date | null;
};

/** Per-member roll-up for the admin console. */
export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });

  const rows = await Promise.all(
    users.map(async (u) => {
      const [sent, bounced, institutions, pendingApproval, inbound, positive, last] =
        await Promise.all([
          prisma.emailMessage.count({ where: { ownerId: u.id, direction: 'OUT' } }),
          prisma.emailMessage.count({
            where: { ownerId: u.id, direction: 'OUT', status: 'BOUNCED' },
          }),
          prisma.institution.count({ where: { ownerId: u.id } }),
          prisma.draft.count({ where: { ownerId: u.id, status: 'NEEDS_APPROVAL' } }),
          prisma.emailMessage.findMany({
            where: { ownerId: u.id, direction: 'IN' },
            select: { sequenceId: true },
          }),
          prisma.reply.count({ where: { sequence: { ownerId: u.id }, sentiment: 'POSITIVE' } }),
          prisma.emailMessage.findFirst({
            where: { ownerId: u.id },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
        ]);

      const replied = new Set(inbound.map((m) => m.sequenceId)).size;
      const delivered = sent - bounced;

      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: u.active,
        institutions,
        sent,
        replied,
        bounced,
        positive,
        replyRate: pct(replied, delivered),
        pendingApproval,
        lastActivity: last?.createdAt ?? u.lastLoginAt,
      };
    }),
  );

  return rows;
}
