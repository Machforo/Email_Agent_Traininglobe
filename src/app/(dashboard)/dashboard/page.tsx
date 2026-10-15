import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Inbox,
  MailCheck,
  MousePointerClick,
  Send,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/Shell';
import { Badge, Button, Card, CardHeader, EmptyState, Stat, statusTone } from '@/components/ui';
import { getStats } from '@/lib/analytics';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { relativeTime, truncate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const user = await requireUser();
  const stats = await getStats(user.id, 30);

  const [pendingDrafts, recentReplies, dueSoon] = await Promise.all([
    prisma.draft.findMany({
      where: { ownerId: user.id, status: 'NEEDS_APPROVAL' },
      include: { sequence: { include: { institution: true, contact: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.reply.findMany({
      where: { sequence: { ownerId: user.id } },
      include: { sequence: { include: { institution: true, contact: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.sequence.findMany({
      where: { ownerId: user.id, status: 'ACTIVE', nextActionAt: { not: null } },
      include: { institution: true, contact: true },
      orderBy: { nextActionAt: 'asc' },
      take: 5,
    }),
  ]);

  const firstName = user.name.split(' ')[0];

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        subtitle="Your outreach at a glance — last 30 days."
        action={
          <Link href="/prospects">
            <Button variant="primary">
              <Building2 size={15} /> Add prospect
            </Button>
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Mails sent"
          value={stats.sent}
          sub={`${stats.delivered} delivered`}
          icon={<Send size={18} />}
        />
        <Stat
          label="Open rate"
          value={`${stats.rates.open}%`}
          sub={`${stats.opened} opened`}
          tone="info"
          icon={<MailCheck size={18} />}
        />
        <Stat
          label="Reply rate"
          value={`${stats.rates.reply}%`}
          sub={`${stats.replied} conversations`}
          tone="success"
          icon={<Inbox size={18} />}
        />
        <Stat
          label="Bounced"
          value={stats.bounced}
          sub={`${stats.rates.bounce}% of sends`}
          tone={stats.rates.bounce > 3 ? 'danger' : 'neutral'}
          icon={<TriangleAlert size={18} />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Awaiting approval */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Waiting for your approval"
            subtitle="Nothing is sent until you approve it."
            action={
              pendingDrafts.length > 0 ? (
                <Link href="/approvals">
                  <Button size="sm">
                    Review all <ArrowRight size={14} />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          {pendingDrafts.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={30} />}
              title="All clear"
              description="No drafts are waiting. Start outreach on a prospect to generate one."
              action={
                <Link href="/prospects">
                  <Button size="sm" variant="primary">
                    Go to prospects
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y">
              {pendingDrafts.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/approvals?draft=${d.id}`}
                    className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-[var(--surface-2)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[14px] font-medium">
                          {d.sequence.institution.name}
                        </p>
                        <Badge tone={d.kind === 'REPLY' ? 'success' : 'brand'}>
                          {d.kind === 'REPLY'
                            ? 'Reply'
                            : d.stage === 0
                              ? 'Initial'
                              : `Follow-up ${d.stage}`}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-muted)]">
                        {truncate(d.subject, 70) || 'No subject yet'}
                      </p>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <Badge
                        tone={
                          d.confidence >= 70 ? 'success' : d.confidence >= 45 ? 'warning' : 'danger'
                        }
                      >
                        {d.confidence}% verified
                      </Badge>
                      <p className="mt-1 text-[11px] text-[var(--text-subtle)]">
                        {relativeTime(d.createdAt)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Follow-ups due */}
        <Card>
          <CardHeader title="Follow-ups scheduled" subtitle="Generated automatically when due." />
          {dueSoon.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
              No follow-ups scheduled.
            </p>
          ) : (
            <ul className="space-y-3">
              {dueSoon.map((s) => (
                <li key={s.id} className="flex items-start gap-2.5">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/sequences/${s.id}`}
                      className="block truncate text-[13.5px] font-medium hover:underline"
                    >
                      {s.institution.name}
                    </Link>
                    <p className="text-[12px] text-[var(--text-muted)]">
                      Follow-up {s.currentStage} · {relativeTime(s.nextActionAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent replies */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent replies"
            subtitle="Summarised by the AI, with a response drafted for you."
            action={
              recentReplies.length > 0 ? (
                <Link href="/inbox">
                  <Button size="sm">
                    Open inbox <ArrowRight size={14} />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          {recentReplies.length === 0 ? (
            <EmptyState
              icon={<Inbox size={30} />}
              title="No replies yet"
              description="When a prospect replies, it will be summarised here and a response prepared for your approval."
            />
          ) : (
            <ul className="divide-y">
              {recentReplies.map((r) => (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/sequences/${r.sequenceId}`}
                        className="text-[14px] font-medium hover:underline"
                      >
                        {r.sequence.institution.name}
                      </Link>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                        {truncate(r.summary, 130)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={statusTone(r.sentiment)}>{r.sentiment.toLowerCase()}</Badge>
                      <span className="text-[11px] text-[var(--text-subtle)]">
                        {relativeTime(r.createdAt)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Pipeline */}
        <Card>
          <CardHeader title="Pipeline" />
          <dl className="space-y-3 text-[13.5px]">
            {[
              ['Institutions', stats.institutions, <Building2 key="i" size={15} />],
              ['Active sequences', stats.activeSequences, <Send key="s" size={15} />],
              ['Follow-ups running', stats.followUpsInFlight, <ArrowRight key="f" size={15} />],
              ['Clicked a link', stats.clicked, <MousePointerClick key="c" size={15} />],
              ['Meetings requested', stats.meetingsRequested, <CheckCircle2 key="m" size={15} />],
            ].map(([label, value, icon]) => (
              <div key={String(label)} className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-[var(--text-muted)]">
                  {icon as React.ReactNode}
                  {label as string}
                </dt>
                <dd className="font-semibold">{value as number}</dd>
              </div>
            ))}
          </dl>
          {stats.avgResponseHours !== null && (
            <p className="mt-4 border-t pt-3 text-[12px] text-[var(--text-muted)]">
              Average time to first reply:{' '}
              <span className="font-medium text-[var(--text)]">
                {stats.avgResponseHours < 48
                  ? `${stats.avgResponseHours}h`
                  : `${Math.round(stats.avgResponseHours / 24)}d`}
              </span>
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
