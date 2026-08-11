'use client';

import { Brain, CheckCircle2, KeyRound, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/Shell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Skeleton,
  Spinner,
  Textarea,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import { relativeTime } from '@/lib/utils';

type Me = {
  id: string;
  name: string;
  email: string;
  role: string;
  hasSmtp: boolean;
  smtpEmail: string | null;
  signature: string | null;
  dailySendLimit: number;
};

type Feedback = {
  id: string;
  agent: string;
  type: string;
  lesson: string | null;
  global: boolean;
  active: boolean;
  createdAt: string;
  owner: { name: string };
};

export default function SettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meRes, fbRes] = await Promise.all([
        api.get<{ user: Me }>('/api/auth/me'),
        api.get<{ feedback: Feedback[] }>('/api/feedback'),
      ]);
      setMe(meRes.user);
      setFeedback(fbRes.feedback);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!me) {
    return (
      <>
        <PageHeader title="Settings" />
        <Skeleton className="h-64" />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Your sending identity and what the AI has learned from you." />

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <MailboxCard me={me} onSaved={load} />
        <FeedbackCard feedback={feedback} onChanged={load} isAdmin={me.role === 'ADMIN'} />
      </div>
    </>
  );
}

function MailboxCard({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [email, setEmail] = useState(me.smtpEmail ?? me.email);
  const [appPassword, setAppPassword] = useState('');
  const [signature, setSignature] = useState(me.signature ?? '');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      await api.post('/api/auth/smtp', { email, appPassword, signature });
      setOk(true);
      setAppPassword('');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect this mailbox? You will not be able to send until you reconnect.')) return;
    await api.del('/api/auth/smtp');
    onSaved();
  }

  return (
    <Card>
      <CardHeader
        title="Your mailbox"
        subtitle="Mail sends from your own Gmail address, so replies come straight back to you."
        action={
          me.hasSmtp ? (
            <Badge tone="success">
              <CheckCircle2 size={11} /> connected
            </Badge>
          ) : (
            <Badge tone="warning">not connected</Badge>
          )
        }
      />

      <form onSubmit={save} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {ok && <Alert tone="success">Verified with Gmail and saved.</Alert>}

        <Field label="Gmail address" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>

        <Field
          label={me.hasSmtp ? 'Replace app password' : 'App password'}
          required={!me.hasSmtp}
          hint="16-character Google app password. Encrypted at rest; never shown again."
        >
          <div className="relative">
            <KeyRound
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-subtle)]"
            />
            <Input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder={me.hasSmtp ? 'Leave blank to keep the current one' : 'xxxx xxxx xxxx xxxx'}
              className="pl-9"
              required={!me.hasSmtp}
            />
          </div>
        </Field>

        <Field label="Signature" hint="Appended to every mail. The AI is told not to write its own sign-off.">
          <Textarea
            rows={4}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder={'Atharv Kumar\nTraininglobe\n+91 …'}
          />
        </Field>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy || (!me.hasSmtp && !appPassword)}>
            {busy ? <Spinner /> : 'Verify and save'}
          </Button>
          {me.hasSmtp && (
            <Button type="button" onClick={disconnect}>
              Disconnect
            </Button>
          )}
        </div>

        <p className="border-t pt-3 text-[12px] text-[var(--text-muted)]">
          Daily sending cap: <span className="font-medium">{me.dailySendLimit} mails / 24h</span>.
          This protects the account from Gmail throttling; an admin can change it.
        </p>
      </form>
    </Card>
  );
}

function FeedbackCard({
  feedback,
  onChanged,
  isAdmin,
}: {
  feedback: Feedback[];
  onChanged: () => void;
  isAdmin: boolean;
}) {
  const [lesson, setLesson] = useState('');
  const [global, setGlobal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/feedback', { lesson, global });
      setLesson('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(f: Feedback) {
    await api.patch('/api/feedback', { id: f.id, active: !f.active });
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title="What the AI has learned"
        subtitle="Every edit you make to a draft becomes a rule. You can add rules directly too."
      />

      <form onSubmit={add} className="mb-5 space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Add a rule">
          <Input
            value={lesson}
            onChange={(e) => setLesson(e.target.value)}
            placeholder="Never mention pricing in the first email."
            minLength={5}
            required
          />
        </Field>
        <div className="flex items-center justify-between gap-3">
          {isAdmin && (
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} />
              Apply to the whole team
            </label>
          )}
          <Button type="submit" variant="primary" size="sm" disabled={busy || !lesson.trim()}>
            {busy ? <Spinner /> : 'Add rule'}
          </Button>
        </div>
      </form>

      {feedback.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
          No rules yet. Edit an AI draft before approving it and the lesson will show up here.
        </p>
      ) : (
        <ul className="max-h-[380px] space-y-2 overflow-y-auto">
          {feedback.map((f) => (
            <li
              key={f.id}
              className={`rounded-lg border p-3 ${f.active ? '' : 'opacity-50'}`}
            >
              <div className="flex items-start gap-2">
                <Brain size={14} className="mt-0.5 shrink-0 text-[var(--brand)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-relaxed">{f.lesson}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone={f.type === 'REJECTION' ? 'danger' : f.type === 'EDIT' ? 'info' : 'neutral'}>
                      {f.type.toLowerCase()}
                    </Badge>
                    {f.global && <Badge tone="brand">team-wide</Badge>}
                    <span className="text-[11px] text-[var(--text-subtle)]">
                      {relativeTime(f.createdAt)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => toggle(f)}
                  className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
                  title={f.active ? 'Disable this rule' : 'Re-enable this rule'}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
