'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client';

export type JobView = {
  id: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  attempts: number;
  maxAttempts: number;
  error: string | null;
  result: { draftId?: string; messageId?: string; alreadySent?: boolean } | null;
  draftId: string | null;
  sequenceId: string | null;
  stage: string;
};

/**
 * Polls a background job until it settles.
 *
 * Work that used to block an HTTP request for minutes now runs on the worker, so the
 * UI follows along instead. Polling is deliberately slow-ish: these jobs take one to
 * six minutes, and hammering the endpoint every second would just burn serverless
 * invocations for no benefit.
 */
export function useJob(jobId: string | null, onDone?: (job: JobView) => void) {
  const [job, setJob] = useState<JobView | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const doneRef = useRef(false);
  // Held in a ref so a caller passing an inline arrow doesn't restart the poll loop.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setElapsed(0);
      doneRef.current = false;
      return;
    }

    doneRef.current = false;
    let cancelled = false;
    const started = Date.now();

    const tick = setInterval(() => {
      if (!cancelled) setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);

    async function poll() {
      if (cancelled || doneRef.current) return;
      try {
        const res = await api.get<{ job: JobView }>(`/api/jobs/${jobId}`);
        if (cancelled) return;
        setJob(res.job);
        if (res.job.status === 'DONE' || res.job.status === 'FAILED') {
          doneRef.current = true;
          onDoneRef.current?.(res.job);
        }
      } catch {
        /* transient — the next tick retries */
      }
    }

    poll();
    const timer = setInterval(poll, 2500);

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [jobId]);

  const reset = useCallback(() => {
    setJob(null);
    setElapsed(0);
    doneRef.current = false;
  }, []);

  return { job, elapsed, reset };
}

/** "1m 20s" — friendlier than a raw second count when waits run into minutes. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}
