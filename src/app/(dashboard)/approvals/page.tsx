'use client';

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Eye,
  FlaskConical,
  Link2,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/Shell';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Textarea,
  humanStatus,
  statusTone,
} from '@/components/ui';
import { JobProgress } from '@/components/JobProgress';
import { api, errorMessage } from '@/lib/client';
import { useJob } from '@/lib/useJob';
import { cn, relativeTime, truncate } from '@/lib/utils';

type Verification = {
  verdict: 'PASS' | 'REVISE' | 'BLOCK';
  confidence: number;
  checks: { claim: string; status: string; evidence?: string; source?: string }[];
  corrections: { issue: string; severity: string; fix: string }[];
  contactVerified: boolean;
  contactNotes: string;
  sources: string[];
};

type Research = {
  overview: string;
  gaps: { gap: string; evidence: string; whyItExists: string; impact: string }[];
  solutions: { forGap: string; solution: string; proofPoint: string }[];
  personalizationHooks: string[];
  recentDevelopments: string[];
  sources: string[];
  confidence: number;
};

type AgentRun = {
  id: string;
  agent: string;
  model: string;
  status: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
};

type Draft = {
  id: string;
  kind: string;
  stage: number;
  status: string;
  subject: string;
  body: string;
  aiSubject: string | null;
  aiBody: string | null;
  confidence: number;
  revisionCount: number;
  researchSummary: string | null;
  verificationJson: string | null;
  attachCaseStudyIds: string | null;
  error: string | null;
  createdAt: string;
  agentRuns?: AgentRun[];
  sequence: {
    id: string;
    institution: { id: string; name: string; website: string | null; city: string | null };
    contact: { id: string; name: string | null; email: string; title: string | null; verified: boolean };
    messages?: { id: string; direction: string; subject: string; bodyText: string; sentAt: string | null }[];
  };
};

function ApprovalsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(params.get('draft'));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ drafts: Draft[] }>('/api/drafts?status=NEEDS_APPROVAL');
      setDrafts(res.drafts);
      setSelectedId((cur) => cur ?? res.drafts[0]?.id ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Every mail stops here. Read the verification report, edit if needed, then approve to send."
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

      {drafts === null ? (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : drafts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 size={34} />}
            title="Nothing waiting for approval"
            description="When you start outreach on a prospect, or a follow-up comes due, the draft will appear here for review."
            action={<Button variant="primary" onClick={() => router.push('/prospects')}>Go to prospects</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[330px_1fr]">
          {/* Queue */}
          <div className="space-y-2">
            {drafts.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={cn(
                  'w-full rounded-[var(--radius)] border p-3.5 text-left transition-colors',
                  selectedId === d.id
                    ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                    : 'bg-[var(--surface)] hover:bg-[var(--surface-2)]',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-[14px] font-medium">{d.sequence.institution.name}</p>
                  <Badge tone={d.kind === 'REPLY' ? 'success' : 'brand'}>
                    {d.kind === 'REPLY' ? 'Reply' : d.stage === 0 ? 'Initial' : `FU${d.stage}`}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-[12.5px] text-[var(--text-muted)]">
                  {d.sequence.contact.email}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone={d.confidence >= 70 ? 'success' : d.confidence >= 45 ? 'warning' : 'danger'}>
                    {d.confidence}% verified
                  </Badge>
                  <span className="text-[11px] text-[var(--text-subtle)]">
                    {relativeTime(d.createdAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {selectedId && (
            <DraftReview
              key={selectedId}
              draftId={selectedId}
              onDone={() => {
                setSelectedId(null);
                load();
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------ Review panel ------------------------------ */

function DraftReview({ draftId, onDone }: { draftId: string; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [caseStudies, setCaseStudies] = useState<{ id: string; title: string }[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [tab, setTab] = useState<'mail' | 'verification' | 'research' | 'trace'>('mail');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  // Sending and regenerating both run on the worker; watch the job and refresh the
  // queue once it settles.
  const { job, elapsed } = useJob(jobId, (finished) => {
    if (finished.status === 'DONE') setTimeout(onDone, 900);
  });

  useEffect(() => {
    api
      .get<{ draft: Draft; caseStudies: { id: string; title: string }[] }>(`/api/drafts/${draftId}`)
      .then((r) => {
        setDraft(r.draft);
        setSubject(r.draft.subject);
        setBody(r.draft.body);
        setCaseStudies(r.caseStudies);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [draftId]);

  const verification = useMemo<Verification | null>(() => {
    if (!draft?.verificationJson) return null;
    try {
      return JSON.parse(draft.verificationJson) as Verification;
    } catch {
      return null;
    }
  }, [draft]);

  const research = useMemo<Research | null>(() => {
    if (!draft?.researchSummary) return null;
    try {
      return JSON.parse(draft.researchSummary) as Research;
    } catch {
      return null;
    }
  }, [draft]);

  const edited = draft ? subject !== draft.aiSubject || body !== draft.aiBody : false;

  async function approve() {
    setBusy('approve');
    setError(null);
    try {
      // The route validates credentials, suppression and the daily cap synchronously,
      // so a 4xx here is a real problem the reviewer can act on immediately. Only the
      // SMTP call itself is deferred to the worker.
      const res = await api.post<{ job: { id: string } }>(`/api/drafts/${draftId}/approve`, {
        subject,
        body,
        feedbackNote: feedbackNote || undefined,
      });
      setJobId(res.job.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  async function reject(reason: string) {
    setBusy('reject');
    try {
      await api.post(`/api/drafts/${draftId}/reject`, { reason });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  async function regenerate(guidance: string) {
    setBusy('regen');
    setError(null);
    try {
      const res = await api.post<{ job: { id: string } }>(`/api/drafts/${draftId}/regenerate`, {
        guidance: guidance || undefined,
      });
      setRegenOpen(false);
      setJobId(res.job.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  if (!draft) return <Skeleton className="h-[500px]" />;

  const blocked = verification?.verdict === 'BLOCK';
  const attached = draft.attachCaseStudyIds?.split(',').filter(Boolean) ?? [];

  // While a send or regenerate is in flight, the editor would be misleading — the
  // reviewer can no longer change what goes out.
  if (jobId) {
    const sending = job?.type === 'SEND_DRAFT';
    return (
      <Card>
        <h2 className="text-[16px] font-semibold">
          {sending ? 'Sending' : 'Regenerating'} · {draft.sequence.institution.name}
        </h2>
        <p className="mt-0.5 mb-4 text-[13px] text-[var(--text-muted)]">
          {sending ? draft.sequence.contact.email : 'Running the full cascade again.'}
        </p>

        <JobProgress job={job} elapsed={elapsed} />

        {job?.status === 'DONE' && sending && (
          <p className="mt-3 text-center text-[13px] text-[var(--text-muted)]">
            Sent. Follow-ups are scheduled automatically.
          </p>
        )}

        {(job?.status === 'FAILED' || job?.status === 'DONE') && (
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={onDone}>
              Back to the queue
            </Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card padded={false} className="overflow-hidden">
      {/* Header */}
      <div className="border-b p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold">{draft.sequence.institution.name}</h2>
            <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
              To {draft.sequence.contact.name ? `${draft.sequence.contact.name}, ` : ''}
              <span className="font-medium">{draft.sequence.contact.email}</span>
              {draft.sequence.contact.title && ` · ${draft.sequence.contact.title}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {verification && (
              <Badge tone={statusTone(verification.verdict)}>
                <ShieldCheck size={11} /> {verification.verdict}
              </Badge>
            )}
            <Badge tone={draft.confidence >= 70 ? 'success' : draft.confidence >= 45 ? 'warning' : 'danger'}>
              {draft.confidence}% confidence
            </Badge>
            {draft.revisionCount > 0 && (
              <Badge tone="info">
                {draft.revisionCount} auto-revision{draft.revisionCount > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-1 border-b-0">
          {(
            [
              ['mail', 'Email', <Send key="a" size={13} />],
              ['verification', `Verification${verification?.corrections.length ? ` (${verification.corrections.length})` : ''}`, <ShieldCheck key="b" size={13} />],
              ['research', 'Research', <Search key="c" size={13} />],
              ['trace', 'Agent trace', <Bot key="d" size={13} />],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                tab === key
                  ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
              )}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {error && (
          <div className="mb-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}

        {blocked && tab === 'mail' && (
          <div className="mb-4">
            <Alert tone="danger" title="The fact-checker blocked this draft">
              At least one claim was contradicted by sources, or the recipient could not be
              confirmed. Fix the issues on the Verification tab before sending.
            </Alert>
          </div>
        )}

        {tab === 'mail' && (
          <div className="space-y-4">
            <Field label="Subject">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label="Body" hint="Edit freely — your changes are what gets sent, and the AI learns from them.">
              <Textarea
                rows={16}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="font-[inherit] text-[14px] leading-[1.7]"
              />
            </Field>

            {attached.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <Paperclip size={14} className="text-[var(--text-muted)]" />
                {caseStudies
                  .filter((c) => attached.includes(c.id))
                  .map((c) => (
                    <Badge key={c.id} tone="info">
                      {c.title}
                    </Badge>
                  ))}
              </div>
            )}

            {edited && (
              <Alert tone="info">
                You&apos;ve edited the AI draft. On approval we work out what changed and turn it
                into a rule for future mails.
              </Alert>
            )}

            <Field label="Note for the AI (optional)" hint="Anything you want it to remember for next time.">
              <Input
                value={feedbackNote}
                onChange={(e) => setFeedbackNote(e.target.value)}
                placeholder="e.g. Don't mention pricing in the first mail"
              />
            </Field>
          </div>
        )}

        {tab === 'verification' && (
          <VerificationPanel verification={verification} contact={draft.sequence.contact} />
        )}

        {tab === 'research' && <ResearchPanel research={research} />}

        {tab === 'trace' && <TracePanel runs={draft.agentRuns ?? []} />}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-[var(--surface-2)]/50 p-4">
        <div className="flex gap-2">
          <Button onClick={() => setRejectOpen(true)} disabled={Boolean(busy)}>
            <Trash2 size={14} /> Reject
          </Button>
          <Button onClick={() => setRegenOpen(true)} disabled={Boolean(busy)}>
            {busy === 'regen' ? <Spinner /> : <RefreshCw size={14} />} Regenerate
          </Button>
        </div>
        <Button
          variant={blocked ? 'danger' : 'success'}
          onClick={approve}
          disabled={Boolean(busy) || !subject.trim() || !body.trim()}
        >
          {busy === 'approve' ? (
            <>
              <Spinner /> Sending…
            </>
          ) : (
            <>
              <Send size={15} /> {blocked ? 'Approve anyway and send' : 'Approve and send'}
            </>
          )}
        </Button>
      </div>

      <RejectModal open={rejectOpen} onClose={() => setRejectOpen(false)} onSubmit={reject} />
      <RegenerateModal open={regenOpen} onClose={() => setRegenOpen(false)} onSubmit={regenerate} />
    </Card>
  );
}

/* ---------------------------- Verification panel --------------------------- */

function VerificationPanel({
  verification,
  contact,
}: {
  verification: Verification | null;
  contact: { name: string | null; email: string; title: string | null };
}) {
  if (!verification) {
    return <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">No verification report available.</p>;
  }

  return (
    <div className="space-y-5">
      <div
        className={cn(
          'rounded-lg p-4',
          verification.contactVerified ? 'bg-[var(--success-soft)]' : 'bg-[var(--warning-soft)]',
        )}
      >
        <p
          className={cn(
            'flex items-center gap-1.5 text-[13.5px] font-semibold',
            verification.contactVerified ? 'text-[var(--success)]' : 'text-[var(--warning)]',
          )}
        >
          {verification.contactVerified ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          Recipient {verification.contactVerified ? 'confirmed' : 'not confirmed'}
        </p>
        <p className="mt-1 text-[13px] opacity-90">
          {verification.contactNotes || `Checked ${contact.name ?? contact.email} against public sources.`}
        </p>
      </div>

      {verification.corrections.length > 0 && (
        <div>
          <h4 className="mb-2 text-[13px] font-semibold">Issues found</h4>
          <ul className="space-y-2">
            {verification.corrections.map((c, i) => (
              <li key={i} className="rounded-lg border p-3">
                <div className="flex items-start gap-2">
                  <Badge tone={statusTone(c.severity)}>{c.severity}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">{c.issue}</p>
                    <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">
                      <span className="font-medium">Fix:</span> {c.fix}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {verification.checks.length > 0 && (
        <div>
          <h4 className="mb-2 text-[13px] font-semibold">Claims checked</h4>
          <ul className="space-y-1.5">
            {verification.checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-lg bg-[var(--surface-2)] p-2.5">
                <Badge tone={statusTone(c.status)}>{c.status.toLowerCase()}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px]">{c.claim}</p>
                  {c.evidence && (
                    <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{c.evidence}</p>
                  )}
                  {c.source && (
                    <a
                      href={c.source}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-[var(--brand)] hover:underline"
                    >
                      <Link2 size={10} /> {truncate(c.source.replace(/^https?:\/\//, ''), 50)}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {verification.sources.length > 0 && <SourceList sources={verification.sources} />}
    </div>
  );
}

function ResearchPanel({ research }: { research: Research | null }) {
  if (!research) {
    return <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">No research data available.</p>;
  }
  return (
    <div className="space-y-5">
      <div>
        <h4 className="mb-1.5 text-[13px] font-semibold">Overview</h4>
        <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">{research.overview}</p>
      </div>

      {research.gaps?.length > 0 && (
        <div>
          <h4 className="mb-2 text-[13px] font-semibold">Gaps identified</h4>
          <div className="space-y-2">
            {research.gaps.map((g, i) => (
              <div key={i} className="rounded-lg border p-3">
                <p className="text-[13.5px] font-medium">{g.gap}</p>
                <dl className="mt-1.5 space-y-1 text-[12.5px] text-[var(--text-muted)]">
                  <div><span className="font-medium">Evidence:</span> {g.evidence}</div>
                  <div><span className="font-medium">Why:</span> {g.whyItExists}</div>
                  <div><span className="font-medium">Impact:</span> {g.impact}</div>
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}

      {research.solutions?.length > 0 && (
        <div>
          <h4 className="mb-2 text-[13px] font-semibold">Proposed solutions</h4>
          <ul className="space-y-1.5">
            {research.solutions.map((s, i) => (
              <li key={i} className="rounded-lg bg-[var(--surface-2)] p-2.5 text-[13px]">
                <p className="font-medium">{s.solution}</p>
                <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{s.proofPoint}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {research.personalizationHooks?.length > 0 && (
        <div>
          <h4 className="mb-2 text-[13px] font-semibold">Personalisation hooks</h4>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-[var(--text-muted)]">
            {research.personalizationHooks.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {research.sources?.length > 0 && <SourceList sources={research.sources} />}
    </div>
  );
}

function SourceList({ sources }: { sources: string[] }) {
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
        <Eye size={13} /> Sources consulted ({sources.length})
      </h4>
      <ul className="space-y-1">
        {sources.map((s, i) => (
          <li key={i}>
            <a
              href={s}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-[var(--brand)] hover:underline"
            >
              <ExternalLink size={10} /> {truncate(s.replace(/^https?:\/\//, ''), 78)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TracePanel({ runs }: { runs: AgentRun[] }) {
  if (!runs.length) {
    return <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">No agent runs recorded.</p>;
  }
  const totalMs = runs.reduce((a, r) => a + r.latencyMs, 0);
  const totalTokens = runs.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0);

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-[var(--text-muted)]">
        {runs.length} agent calls · {(totalMs / 1000).toFixed(1)}s total ·{' '}
        {totalTokens.toLocaleString()} tokens
      </p>
      <ol className="space-y-2">
        {runs.map((r, i) => (
          <li key={r.id} className="flex items-start gap-3 rounded-lg border p-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[11px] font-semibold">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium">{humanStatus(r.agent)}</span>
                <Badge tone={r.status === 'OK' ? 'success' : 'danger'}>{r.status}</Badge>
                <code className="text-[11px] text-[var(--text-subtle)]">{r.model}</code>
              </div>
              <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                {(r.latencyMs / 1000).toFixed(1)}s · {r.tokensIn + r.tokensOut} tokens
              </p>
              {r.error && <p className="mt-1 text-[12px] text-[var(--danger)]">{r.error}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* --------------------------------- Modals --------------------------------- */

function RejectModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Reject this draft" subtitle="Tell the AI what was wrong so it doesn't repeat it.">
      <div className="space-y-4">
        <Field label="Why are you rejecting it?">
          <Textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Too salesy, and the opening claim about their placements isn't something we can back up."
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => onSubmit(reason)}>
            <X size={14} /> Reject draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RegenerateModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (guidance: string) => void;
}) {
  const [guidance, setGuidance] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Regenerate this draft"
      subtitle="Runs the whole cascade again — research, write, fact-check, revise."
    >
      <div className="space-y-4">
        {submitting ? (
          <div className="py-6 text-center">
            <Spinner size={26} className="mx-auto text-[var(--brand)]" />
            <p className="mt-3 text-[13.5px]">Running the agents again… 40–90 seconds.</p>
          </div>
        ) : (
          <>
            <Field label="What should be different?" hint="Saved as a standing instruction for your future drafts too.">
              <Textarea
                rows={4}
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                placeholder="Lead with their new AI programme instead of placements, and keep it under 120 words."
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setSubmitting(true);
                  onSubmit(guidance);
                }}
              >
                <FlaskConical size={14} /> Regenerate
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ApprovalsInner />
    </Suspense>
  );
}
