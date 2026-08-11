'use client';

import {
  Building2,
  Globe,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
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
  Select,
  Skeleton,
  Spinner,
  Table,
  Td,
  Textarea,
  Th,
  humanStatus,
  statusTone,
} from '@/components/ui';
import { JobProgress } from '@/components/JobProgress';
import { api, errorMessage } from '@/lib/client';
import { useJob } from '@/lib/useJob';
import { relativeTime } from '@/lib/utils';

type Contact = { id: string; name: string | null; email: string; title: string | null; isPrimary: boolean };
type Institution = {
  id: string;
  name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  type: string | null;
  notes: string | null;
  status: string;
  researchedAt: string | null;
  updatedAt: string;
  contacts: Contact[];
  sequences: { id: string; status: string; currentStage: number }[];
};

export default function ProspectsPage() {
  const [institutions, setInstitutions] = useState<Institution[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [startFor, setStartFor] = useState<Institution | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      const res = await api.get<{ institutions: Institution[] }>(
        `/api/institutions?${params.toString()}`,
      );
      setInstitutions(res.institutions);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all its outreach history? This cannot be undone.`)) return;
    try {
      await api.del(`/api/institutions/${id}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Prospects"
        subtitle="Institutions you're targeting. Add notes on the angle you want, and the AI does the research."
        action={
          <>
            <Button onClick={() => setImportOpen(true)}>
              <Upload size={15} /> Import CSV
            </Button>
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add prospect
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-subtle)]"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search institutions…"
              className="pl-9"
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            <option value="">All statuses</option>
            {['NEW', 'RESEARCHED', 'ACTIVE', 'ENGAGED', 'WON', 'LOST', 'BOUNCED', 'UNSUBSCRIBED'].map(
              (s) => (
                <option key={s} value={s}>
                  {humanStatus(s)}
                </option>
              ),
            )}
          </Select>
        </div>

        {institutions === null ? (
          <div className="space-y-3 p-5">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : institutions.length === 0 ? (
          <EmptyState
            icon={<Building2 size={32} />}
            title="No prospects yet"
            description="Add an institution with the contact's email and a note about the angle you want, then let the agents research and draft the mail."
            action={
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                <Plus size={15} /> Add your first prospect
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Institution</Th>
                <Th>Primary contact</Th>
                <Th>Status</Th>
                <Th>Outreach</Th>
                <Th>Updated</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {institutions.map((inst) => {
                const primary = inst.contacts.find((c) => c.isPrimary) ?? inst.contacts[0];
                const seq = inst.sequences[0];
                return (
                  <tr key={inst.id} className="hover:bg-[var(--surface-2)]/60">
                    <Td>
                      <div className="font-medium">{inst.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                        {inst.city && <span>{inst.city}</span>}
                        {inst.website && (
                          <a
                            href={inst.website}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            <Globe size={11} /> site
                          </a>
                        )}
                      </div>
                    </Td>
                    <Td>
                      {primary ? (
                        <>
                          <div className="text-[13px]">{primary.name ?? '—'}</div>
                          <div className="text-[12px] text-[var(--text-muted)]">{primary.email}</div>
                        </>
                      ) : (
                        <span className="text-[var(--text-subtle)]">No contact</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={statusTone(inst.status)}>{humanStatus(inst.status)}</Badge>
                    </Td>
                    <Td>
                      {seq ? (
                        <Link href={`/sequences/${seq.id}`} className="text-[13px] hover:underline">
                          <Badge tone={statusTone(seq.status)}>
                            {humanStatus(seq.status)}
                            {seq.currentStage > 0 && ` · FU${seq.currentStage}`}
                          </Badge>
                        </Link>
                      ) : (
                        <span className="text-[12px] text-[var(--text-subtle)]">Not started</span>
                      )}
                    </Td>
                    <Td className="text-[12px] whitespace-nowrap text-[var(--text-muted)]">
                      {relativeTime(inst.updatedAt)}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1.5">
                        {!seq && primary && (
                          <Button size="sm" variant="primary" onClick={() => setStartFor(inst)}>
                            <Sparkles size={13} /> Draft mail
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove(inst.id, inst.name)}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <AddModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onSaved={load} />
      <StartOutreachModal
        institution={startFor}
        onClose={() => setStartFor(null)}
        onDone={load}
      />
    </>
  );
}

/* ------------------------------- Add prospect ------------------------------ */

function AddModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    website: '',
    city: '',
    state: '',
    type: '',
    notes: '',
    contactName: '',
    contactEmail: '',
    contactTitle: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/institutions', {
        name: form.name,
        website: form.website || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        type: form.type || undefined,
        notes: form.notes || undefined,
        contacts: [
          {
            email: form.contactEmail,
            name: form.contactName || undefined,
            title: form.contactTitle || undefined,
          },
        ],
      });
      onSaved();
      onClose();
      setForm({
        name: '',
        website: '',
        city: '',
        state: '',
        type: '',
        notes: '',
        contactName: '',
        contactEmail: '',
        contactTitle: '',
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add prospect" width="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Institution name" required>
              <Input value={form.name} onChange={set('name')} placeholder="Lovely Professional University" required />
            </Field>
          </div>
          <Field label="Website" hint="Helps the research agent find the right institution.">
            <Input value={form.website} onChange={set('website')} placeholder="https://www.lpu.in" />
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={set('type')}>
              <option value="">Select…</option>
              {['University', 'College', 'School', 'Institute', 'EdTech', 'Other'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={set('city')} placeholder="Phagwara" />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={set('state')} placeholder="Punjab" />
          </Field>
        </div>

        <div className="rounded-lg border bg-[var(--surface-2)] p-4">
          <p className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold">
            <UserIcon size={14} /> Contact person
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Email" required>
              <Input
                type="email"
                value={form.contactEmail}
                onChange={set('contactEmail')}
                placeholder="tpo@institution.edu"
                required
              />
            </Field>
            <Field label="Name">
              <Input value={form.contactName} onChange={set('contactName')} placeholder="Dr. A. Sharma" />
            </Field>
            <Field label="Designation">
              <Input value={form.contactTitle} onChange={set('contactTitle')} placeholder="Head, T&P" />
            </Field>
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">
            The verification agent checks this person really holds this role before the mail
            goes out.
          </p>
        </div>

        <Field
          label="Your notes for the AI"
          hint="What angle should the mail take? What did you notice about them? This is the strongest signal the agents get."
        >
          <Textarea
            rows={4}
            value={form.notes}
            onChange={set('notes')}
            placeholder="They just launched a new AI programme but placements in non-tech streams look weak. Pitch our industry-mentored capstone track for final-year students."
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner /> : 'Add prospect'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------- Import --------------------------------- */

function ImportModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ imported: number; skipped: number; errors: string[] }>(
        '/api/institutions/import',
        { csv },
      );
      setResult(res);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setCsv(await file.text());
  }

  return (
    <Modal open={open} onClose={onClose} title="Import prospects from CSV" width="max-w-2xl">
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {result && (
          <Alert tone={result.errors.length ? 'warning' : 'success'}>
            Imported {result.imported}, skipped {result.skipped}.
            {result.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {result.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        <Alert tone="info" title="Expected columns">
          <code className="text-[12px]">
            institution, email, contact_name, title, website, city, state, type, notes
          </code>
          <p className="mt-1">Order doesn&apos;t matter. Only institution and email are required.</p>
        </Alert>

        <Field label="Upload a .csv file">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="w-full text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brand)] file:px-3 file:py-1.5 file:text-white"
          />
        </Field>

        <Field label="…or paste the rows">
          <Textarea
            rows={8}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'institution,email,contact_name,title,notes\nABC University,tpo@abc.edu,Dr. Rao,Head T&P,Weak placements in core branches'}
            className="font-mono text-[12px]"
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !csv.trim()}>
            {busy ? <Spinner /> : 'Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------- Start outreach ------------------------------ */

function StartOutreachModal({
  institution,
  onClose,
  onDone,
}: {
  institution: Institution | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [templates, setTemplates] = useState<{ id: string; name: string; stage: string }[]>([]);
  const [caseStudies, setCaseStudies] = useState<{ id: string; title: string }[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [contactId, setContactId] = useState('');
  const [selectedCs, setSelectedCs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  // The cascade runs on the worker now, so follow the job rather than blocking.
  const { job, elapsed, reset } = useJob(jobId, () => onDone());
  const done = job?.status === 'DONE' ? (job.result?.draftId ?? job.draftId) : null;

  useEffect(() => {
    if (!institution) return;
    setContactId(institution.contacts.find((c) => c.isPrimary)?.id ?? institution.contacts[0]?.id ?? '');
    setError(null);
    setJobId(null);
    reset();
    api
      .get<{ templates: { id: string; name: string; stage: string }[] }>('/api/templates?stage=INITIAL')
      .then((r) => setTemplates(r.templates))
      .catch(() => {});
    api
      .get<{ caseStudies: { id: string; title: string }[] }>('/api/case-studies')
      .then((r) => setCaseStudies(r.caseStudies))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset is stable (useCallback, no deps); listing it would re-run this on every render
  }, [institution]);

  async function start() {
    if (!institution) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ job: { id: string } }>('/api/sequences', {
        institutionId: institution.id,
        contactId: contactId || undefined,
        templateId: templateId || null,
        caseStudyIds: selectedCs,
      });
      // The work now happens on the worker; follow it rather than waiting on the request.
      setJobId(res.job.id);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(institution)}
      onClose={onClose}
      title={`Draft outreach for ${institution?.name ?? ''}`}
      subtitle="The agents research, write, fact-check and revise. You approve before anything sends."
      width="max-w-xl"
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {done ? (
          <>
            <Alert tone="success" title="Draft ready">
              The cascade finished and the mail is waiting for your review.
            </Alert>
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Close</Button>
              <Link href={`/approvals?draft=${done}`}>
                <Button variant="primary">Review the draft</Button>
              </Link>
            </div>
          </>
        ) : jobId || busy ? (
          <>
            <JobProgress
              job={job}
              elapsed={elapsed}
              queuedHint="Waiting for the worker. If this doesn't move, the worker process may not be running."
            />
            {job?.status === 'FAILED' && (
              <div className="flex justify-end gap-2">
                <Button onClick={onClose}>Close</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setJobId(null);
                    reset();
                  }}
                >
                  Try again
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            {institution && institution.contacts.length > 1 && (
              <Field label="Send to">
                <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  {institution.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name ? `${c.name} — ` : ''}
                      {c.email}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="Template" hint="Leave on auto to let the AI pick your default initial template.">
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Auto — use my default</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>

            {caseStudies.length > 0 && (
              <Field label="Attach case studies" hint="Usually better saved for follow-up 2.">
                <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
                  {caseStudies.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        checked={selectedCs.includes(c.id)}
                        onChange={(e) =>
                          setSelectedCs((s) =>
                            e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id),
                          )
                        }
                      />
                      {c.title}
                    </label>
                  ))}
                </div>
              </Field>
            )}

            {institution?.notes ? (
              <Alert tone="info" title="Your notes will steer the mail">
                {institution.notes}
              </Alert>
            ) : (
              <Alert tone="warning">
                No notes on this prospect. The mail will be based on web research alone — adding a
                note about your angle usually produces a much better draft.
              </Alert>
            )}

            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={start}>
                <Sparkles size={15} /> Generate draft
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
