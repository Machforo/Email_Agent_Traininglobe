'use client';

import { Eye, MousePointerClick, Send, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/Shell';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  humanStatus,
  statusTone,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import { relativeTime } from '@/lib/utils';

type Sequence = {
  id: string;
  status: string;
  currentStage: number;
  maxFollowUps: number;
  nextActionAt: string | null;
  updatedAt: string;
  institution: { id: string; name: string; city: string | null };
  contact: { email: string; name: string | null };
  messages: {
    id: string;
    direction: string;
    stage: number;
    sentAt: string | null;
    openedAt: string | null;
    openCount: number;
    clickCount: number;
    status: string;
  }[];
  replies: { sentiment: string }[];
  drafts: { id: string; status: string }[];
};

const STATUSES = ['ACTIVE', 'PENDING_APPROVAL', 'REPLIED', 'COMPLETED', 'STOPPED', 'BOUNCED'];

export default function SequencesPage() {
  const [sequences, setSequences] = useState<Sequence[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ sequences: Sequence[] }>(
        `/api/sequences${status ? `?status=${status}` : ''}`,
      );
      setSequences(res.sequences);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Sequences"
        subtitle="Every conversation in flight, and where each one is in the follow-up ladder."
      />

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <Card padded={false}>
        <div className="border-b p-4">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanStatus(s)}
              </option>
            ))}
          </Select>
        </div>

        {sequences === null ? (
          <div className="space-y-3 p-5">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : sequences.length === 0 ? (
          <EmptyState
            icon={<Workflow size={32} />}
            title="No sequences yet"
            description="Start outreach from the Prospects page and the conversation will appear here."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Institution</Th>
                <Th>Contact</Th>
                <Th>Status</Th>
                <Th>Progress</Th>
                <Th>Engagement</Th>
                <Th>Next action</Th>
              </tr>
            </thead>
            <tbody>
              {sequences.map((s) => {
                const sent = s.messages.filter((m) => m.direction === 'OUT');
                const opens = sent.reduce((a, m) => a + m.openCount, 0);
                const clicks = sent.reduce((a, m) => a + m.clickCount, 0);
                return (
                  <tr key={s.id} className="hover:bg-[var(--surface-2)]/60">
                    <Td>
                      <Link href={`/sequences/${s.id}`} className="font-medium hover:underline">
                        {s.institution.name}
                      </Link>
                      {s.institution.city && (
                        <div className="text-[12px] text-[var(--text-muted)]">{s.institution.city}</div>
                      )}
                    </Td>
                    <Td className="text-[13px]">
                      <div>{s.contact.name ?? '—'}</div>
                      <div className="text-[12px] text-[var(--text-muted)]">{s.contact.email}</div>
                    </Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={statusTone(s.status)}>{humanStatus(s.status)}</Badge>
                        {s.replies[0] && (
                          <Badge tone={statusTone(s.replies[0].sentiment)}>
                            {s.replies[0].sentiment.toLowerCase()} reply
                          </Badge>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        {[0, 1, 2, 3].slice(0, s.maxFollowUps + 1).map((stage) => {
                          const done = sent.some((m) => m.stage === stage);
                          return (
                            <span
                              key={stage}
                              title={stage === 0 ? 'Initial' : `Follow-up ${stage}`}
                              className={`h-2 w-6 rounded-full ${
                                done ? 'bg-[var(--brand)]' : 'bg-[var(--border-strong)]'
                              }`}
                            />
                          );
                        })}
                      </div>
                      <div className="mt-1 text-[11.5px] text-[var(--text-muted)]">
                        {sent.length} sent
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-3 text-[12.5px] text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-1" title="Opens">
                          <Eye size={13} /> {opens}
                        </span>
                        <span className="inline-flex items-center gap-1" title="Clicks">
                          <MousePointerClick size={13} /> {clicks}
                        </span>
                        {s.messages.some((m) => m.direction === 'IN') && (
                          <span className="inline-flex items-center gap-1 text-[var(--success)]" title="Replied">
                            <Send size={13} /> replied
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td className="text-[12.5px] whitespace-nowrap text-[var(--text-muted)]">
                      {s.drafts.length > 0 ? (
                        <Link href="/approvals" className="text-[var(--warning)] hover:underline">
                          Awaiting approval
                        </Link>
                      ) : s.nextActionAt ? (
                        `Follow-up ${relativeTime(s.nextActionAt)}`
                      ) : (
                        '—'
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
