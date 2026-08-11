import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueue, toView } from '@/lib/jobs/queue';
import { getSettings, settingNumber } from '@/lib/settings';

const createSchema = z.object({
  institutionId: z.string(),
  contactId: z.string().optional(),
  templateId: z.string().nullable().optional(),
  caseStudyIds: z.array(z.string()).optional(),
  followUpDays: z.number().int().min(1).max(30).optional(),
  maxFollowUps: z.number().int().min(0).max(3).optional(),
  forceResearch: z.boolean().optional(),
});

export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const all = user.role === 'ADMIN' && url.searchParams.get('scope') === 'all';

  const sequences = await prisma.sequence.findMany({
    where: {
      ...(all ? {} : { ownerId: user.id }),
      ...(status ? { status } : {}),
    },
    include: {
      institution: { select: { id: true, name: true, city: true, status: true } },
      contact: true,
      owner: { select: { id: true, name: true } },
      messages: {
        select: {
          id: true,
          direction: true,
          stage: true,
          subject: true,
          sentAt: true,
          openedAt: true,
          openCount: true,
          clickCount: true,
          status: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      drafts: {
        where: { status: { in: ['NEEDS_APPROVAL', 'GENERATING', 'FAILED'] } },
        select: { id: true, status: true, kind: true, stage: true, confidence: true },
      },
      replies: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
    take: 300,
  });

  return ok({ sequences });
});

/**
 * Starts outreach for one contact: creates the sequence, then runs the full agent
 * cascade to produce a draft awaiting approval. Nothing is sent here.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const body = createSchema.parse(await req.json());
  const settings = await getSettings();

  const institution = await prisma.institution.findUnique({
    where: { id: body.institutionId },
    include: { contacts: true },
  });
  if (!institution) return fail('Institution not found', 404);
  if (institution.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);

  const contact = body.contactId
    ? institution.contacts.find((c) => c.id === body.contactId)
    : (institution.contacts.find((c) => c.isPrimary) ?? institution.contacts[0]);
  if (!contact) return fail('This institution has no contact to write to', 400);

  const suppressed = await prisma.suppression.findUnique({
    where: { email: contact.email.toLowerCase() },
  });
  if (suppressed) {
    return fail(`${contact.email} has opted out and cannot be contacted.`, 400);
  }

  const existing = await prisma.sequence.findFirst({
    where: {
      contactId: contact.id,
      status: { in: ['DRAFTING', 'PENDING_APPROVAL', 'ACTIVE'] },
    },
  });
  if (existing) {
    return fail('An outreach sequence is already running for this contact.', 409, {
      sequenceId: existing.id,
    });
  }

  const sequence = await prisma.sequence.create({
    data: {
      ownerId: user.id,
      institutionId: institution.id,
      contactId: contact.id,
      followUpDays: body.followUpDays ?? settingNumber(settings.followUpDays, 3),
      maxFollowUps: body.maxFollowUps ?? settingNumber(settings.maxFollowUps, 3),
      status: 'DRAFTING',
    },
  });

  await audit(user.id, 'SEQUENCE_CREATED', 'Sequence', sequence.id, {
    institution: institution.name,
    contact: contact.email,
  });

  // The cascade takes 90-355 seconds, far beyond any serverless request budget, so it
  // runs on the worker. Return the job id immediately and let the client poll.
  const job = await enqueue(
    'GENERATE_DRAFT',
    user.id,
    {
      sequenceId: sequence.id,
      stage: 0,
      templateId: body.templateId ?? null,
      caseStudyIds: body.caseStudyIds,
      forceResearch: body.forceResearch,
    },
    { sequenceId: sequence.id },
  );

  return ok({ sequence, job: toView(job) }, { status: 202 });
});
