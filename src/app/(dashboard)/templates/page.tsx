'use client';

import { FileText, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
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
  Textarea,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/client';

type Template = {
  id: string;
  name: string;
  stage: string;
  subject: string;
  body: string;
  guidance: string | null;
  isShared: boolean;
  isActive: boolean;
  useCount: number;
  variables: string[];
  owner: { id: string; name: string };
};

const STAGES = [
  { value: 'INITIAL', label: 'Initial outreach' },
  { value: 'FOLLOWUP_1', label: 'Follow-up 1' },
  { value: 'FOLLOWUP_2', label: 'Follow-up 2' },
  { value: 'FOLLOWUP_3', label: 'Follow-up 3' },
  { value: 'REPLY', label: 'Reply handler' },
];

const VARIABLES = [
  '{{institution}}',
  '{{first_name}}',
  '{{contact_name}}',
  '{{contact_title}}',
  '{{city}}',
  '{{sender_name}}',
  '{{org_name}}',
];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ templates: Template[] }>('/api/templates');
      setTemplates(res.templates);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(t: Template) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api.del(`/api/templates/${t.id}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const byStage = STAGES.map((s) => ({
    ...s,
    items: (templates ?? []).filter((t) => t.stage === s.value),
  }));

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="The AI rewrites these for each institution — treat them as the structure and tone you want, not the final text."
        action={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> New template
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {templates === null ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText size={32} />}
            title="No templates yet"
            description="Create one per stage — initial, three follow-ups and a reply handler."
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                <Plus size={15} /> Create a template
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-7">
          {byStage.map(
            (group) =>
              group.items.length > 0 && (
                <section key={group.value}>
                  <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                    {group.label}
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {group.items.map((t) => (
                      <Card key={t.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-[14.5px] font-semibold">{t.name}</h3>
                              {t.isShared && (
                                <Badge tone="info">
                                  <Share2 size={10} /> shared
                                </Badge>
                              )}
                              {!t.isActive && <Badge tone="neutral">inactive</Badge>}
                            </div>
                            <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                              by {t.owner.name} · used {t.useCount}×
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                              <Pencil size={14} />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => remove(t)}>
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>

                        <p className="mt-3 text-[13px] font-medium">{t.subject}</p>
                        <p className="mt-1.5 line-clamp-4 text-[12.5px] leading-relaxed whitespace-pre-wrap text-[var(--text-muted)]">
                          {t.body}
                        </p>

                        {t.variables.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1">
                            {t.variables.map((v) => (
                              <Badge key={v} tone="brand">
                                {v}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </section>
              ),
          )}
        </div>
      )}

      <TemplateModal
        template={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </>
  );
}

function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: Template | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = template === 'new';
  const existing = isNew ? null : template;

  const [form, setForm] = useState({
    name: '',
    stage: 'INITIAL',
    subject: '',
    body: '',
    guidance: '',
    isShared: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!template) return;
    setError(null);
    setForm(
      existing
        ? {
            name: existing.name,
            stage: existing.stage,
            subject: existing.subject,
            body: existing.body,
            guidance: existing.guidance ?? '',
            isShared: existing.isShared,
          }
        : { name: '', stage: 'INITIAL', subject: '', body: '', guidance: '', isShared: false },
    );
  }, [template, existing]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { ...form, guidance: form.guidance || undefined };
      if (existing) await api.patch(`/api/templates/${existing.id}`, payload);
      else await api.post('/api/templates', payload);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function insertVar(v: string) {
    setForm((f) => ({ ...f, body: `${f.body}${v}` }));
  }

  return (
    <Modal
      open={Boolean(template)}
      onClose={onClose}
      title={existing ? 'Edit template' : 'New template'}
      width="max-w-2xl"
    >
      <form onSubmit={save} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Initial outreach — gap-led"
              required
            />
          </Field>
          <Field label="Stage" required>
            <Select
              value={form.stage}
              onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
            >
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Subject" required>
          <Input
            value={form.subject}
            onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            placeholder="quick thought on {{institution}} placements"
            required
          />
        </Field>

        <Field label="Body" required hint="The AI keeps this structure and tone but writes the specifics for each institution.">
          <Textarea
            rows={11}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            required
          />
        </Field>

        <div className="flex flex-wrap gap-1.5">
          {VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVar(v)}
              className="rounded-full border px-2 py-0.5 text-[11.5px] text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
            >
              {v}
            </button>
          ))}
        </div>

        <Field label="Guidance for the AI" hint="Tone, angle, things to avoid.">
          <Textarea
            rows={2}
            value={form.guidance}
            onChange={(e) => setForm((f) => ({ ...f, guidance: e.target.value }))}
            placeholder="Consultative, never salesy. Lead with the gap. One ask at the end."
          />
        </Field>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={form.isShared}
            onChange={(e) => setForm((f) => ({ ...f, isShared: e.target.checked }))}
          />
          Share with the whole team
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner /> : existing ? 'Save changes' : 'Create template'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
