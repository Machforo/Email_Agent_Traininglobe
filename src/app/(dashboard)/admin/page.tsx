'use client';

import { KeyRound, Play, Plus, Settings2, ShieldCheck, Users } from 'lucide-react';
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
  Modal,
  Select,
  Skeleton,
  Spinner,
  Stat,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import { relativeTime } from '@/lib/utils';

type LeaderRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  institutions: number;
  sent: number;
  replied: number;
  bounced: number;
  positive: number;
  replyRate: number;
  pendingApproval: number;
  lastActivity: string | null;
};

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  smtpEmail: string | null;
  smtpVerifiedAt: string | null;
  dailySendLimit: number;
  lastLoginAt: string | null;
  _count: { institutions: number; sequences: number; messages: number };
};

export default function AdminPage() {
  const [tab, setTab] = useState<'team' | 'users' | 'settings'>('team');
  const [leaderboard, setLeaderboard] = useState<LeaderRow[] | null>(null);
  const [orgStats, setOrgStats] = useState<{ sent: number; replied: number; rates: { reply: number; bounce: number } } | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobRunning, setJobRunning] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [analytics, usersRes, settingsRes] = await Promise.all([
        api.get<{ leaderboard: LeaderRow[]; stats: typeof orgStats }>('/api/analytics?scope=all'),
        api.get<{ users: AdminUser[] }>('/api/admin/users'),
        api.get<{ settings: Record<string, string> }>('/api/admin/settings'),
      ]);
      setLeaderboard(analytics.leaderboard ?? []);
      setOrgStats(analytics.stats);
      setUsers(usersRes.users);
      setSettings(settingsRes.settings);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(u: AdminUser) {
    try {
      await api.patch(`/api/admin/users/${u.id}`, { active: !u.active });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function runJob(job: string) {
    setJobRunning(job);
    setJobResult(null);
    setError(null);
    try {
      const res = await api.post<{ result: { processed: number; errors: string[]; detail?: string } }>(
        '/api/admin/jobs',
        { job },
      );
      setJobResult(
        `${job}: ${res.result.processed} processed${res.result.detail ? ` — ${res.result.detail}` : ''}${
          res.result.errors.length ? ` (${res.result.errors.length} errors)` : ''
        }`,
      );
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setJobRunning(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Admin console"
        subtitle="Team performance, accounts and system behaviour."
        action={
          tab === 'users' ? (
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add member
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {jobResult && (
        <div className="mb-4">
          <Alert tone="success">{jobResult}</Alert>
        </div>
      )}

      <div className="mb-5 flex gap-1">
        {(
          [
            ['team', 'Team performance', <Users key="a" size={14} />],
            ['users', 'Accounts', <ShieldCheck key="b" size={14} />],
            ['settings', 'System settings', <Settings2 key="c" size={14} />],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors ${
              tab === key
                ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'team' && (
        <>
          {orgStats && (
            <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Team sends" value={orgStats.sent} />
              <Stat label="Conversations" value={orgStats.replied} tone="success" />
              <Stat label="Team reply rate" value={`${orgStats.rates.reply}%`} tone="brand" />
              <Stat
                label="Bounce rate"
                value={`${orgStats.rates.bounce}%`}
                tone={orgStats.rates.bounce > 3 ? 'danger' : 'success'}
              />
            </div>
          )}

          <Card padded={false}>
            {leaderboard === null ? (
              <div className="space-y-3 p-5">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Member</Th>
                    <Th>Prospects</Th>
                    <Th>Sent</Th>
                    <Th>Replies</Th>
                    <Th>Reply rate</Th>
                    <Th>Positive</Th>
                    <Th>Bounced</Th>
                    <Th>Pending</Th>
                    <Th>Last active</Th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard
                    .slice()
                    .sort((a, b) => b.sent - a.sent)
                    .map((r) => (
                      <tr key={r.userId} className="hover:bg-[var(--surface-2)]/60">
                        <Td>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{r.name}</span>
                            {r.role === 'ADMIN' && <Badge tone="brand">admin</Badge>}
                            {!r.active && <Badge tone="danger">disabled</Badge>}
                          </div>
                          <div className="text-[12px] text-[var(--text-muted)]">{r.email}</div>
                        </Td>
                        <Td>{r.institutions}</Td>
                        <Td className="font-medium">{r.sent}</Td>
                        <Td>{r.replied}</Td>
                        <Td>
                          <Badge tone={r.replyRate >= 5 ? 'success' : r.sent > 10 ? 'warning' : 'neutral'}>
                            {r.replyRate}%
                          </Badge>
                        </Td>
                        <Td>{r.positive}</Td>
                        <Td className={r.bounced > 0 ? 'text-[var(--danger)]' : ''}>{r.bounced}</Td>
                        <Td>
                          {r.pendingApproval > 0 ? (
                            <Badge tone="warning">{r.pendingApproval}</Badge>
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td className="text-[12px] whitespace-nowrap text-[var(--text-muted)]">
                          {relativeTime(r.lastActivity)}
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === 'users' && (
        <Card padded={false}>
          {users === null ? (
            <div className="space-y-3 p-5">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Mailbox</Th>
                  <Th>Daily cap</Th>
                  <Th>Activity</Th>
                  <Th>Last login</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--surface-2)]/60">
                    <Td>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-[12px] text-[var(--text-muted)]">{u.email}</div>
                    </Td>
                    <Td>
                      <Badge tone={u.role === 'ADMIN' ? 'brand' : 'neutral'}>{u.role.toLowerCase()}</Badge>
                    </Td>
                    <Td>
                      {u.smtpEmail ? (
                        <div className="flex items-center gap-1.5">
                          <KeyRound size={13} className="text-[var(--success)]" />
                          <span className="text-[12.5px]">{u.smtpEmail}</span>
                        </div>
                      ) : (
                        <Badge tone="warning">not connected</Badge>
                      )}
                    </Td>
                    <Td>{u.dailySendLimit}</Td>
                    <Td className="text-[12.5px] text-[var(--text-muted)]">
                      {u._count.institutions} prospects · {u._count.messages} mails
                    </Td>
                    <Td className="text-[12px] whitespace-nowrap text-[var(--text-muted)]">
                      {relativeTime(u.lastLoginAt)}
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <Button size="sm" onClick={() => toggleActive(u)}>
                          {u.active ? 'Disable' : 'Enable'}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'settings' && settings && (
        <div className="grid gap-5 lg:grid-cols-2">
          <SystemSettings settings={settings} onSaved={load} />

          <Card>
            <CardHeader
              title="Background jobs"
              subtitle="These run on a schedule in the worker. Run one now if you don't want to wait."
            />
            <div className="space-y-2">
              {[
                ['inbox-poll', 'Check mailboxes for replies and bounces'],
                ['follow-ups', 'Generate follow-ups that are due'],
                ['housekeeping', 'Close out finished sequences'],
              ].map(([job, label]) => (
                <div key={job} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-[13.5px] font-medium">{job}</p>
                    <p className="text-[12px] text-[var(--text-muted)]">{label}</p>
                  </div>
                  <Button size="sm" onClick={() => runJob(job)} disabled={Boolean(jobRunning)}>
                    {jobRunning === job ? <Spinner /> : <Play size={13} />} Run
                  </Button>
                </div>
              ))}
            </div>
            <Alert tone="info">
              The worker process must be running for these to happen automatically:{' '}
              <code className="text-[12px]">npm run worker</code>
            </Alert>
          </Card>
        </div>
      )}

      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          load();
        }}
      />
    </>
  );
}

function SystemSettings({
  settings,
  onSaved,
}: {
  settings: Record<string, string>;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.patch('/api/admin/settings', form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card>
      <CardHeader title="System settings" subtitle="Applies to everyone on the team." />
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {saved && <Alert tone="success">Settings saved.</Alert>}

        <Field label="Organisation name">
          <Input value={form.orgName ?? ''} onChange={set('orgName')} />
        </Field>

        <Field label="What we offer" hint="The agents use this to match solutions to the gaps they find.">
          <textarea
            rows={4}
            value={form.offering ?? ''}
            onChange={set('offering')}
            className="w-full resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--brand)]"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Days between follow-ups">
            <Input type="number" min={1} max={30} value={form.followUpDays ?? '3'} onChange={set('followUpDays')} />
          </Field>
          <Field label="Max follow-ups">
            <Input type="number" min={0} max={3} value={form.maxFollowUps ?? '3'} onChange={set('maxFollowUps')} />
          </Field>
          <Field label="Auto-revision loops" hint="Verify → revise cycles before a human sees it.">
            <Input type="number" min={0} max={3} value={form.maxRevisionLoops ?? '2'} onChange={set('maxRevisionLoops')} />
          </Field>
          <Field label="Auto-send follow-ups" hint="Off means follow-ups still need approval.">
            <Select value={form.autoSendFollowUps ?? 'false'} onChange={set('autoSendFollowUps')}>
              <option value="false">Require approval (recommended)</option>
              <option value="true">Send automatically</option>
            </Select>
          </Field>
          <Field label="Track opens">
            <Select value={form.trackOpens ?? 'true'} onChange={set('trackOpens')}>
              <option value="true">On</option>
              <option value="false">Off</option>
            </Select>
          </Field>
          <Field label="Track clicks">
            <Select value={form.trackClicks ?? 'true'} onChange={set('trackClicks')}>
              <option value="true">On</option>
              <option value="false">Off</option>
            </Select>
          </Field>
        </div>

        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : 'Save settings'}
        </Button>
      </div>
    </Card>
  );
}

function AddUserModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'MEMBER' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/users', form);
      setForm({ name: '', email: '', password: '', role: 'MEMBER' });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a team member">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Full name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label="Email" required>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </Field>
        <Field label="Temporary password" required hint="At least 8 characters. They can change it later.">
          <Input
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            minLength={8}
            required
          />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="MEMBER">Member — sees only their own work</option>
            <option value="ADMIN">Admin — sees everything</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner /> : 'Create account'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
