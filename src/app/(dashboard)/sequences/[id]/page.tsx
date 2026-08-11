import {
  ArrowLeft,
  Building2,
  Eye,
  MousePointerClick,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Card, CardHeader, humanStatus, statusTone } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { relativeTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function SequenceDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const sequence = await prisma.sequence.findUnique({
    where: { id },
    include: {
      institution: true,
      contact: true,
      owner: { select: { name: true } },
      messages: { orderBy: { createdAt: 'asc' } },
      replies: { orderBy: { createdAt: 'desc' } },
      drafts: { where: { status: 'NEEDS_APPROVAL' }, select: { id: true } },
    },
  });

  if (!sequence) notFound();
  if (sequence.ownerId !== user.id && user.role !== 'ADMIN') notFound();

  const replyByMessage = new Map(sequence.replies.map((r) => [r.emailMessageId, r]));

  return (
    <>
      <div className="mb-5">
        <Link
          href="/sequences"
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <ArrowLeft size={14} /> Back to sequences
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
            <Building2 size={20} className="text-[var(--text-muted)]" />
            {sequence.institution.name}
          </h1>
          <p className="mt-1 text-[13.5px] text-[var(--text-muted)]">
            {sequence.contact.name ? `${sequence.contact.name} · ` : ''}
            {sequence.contact.email}
            {sequence.contact.title && ` · ${sequence.contact.title}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(sequence.status)}>{humanStatus(sequence.status)}</Badge>
          {sequence.contact.verified ? (
            <Badge tone="success">Contact verified</Badge>
          ) : (
            <Badge tone="warning">Contact unverified</Badge>
          )}
          {sequence.drafts.length > 0 && (
            <Link href="/approvals">
              <Button size="sm" variant="primary">
                Review pending draft
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Thread */}
        <Card>
          <CardHeader
            title="Conversation"
            subtitle={`${sequence.messages.length} message${sequence.messages.length === 1 ? '' : 's'}`}
          />
          {sequence.messages.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
              Nothing sent yet.
            </p>
          ) : (
            <ol className="space-y-4">
              {sequence.messages.map((m) => {
                const inbound = m.direction === 'IN';
                const reply = replyByMessage.get(m.id);
                return (
                  <li
                    key={m.id}
                    className={`rounded-lg border p-4 ${
                      inbound ? 'border-[var(--success)]/30 bg-[var(--success-soft)]/40' : 'bg-[var(--surface-2)]/40'
                    }`}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge tone={inbound ? 'success' : 'brand'}>
                        {inbound ? 'Reply received' : m.stage === 0 ? 'Initial' : `Follow-up ${m.stage}`}
                      </Badge>
                      {m.status === 'BOUNCED' && (
                        <Badge tone="danger">
                          <TriangleAlert size={10} /> {m.bounceType ?? 'Bounced'}
                        </Badge>
                      )}
                      <span className="text-[11.5px] text-[var(--text-subtle)]">
                        {relativeTime(m.sentAt ?? m.receivedAt ?? m.createdAt)}
                      </span>
                      {!inbound && (
                        <span className="ml-auto flex items-center gap-3 text-[11.5px] text-[var(--text-muted)]">
                          <span className="inline-flex items-center gap-1" title="Opens">
                            <Eye size={12} /> {m.openCount}
                          </span>
                          <span className="inline-flex items-center gap-1" title="Clicks">
                            <MousePointerClick size={12} /> {m.clickCount}
                          </span>
                        </span>
                      )}
                    </div>

                    <p className="text-[14px] font-medium">{m.subject}</p>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-[var(--text-muted)]">
                      {m.bodyText.split('\n---\n')[0]}
                    </p>

                    {m.bounceReason && (
                      <p className="mt-2 rounded bg-[var(--danger-soft)] p-2 text-[12px] text-[var(--danger)]">
                        {m.bounceReason}
                      </p>
                    )}

                    {reply && (
                      <div className="mt-3 rounded-lg border bg-[var(--surface)] p-3">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <span className="text-[12px] font-semibold">AI summary</span>
                          <Badge tone={statusTone(reply.sentiment)}>{reply.sentiment.toLowerCase()}</Badge>
                          <Badge tone="info">{humanStatus(reply.intent)}</Badge>
                        </div>
                        <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
                          {reply.summary}
                        </p>
                        {reply.suggestedAction && (
                          <p className="mt-1.5 text-[12.5px]">
                            <span className="font-medium">Suggested:</span> {reply.suggestedAction}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        {/* Side panel */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Sequence" />
            <dl className="space-y-2.5 text-[13px]">
              <Row label="Owner" value={sequence.owner.name} />
              <Row label="Stage" value={sequence.currentStage === 0 ? 'Initial' : `Follow-up ${sequence.currentStage}`} />
              <Row label="Follow-up gap" value={`${sequence.followUpDays} days`} />
              <Row label="Max follow-ups" value={String(sequence.maxFollowUps)} />
              <Row
                label="Next action"
                value={sequence.nextActionAt ? relativeTime(sequence.nextActionAt) : '—'}
              />
              {sequence.stoppedReason && <Row label="Stopped" value={sequence.stoppedReason} />}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Institution" />
            <dl className="space-y-2.5 text-[13px]">
              <Row label="Status" value={humanStatus(sequence.institution.status)} />
              {sequence.institution.city && <Row label="City" value={sequence.institution.city} />}
              {sequence.institution.type && <Row label="Type" value={sequence.institution.type} />}
              {sequence.institution.website && (
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">Website</dt>
                  <dd>
                    <a
                      href={sequence.institution.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--brand)] hover:underline"
                    >
                      Visit
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            {sequence.institution.notes && (
              <div className="mt-4 border-t pt-3">
                <p className="mb-1 text-[12px] font-semibold text-[var(--text-muted)]">Your notes</p>
                <p className="text-[13px] leading-relaxed">{sequence.institution.notes}</p>
              </div>
            )}
          </Card>

          {sequence.contact.verificationNotes && (
            <Card>
              <CardHeader title="Contact verification" />
              <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
                {sequence.contact.verificationNotes}
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
