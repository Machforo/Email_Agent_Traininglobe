'use client';

import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Alert, Spinner } from '@/components/ui';
import { formatElapsed, type JobView } from '@/lib/useJob';

/**
 * Live state of a background job.
 *
 * These waits are long (one to six minutes on Groq's free tier), so the component
 * always shows what is happening and how long it has been going — a bare spinner for
 * five minutes reads as a hang.
 */
export function JobProgress({
  job,
  elapsed,
  queuedHint,
}: {
  job: JobView | null;
  elapsed: number;
  queuedHint?: string;
}) {
  if (!job) {
    return (
      <div className="py-8 text-center">
        <Spinner size={26} className="mx-auto text-[var(--brand)]" />
        <p className="mt-3 text-[13.5px] font-medium">Queueing…</p>
      </div>
    );
  }

  if (job.status === 'FAILED') {
    return (
      <Alert tone="danger" title="That didn't work">
        {job.error ?? 'The job failed without an error message.'}
        {job.attempts > 1 && (
          <span className="mt-1 block opacity-80">
            Tried {job.attempts} times before giving up.
          </span>
        )}
      </Alert>
    );
  }

  if (job.status === 'DONE') {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-[var(--success-soft)] px-3.5 py-3 text-[13.5px] text-[var(--success)]">
        <CheckCircle2 size={16} />
        Finished in {formatElapsed(elapsed)}.
      </div>
    );
  }

  const queued = job.status === 'QUEUED';

  return (
    <div className="py-6 text-center">
      {queued ? (
        <Clock size={26} className="mx-auto text-[var(--text-muted)]" />
      ) : (
        <Spinner size={26} className="mx-auto text-[var(--brand)]" />
      )}

      <p className="mt-3 text-[14px] font-medium">{job.stage}</p>

      <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">
        {queued
          ? (queuedHint ?? 'Waiting for the worker to pick this up.')
          : 'Researching the institution, writing, fact-checking every claim, then revising.'}
      </p>

      <p className="mt-2 text-[12px] text-[var(--text-subtle)]">
        {formatElapsed(elapsed)} elapsed
        {elapsed > 100 && ' · free-tier rate limits make this slow, not stuck'}
      </p>

      {job.attempts > 1 && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[12px] text-[var(--warning)]">
          <AlertTriangle size={12} />
          Retrying after a failure (attempt {job.attempts} of {job.maxAttempts})
        </p>
      )}

      <p className="mt-3 text-[12px] text-[var(--text-subtle)]">
        Safe to close this — it keeps running, and you&apos;ll get a notification.
      </p>
    </div>
  );
}
