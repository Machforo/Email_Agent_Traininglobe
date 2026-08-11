import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { credentialsFor } from '@/lib/email/smtp';
import { enqueue, toView } from '@/lib/jobs/queue';

const schema = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  attachCaseStudyIds: z.array(z.string()).optional(),
  /** Optional note from the reviewer, fed back into future prompts. */
  feedbackNote: z.string().max(2000).optional(),
});

/**
 * Approve a draft for sending.
 *
 * The SMTP call itself happens on the worker, because a serverless request is the
 * wrong place to do something that must not be silently retried. But everything that
 * can be checked cheaply is checked *here*, synchronously — a reviewer pressing
 * Approve should learn immediately that their mailbox isn't connected or the recipient
 * has opted out, not discover it in a notification two minutes later.
 */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = schema.parse(await req.json().catch(() => ({})));

  const draft = await prisma.draft.findUnique({
    where: { id },
    include: { sequence: { include: { contact: true } } },
  });
  if (!draft) return fail('Draft not found', 404);
  if (draft.ownerId !== user.id && user.role !== 'ADMIN') return fail('Not yours', 403);
  if (draft.status === 'SENT') return fail('This draft has already been sent.', 409);

  const finalSubject = (body.subject ?? draft.subject).trim();
  const finalBody = (body.body ?? draft.body).trim();
  if (!finalSubject || !finalBody) return fail('Subject and body cannot be empty.', 400);

  // Pre-flight checks, cheapest first.
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: draft.ownerId } });
  if (!credentialsFor(owner)) {
    return fail(
      'No sending credentials on file. Add your Gmail app password in Settings before sending.',
      400,
      { code: 'NO_CREDENTIALS' },
    );
  }

  const suppressed = await prisma.suppression.findUnique({
    where: { email: draft.sequence.contact.email.toLowerCase() },
  });
  if (suppressed) {
    return fail(
      `${draft.sequence.contact.email} is on the suppression list (${suppressed.reason.toLowerCase()}).`,
      400,
      { code: 'SUPPRESSED' },
    );
  }

  const since = new Date(Date.now() - 86_400_000);
  const sentToday = await prisma.emailMessage.count({
    where: { ownerId: owner.id, direction: 'OUT', sentAt: { gte: since } },
  });
  if (sentToday >= owner.dailySendLimit) {
    return fail(
      `Daily sending limit reached (${owner.dailySendLimit} mails in 24h).`,
      400,
      { code: 'DAILY_LIMIT' },
    );
  }

  // Guard against a double-click queueing two sends for the same draft.
  const inFlight = await prisma.job.findFirst({
    where: { draftId: draft.id, type: 'SEND_DRAFT', status: { in: ['QUEUED', 'RUNNING'] } },
  });
  if (inFlight) {
    return ok({ job: toView(inFlight), alreadyQueued: true }, { status: 202 });
  }

  // Persist the reviewer's text now so it survives even if the worker is restarted.
  await prisma.draft.update({
    where: { id },
    data: {
      subject: finalSubject,
      body: finalBody,
      ...(body.attachCaseStudyIds !== undefined
        ? { attachCaseStudyIds: body.attachCaseStudyIds.join(',') || null }
        : {}),
      error: null,
    },
  });

  const job = await enqueue(
    'SEND_DRAFT',
    draft.ownerId,
    {
      draftId: draft.id,
      subject: finalSubject,
      body: finalBody,
      attachCaseStudyIds: body.attachCaseStudyIds,
      feedbackNote: body.feedbackNote,
      approvedById: user.id,
    },
    { sequenceId: draft.sequenceId, draftId: draft.id, maxAttempts: 2 },
  );

  await audit(user.id, 'DRAFT_APPROVED', 'Draft', id, { jobId: job.id });

  return ok({ job: toView(job) }, { status: 202 });
});
