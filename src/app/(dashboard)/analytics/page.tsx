'use client';

import {
  Lightbulb,
  MousePointerClick,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ActivityChart, FunnelBars, StageChart, useChartColors } from '@/components/charts';
import { PageHeader } from '@/components/Shell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Select,
  Skeleton,
  Spinner,
  Stat,
  statusTone,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/client';

type Stats = {
  sent: number;
  delivered: number;
  bounced: number;
  opened: number;
  clicked: number;
  replied: number;
  positiveReplies: number;
  meetingsRequested: number;
  institutions: number;
  activeSequences: number;
  followUpsInFlight: number;
  unsubscribed: number;
  rates: { delivery: number; bounce: number; open: number; click: number; reply: number; positive: number };
  avgResponseHours: number | null;
  byStage: { stage: string; sent: number; replied: number; replyRate: number }[];
  timeline: { date: string; sent: number; replies: number; opens: number }[];
};

type Insights = {
  headline: string;
  strengths: string[];
  problems: { issue: string; evidence: string; severity: string }[];
  recommendations: { action: string; why: string; expectedImpact: string }[];
  benchmark: string;
};

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [days, setDays] = useState(30);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colors = useChartColors();

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ stats: Stats; isAdmin: boolean }>(
        `/api/analytics?scope=${scope}&days=${days}`,
      );
      setStats(res.stats);
      setIsAdmin(res.isAdmin);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [scope, days]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadInsights() {
    setLoadingInsights(true);
    setError(null);
    try {
      const res = await api.get<{ insights: Insights }>(`/api/analytics/insights?scope=${scope}`);
      setInsights(res.insights);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingInsights(false);
    }
  }

  if (!stats) {
    return (
      <>
        <PageHeader title="Analytics" />
        <div className="grid gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="How your outreach is actually performing, and what to change."
        action={
          <>
            {isAdmin && (
              <Select value={scope} onChange={(e) => setScope(e.target.value as 'me' | 'all')} className="w-auto">
                <option value="me">My numbers</option>
                <option value="all">Whole team</option>
              </Select>
            )}
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-auto">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </Select>
            <Button onClick={load}>
              <RefreshCw size={15} />
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Sent" value={stats.sent} sub={`${stats.delivered} delivered`} icon={<Send size={18} />} />
        <Stat
          label="Open rate"
          value={`${stats.rates.open}%`}
          sub={`benchmark 35–50%`}
          tone={stats.rates.open >= 35 ? 'success' : 'warning'}
        />
        <Stat
          label="Reply rate"
          value={`${stats.rates.reply}%`}
          sub={`benchmark 5–12%`}
          tone={stats.rates.reply >= 5 ? 'success' : 'warning'}
        />
        <Stat
          label="Bounce rate"
          value={`${stats.rates.bounce}%`}
          sub={stats.rates.bounce > 3 ? 'above the 3% safe line' : 'healthy'}
          tone={stats.rates.bounce > 3 ? 'danger' : 'success'}
          icon={<TriangleAlert size={18} />}
        />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Activity" subtitle={`Sends, opens and replies over the last ${days} days.`} />
          <ActivityChart data={stats.timeline} />
        </Card>

        <Card>
          <CardHeader title="Funnel" subtitle="Where conversations drop off." />
          <FunnelBars
            steps={[
              { label: 'Sent', value: stats.sent, tone: colors.sent },
              { label: 'Delivered', value: stats.delivered, tone: colors.sent },
              { label: 'Opened', value: stats.opened, tone: colors.opens },
              { label: 'Clicked', value: stats.clicked, tone: colors.opens },
              { label: 'Replied', value: stats.replied, tone: colors.replies },
              { label: 'Positive', value: stats.positiveReplies, tone: colors.replies },
            ]}
          />
          <dl className="mt-5 space-y-2 border-t pt-4 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Meetings requested</dt>
              <dd className="font-semibold">{stats.meetingsRequested}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Avg. time to reply</dt>
              <dd className="font-semibold">
                {stats.avgResponseHours === null
                  ? '—'
                  : stats.avgResponseHours < 48
                    ? `${stats.avgResponseHours}h`
                    : `${Math.round(stats.avgResponseHours / 24)}d`}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Unsubscribes</dt>
              <dd className="font-semibold">{stats.unsubscribed}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Which touch earns the reply"
            subtitle="Most replies land on follow-up 1 or 2, not the first mail."
          />
          <StageChart data={stats.byStage} />
        </Card>

        <Card>
          <CardHeader title="Pipeline health" />
          <div className="grid grid-cols-2 gap-4">
            {[
              ['Institutions', stats.institutions],
              ['Active sequences', stats.activeSequences],
              ['Follow-ups running', stats.followUpsInFlight],
              ['Clicked a link', stats.clicked],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-[var(--surface-2)] p-3.5">
                <p className="text-[12px] text-[var(--text-muted)]">{label as string}</p>
                <p className="mt-1 text-[22px] font-semibold">{value as number}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--surface-2)] p-3.5 text-[13px]">
            <MousePointerClick size={15} className="text-[var(--text-muted)]" />
            <span className="text-[var(--text-muted)]">Click-through rate</span>
            <span className="ml-auto font-semibold">{stats.rates.click}%</span>
          </div>
        </Card>
      </div>

      {/* AI insights */}
      <Card>
        <CardHeader
          title="AI insights"
          subtitle="An analyst read of your numbers, with specific changes to make."
          action={
            <Button variant="primary" onClick={loadInsights} disabled={loadingInsights}>
              {loadingInsights ? <Spinner /> : <Sparkles size={15} />}
              {insights ? 'Regenerate' : 'Analyse my performance'}
            </Button>
          }
        />

        {!insights && !loadingInsights && (
          <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
            Run an analysis to get a read on what&apos;s working and what to change.
          </p>
        )}

        {loadingInsights && (
          <div className="py-10 text-center">
            <Spinner size={26} className="mx-auto text-[var(--brand)]" />
            <p className="mt-3 text-[13px] text-[var(--text-muted)]">Analysing your outreach…</p>
          </div>
        )}

        {insights && !loadingInsights && (
          <div className="space-y-5">
            <div className="rounded-lg bg-[var(--brand-soft)] p-4">
              <p className="flex items-start gap-2 text-[14px] font-medium text-[var(--brand)]">
                <TrendingUp size={16} className="mt-0.5 shrink-0" />
                {insights.headline}
              </p>
              {insights.benchmark && (
                <p className="mt-1.5 pl-6 text-[13px] text-[var(--brand)]/80">{insights.benchmark}</p>
              )}
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {insights.strengths.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[13px] font-semibold">What&apos;s working</h4>
                  <ul className="space-y-1.5">
                    {insights.strengths.map((s, i) => (
                      <li key={i} className="flex gap-2 text-[13px] text-[var(--text-muted)]">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {insights.problems.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[13px] font-semibold">Problems</h4>
                  <ul className="space-y-2">
                    {insights.problems.map((p, i) => (
                      <li key={i} className="rounded-lg border p-2.5">
                        <div className="flex items-start gap-2">
                          <Badge tone={statusTone(p.severity)}>{p.severity}</Badge>
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium">{p.issue}</p>
                            <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{p.evidence}</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {insights.recommendations.length > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                  <Lightbulb size={14} /> What to change
                </h4>
                <ol className="space-y-2">
                  {insights.recommendations.map((r, i) => (
                    <li key={i} className="flex gap-3 rounded-lg border p-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[11px] font-semibold text-white">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium">{r.action}</p>
                        <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{r.why}</p>
                        <p className="mt-1 text-[12.5px] text-[var(--success)]">
                          Expected: {r.expectedImpact}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
