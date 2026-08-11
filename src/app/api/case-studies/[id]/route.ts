import { NextResponse } from 'next/server';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/** Download the stored file. Shared case studies are readable by the whole team. */
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const cs = await prisma.caseStudy.findUnique({ where: { id } });
  if (!cs) return fail('Case study not found', 404);
  if (cs.ownerId !== user.id && !cs.isShared && user.role !== 'ADMIN') {
    return fail('Not yours', 403);
  }

  return new NextResponse(new Uint8Array(cs.data), {
    headers: {
      'Content-Type': cs.mimeType,
      // `inline` so PDFs preview in the browser instead of forcing a download.
      'Content-Disposition': `inline; filename="${encodeURIComponent(cs.fileName)}"`,
      'Content-Length': String(cs.data.length),
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const existing = await prisma.caseStudy.findUnique({
    where: { id },
    select: { id: true, ownerId: true, title: true },
  });
  if (!existing) return fail('Case study not found', 404);
  if (existing.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  // The bytes live in this row, so deleting it is the whole cleanup.
  await prisma.caseStudy.delete({ where: { id } });

  await audit(user.id, 'CASE_STUDY_DELETED', 'CaseStudy', id, { title: existing.title });
  return ok({ ok: true });
});
