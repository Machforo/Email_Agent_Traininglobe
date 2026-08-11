import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

const MAX_BYTES = 15 * 1024 * 1024; // Gmail chokes well before this; 15MB is a safe cap.
const ALLOWED = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
]);

export const GET = handler(async () => {
  const user = await requireUser();
  const caseStudies = await prisma.caseStudy.findMany({
    where: { OR: [{ ownerId: user.id }, { isShared: true }] },
    // Never select `data` in a list query — that would pull every file into memory.
    select: {
      id: true,
      title: true,
      description: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      isShared: true,
      createdAt: true,
      owner: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return ok({ caseStudies });
});

/**
 * Multipart upload. The bytes go into Postgres rather than the filesystem: the app
 * runs on Vercel (ephemeral disk) while the worker that attaches these files to
 * outgoing mail runs on Render, and the database is the only storage both can reach.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const form = await req.formData();

  const file = form.get('file');
  const title = String(form.get('title') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();
  const isShared = String(form.get('isShared') ?? 'true') === 'true';

  if (!(file instanceof File)) return fail('No file uploaded', 400);
  if (!title) return fail('A title is required', 400);
  if (file.size === 0) return fail('The uploaded file is empty', 400);
  if (file.size > MAX_BYTES) return fail('File is larger than the 15MB limit', 400);
  if (file.type && !ALLOWED.has(file.type)) {
    return fail(`Unsupported file type "${file.type}". Use PDF, Word, PowerPoint or an image.`, 400);
  }

  const safeName = file.name.replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'case-study';
  const bytes = Buffer.from(await file.arrayBuffer());

  const caseStudy = await prisma.caseStudy.create({
    data: {
      ownerId: user.id,
      title,
      description: description || null,
      fileName: safeName,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      isShared,
      data: bytes,
    },
    select: { id: true, title: true, fileName: true, sizeBytes: true },
  });

  await audit(user.id, 'CASE_STUDY_UPLOADED', 'CaseStudy', caseStudy.id, { title });
  return ok({ caseStudy }, { status: 201 });
});
