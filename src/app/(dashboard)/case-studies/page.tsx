'use client';

import { FileUp, Paperclip, Share2, Trash2 } from 'lucide-react';
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
  Skeleton,
  Spinner,
  Textarea,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import { relativeTime } from '@/lib/utils';

type CaseStudy = {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isShared: boolean;
  createdAt: string;
  owner: { id: string; name: string };
};

export default function CaseStudiesPage() {
  const [items, setItems] = useState<CaseStudy[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ caseStudies: CaseStudy[] }>('/api/case-studies');
      setItems(res.caseStudies);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(c: CaseStudy) {
    if (!confirm(`Delete "${c.title}"?`)) return;
    try {
      await api.del(`/api/case-studies/${c.id}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Case studies"
        subtitle="Attach these to follow-ups. The AI references them naturally rather than describing them at length."
        action={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <FileUp size={15} /> Upload
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {items === null ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Paperclip size={32} />}
            title="No case studies yet"
            description="Upload PDFs or decks showing results at similar institutions. They work best on the second follow-up."
            action={
              <Button variant="primary" onClick={() => setOpen(true)}>
                <FileUp size={15} /> Upload your first
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Card key={c.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                    <Paperclip size={16} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-semibold">{c.title}</h3>
                    <p className="truncate text-[12px] text-[var(--text-muted)]">{c.fileName}</p>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                  <Trash2 size={14} />
                </Button>
              </div>

              {c.description && (
                <p className="mt-3 line-clamp-3 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                  {c.description}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--text-subtle)]">
                <span>{(c.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>
                <span>·</span>
                <span>{c.owner.name}</span>
                <span>·</span>
                <span>{relativeTime(c.createdAt)}</span>
                {c.isShared && (
                  <Badge tone="info">
                    <Share2 size={10} /> shared
                  </Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <UploadModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />
    </>
  );
}

function UploadModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isShared, setIsShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError('Choose a file first.');
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('title', title);
      form.set('description', description);
      form.set('isShared', String(isShared));
      await api.upload('/api/case-studies', form);
      setTitle('');
      setDescription('');
      setFile(null);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Upload a case study">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Title" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="AI upskilling at a Tier-2 engineering college"
            required
          />
        </Field>

        <Field label="What it shows" hint="Helps the AI reference it accurately in follow-ups.">
          <Textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="240 final-year students, 12-week programme, placement rate moved from 61% to 78%."
          />
        </Field>

        <Field label="File" required hint="PDF, Word, PowerPoint or an image. Max 15MB.">
          <input
            type="file"
            accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brand)] file:px-3 file:py-1.5 file:text-white"
            required
          />
        </Field>

        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
          Share with the whole team
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner /> : 'Upload'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
