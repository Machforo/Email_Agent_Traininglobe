'use client';

import { Mail, Lock, ArrowRight } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/client';

/** Only same-origin relative paths — blocks //evil.com open redirects. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      // Full reload so the server layout picks up the new session cookie.
      window.location.assign(safeNext(params.get('next')));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="Work email" required>
        <div className="relative">
          <Mail
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-subtle)]"
          />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@traininglobe.com"
            className="pl-9"
            required
            autoFocus
            autoComplete="username"
          />
        </div>
      </Field>

      <Field label="Password" required>
        <div className="relative">
          <Lock
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-subtle)]"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="pl-9"
            required
            autoComplete="current-password"
          />
        </div>
      </Field>

      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? <Spinner /> : <>Sign in <ArrowRight size={16} /></>}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--brand)] text-white shadow-[var(--shadow)]">
            <Mail size={22} />
          </div>
          <h1 className="text-xl font-semibold">Outreach Agent</h1>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Sign in to your Traininglobe workspace
          </p>
        </div>

        <div className="rounded-xl border bg-[var(--surface)] p-6 shadow-[var(--shadow)]">
          <Suspense fallback={<div className="h-64" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-5 text-center text-[12px] leading-relaxed text-[var(--text-subtle)]">
          After signing in you&apos;ll be asked for your Gmail app password so mail sends
          from your own address.
        </p>
      </div>
    </div>
  );
}
