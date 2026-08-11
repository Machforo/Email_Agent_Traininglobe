'use client';

import { Inbox, MessageSquare, RefreshCw, Send } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/Shell';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  Skeleton,
  humanStatus,
  statusTone,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import { relativeTime, truncate } from '@/lib/utils';

type Reply = {
  id: string;
  summary: string;
  keyPoints: string | null;
  sentiment: string;
  intent: string;
  urgency: string;
  suggestedAction: string | null;
  handled: boolean;
  createdAt: string;
  emailMessage: { subject: string; bodyText: string; fromEmail: string; receivedAt: string | null };
  sequence: {
    id: string;
    institution: { id: string; name: string };
    contact: { name: string | null; email: string };
    drafts: { id: string; status: string }[];
  };
};

export default function InboxPage() {
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [filter, setFilter] = useState('false');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ replies: Reply[] }>(
        `/api/replies${filter === 'all' ? '' : `?handled=${filter}`}`,
      );
      setReplies(res.replies);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Replies"
        subtitle="When someone replies, the AI summarises it, stops the follow-ups, and drafts a response for your approval."
        action={
          <Button onClick={load}>
            <RefreshCw size={15} /> Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="mb-4">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
          <option value="false">Needs attention</option>
          <option value="true">Handled</option>
          <option value="all">All replies</option>
        </Select>
      </div>

      {replies === null ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : replies.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox size={32} />}
            title="No replies here"
            description="The worker checks your mailbox every few minutes. Replies land here automatically, already summarised."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {replies.map((r) => {
            const keyPoints: string[] = (() => {
              try {
                return r.keyPoints ? JSON.parse(r.keyPoints) : [];
              } catch {
                return [];
              }
            })();
            const pendingDraft = r.sequence.drafts[0];
            const open = expanded === r.id;

            return (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/sequences/${r.sequence.id}`}
                        className="text-[15px] font-semibold hover:underline"
                      >
                        {r.sequence.institution.name}
                      </Link>
                      <Badge tone={statusTone(r.sentiment)}>{r.sentiment.toLowerCase()}</Badge>
                      <Badge tone="info">{humanStatus(r.intent)}</Badge>
                      {r.urgency === 'HIGH' && <Badge tone="danger">Urgent</Badge>}
                      {r.handled && <Badge tone="neutral">Handled</Badge>}
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                      {r.sequence.contact.name ?? r.emailMessage.fromEmail} ·{' '}
                      {relativeTime(r.emailMessage.receivedAt ?? r.createdAt)}
                    </p>
                  </div>

                  {pendingDraft && (
                    <Link href={`/approvals?draft=${pendingDraft.id}`}>
                      <Button size="sm" variant="primary">
                        <Send size={13} /> Review AI response
                      </Button>
                    </Link>
                  )}
                </div>

                <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3.5">
                  <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-muted)]">
                    <MessageSquare size={12} /> AI summary
                  </p>
                  <p className="text-[13.5px] leading-relaxed">{r.summary}</p>

                  {keyPoints.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-[var(--text-muted)]">
                      {keyPoints.map((k, i) => (
                        <li key={i}>{k}</li>
                      ))}
                    </ul>
                  )}

                  {r.suggestedAction && (
                    <p className="mt-2 text-[13px]">
                      <span className="font-medium">Suggested next step:</span> {r.suggestedAction}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => setExpanded(open ? null : r.id)}
                  className="mt-3 text-[12.5px] font-medium text-[var(--brand)] hover:underline"
                >
                  {open ? 'Hide original message' : 'Show original message'}
                </button>

                {open && (
                  <div className="mt-2 rounded-lg border p-3.5">
                    <p className="text-[13px] font-medium">{r.emailMessage.subject}</p>
                    <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--text-muted)]">
                      {truncate(r.emailMessage.bodyText, 3000)}
                    </p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
