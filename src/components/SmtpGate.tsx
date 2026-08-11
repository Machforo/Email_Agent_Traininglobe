'use client';

import { KeyRound, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Field, Input, Modal, Spinner, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/client';

/**
 * Shown until a member has stored a working Gmail app password. Until then they can
 * browse and draft, but nothing can be sent from their address.
 */
export function SmtpGate({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(userEmail);
  const [appPassword, setAppPassword] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/smtp', { email, appPassword, signature });
      window.location.reload();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-4 py-3">
        <KeyRound size={18} className="text-[var(--warning)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-[var(--warning)]">
            Connect your mailbox to start sending
          </p>
          <p className="text-[12.5px] text-[var(--warning)]/80">
            Add your Gmail app password so approved mails send from your own address and
            replies come back to you.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          Connect mailbox
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Connect your mailbox"
        subtitle="We verify the credentials with Gmail before saving them."
      >
        <form onSubmit={save} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <Alert tone="info" title="How to get an app password">
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Enable 2-Step Verification on your Google account.</li>
              <li>
                Go to{' '}
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline"
                >
                  App passwords <ExternalLink size={11} />
                </a>
                and create one for &quot;Mail&quot;.
              </li>
              <li>Paste the 16-character code below.</li>
            </ol>
          </Alert>

          <Field label="Gmail address" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourdomain.com"
              required
            />
          </Field>

          <Field
            label="App password"
            required
            hint="16 characters. Stored encrypted — this is not your normal Gmail password."
          >
            <Input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx xxxx xxxx xxxx"
              required
            />
          </Field>

          <Field
            label="Email signature"
            hint="Appended to every mail you send. Leave blank to skip."
          >
            <Textarea
              rows={3}
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder={'Your Name\nTraininglobe\n+91 …'}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> Verifying with Gmail…
                </>
              ) : (
                'Verify and save'
              )}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
