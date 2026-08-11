import { notify } from '../api';
import { distillFeedback } from '../ai/agents';
import { generateDraftForSequence, processInboundReply } from '../ai/pipeline';
import { prisma } from '../db';
import { SendError, sendDraft } from '../email/send';
import { getSettings, settingBool } from '../settings';
import { enqueue, parsePayload, type JobPayloads } from './queue';
import type { Job } from '@/generated/prisma/client';

/**
 * Job handlers — the only place slow or outward-facing work actually happens.
 *
 * Each handler must be safe to retry: the queue re-runs a job after a transient
 * failure, and sending the same mail twice would be worse than not sending it at all.
 */

export async function runJob(job: Job): Promise<unknown> {
  switch (job.type) {
    case 'GENERATE_DRAFT':
    case 'GENERATE_FOLLOWUP':
      return handleGenerate(job);
    case 'SEND_DRAFT':
      return handleSend(job);
    case 'PROCESS_REPLY':
      return handleReply(job);
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function handleGenerate(job: Job) {
  const payload = parsePayload<'GENERATE_DRAFT'>(job);

  // A retry must not leave two drafts awaiting approval on the same sequence.
  const existing = await prisma.draft.findFirst({
    where: {
      sequenceId: payload.sequenceId,
      stage: payload.stage,
      status: { in: ['NEEDS_APPROVAL', 'APPROVED'] },
    },
  });
  if (existing) {
    await prisma.job.update({ where: { id: job.id }, data: { draftId: existing.id } });
    return { draftId: existing.id, reused: true };
  }

  const draft = await generateDraftForSequence(payload.sequenceId, payload.stage, {
    templateId: payload.templateId ?? null,
    caseStudyIds: payload.caseStudyIds,
    forceResearch: payload.forceResearch,
  });

  await prisma.job.update({ where: { id: job.id }, data: { draftId: draft.id } });

  const sequence = await prisma.sequence.findUnique({
    where: { id: payload.sequenceId },
    include: { institution: { select: { name: true } } },
  });

  // Follow-ups may be configured to go out without a human, in which case chain a
  // send job rather than sending here — one job, one responsibility, one retry policy.
  const settings = await getSettings();
  const autoSend = job.type === 'GENERATE_FOLLOWUP' && settingBool(settings.autoSendFollowUps, false);

  if (autoSend) {
    await enqueue(
      'SEND_DRAFT',
      job.ownerId,
      {
        draftId: draft.id,
        subject: draft.subject,
        body: draft.body,
        attachCaseStudyIds: draft.attachCaseStudyIds?.split(',').filter(Boolean),
        approvedById: job.ownerId,
      },
      { sequenceId: payload.sequenceId, draftId: draft.id },
    );
    return { draftId: draft.id, autoSendQueued: true };
  }

  await notify(
    job.ownerId,
    'DRAFT_READY',
    payload.stage === 0
      ? `Draft ready for ${sequence?.institution.name ?? 'a prospect'}`
      : `Follow-up ${payload.stage} ready for ${sequence?.institution.name ?? 'a prospect'}`,
    'Review the verification report, then approve to send.',
    '/approvals',
  );

  return { draftId: draft.id, confidence: draft.confidence };
}

async function handleSend(job: Job) {
  const payload = parsePayload<'SEND_DRAFT'>(job);

  const draft = await prisma.draft.findUnique({ where: { id: payload.draftId } });
  if (!draft) throw new Error('Draft no longer exists');

  // Idempotency guard: if a previous attempt got as far as SMTP, do not send again.
  if (draft.status === 'SENT') {
    return { alreadySent: true, draftId: draft.id };
  }

  // Persist the reviewer's final text first, so what goes out is exactly what they saw.
  await prisma.draft.update({
    where: { id: draft.id },
    data: {
      subject: payload.subject,
      body: payload.body,
      ...(payload.attachCaseStudyIds !== undefined
        ? { attachCaseStudyIds: payload.attachCaseStudyIds.join(',') || null }
        : {}),
      status: 'APPROVED',
      approvedAt: draft.approvedAt ?? new Date(),
      approvedById: payload.approvedById,
    },
  });

  let sent;
  try {
    sent = await sendDraft(draft.id);
  } catch (err) {
    // A permanent refusal (no credentials, suppressed address, daily cap) will fail
    // identically on every retry, so stop immediately and tell the owner.
    if (err instanceof SendError) {
      await prisma.draft.update({
        where: { id: draft.id },
        data: { status: 'NEEDS_APPROVAL', error: err.message.slice(0, 800) },
      });
      await prisma.job.update({
        where: { id: job.id },
        data: { maxAttempts: job.attempts },
      });
      await notify(
        job.ownerId,
        'SYSTEM',
        'Sending failed',
        err.message,
        '/approvals',
      );
    }
    throw err;
  }

  // Learn from any edits the reviewer made. Never let this fail the send.
  void recordFeedback({
    ownerId: draft.ownerId,
    draftId: draft.id,
    aiSubject: draft.aiSubject ?? '',
    aiBody: draft.aiBody ?? '',
    finalSubject: payload.subject,
    finalBody: payload.body,
    note: payload.feedbackNote,
  }).catch((e) => console.error('[feedback]', e));

  return { messageId: sent.messageId, emailId: sent.emailId };
}

async function handleReply(job: Job) {
  const payload = parsePayload<'PROCESS_REPLY'>(job);

  const inbound = await prisma.emailMessage.findUnique({
    where: { id: payload.emailMessageId },
    include: { replies: true },
  });
  if (!inbound) throw new Error('Inbound message no longer exists');
  // Already analysed on an earlier attempt.
  if (inbound.replies.length) return { alreadyProcessed: true };

  const { analysis, draft } = await processInboundReply(payload.emailMessageId);

  if (draft) {
    await prisma.job.update({ where: { id: job.id }, data: { draftId: draft.id } });
  }

  const sequence = await prisma.sequence.findUnique({
    where: { id: inbound.sequenceId },
    include: { institution: { select: { name: true } }, contact: true },
  });

  await notify(
    job.ownerId,
    'REPLY_RECEIVED',
    `${sequence?.contact.name || sequence?.contact.email || 'A prospect'} replied`,
    analysis.summary,
    draft ? '/approvals' : `/sequences/${inbound.sequenceId}`,
  );

  return { intent: analysis.intent, draftId: draft?.id ?? null };
}

async function recordFeedback(input: {
  ownerId: string;
  draftId: string;
  aiSubject: string;
  aiBody: string;
  finalSubject: string;
  finalBody: string;
  note?: string;
}) {
  if (input.note?.trim()) {
    await prisma.feedback.create({
      data: {
        ownerId: input.ownerId,
        draftId: input.draftId,
        agent: 'COMPOSE',
        type: 'NOTE',
        note: input.note.trim(),
        lesson: input.note.trim(),
      },
    });
  }

  if (!input.aiBody) return;

  const lesson = await distillFeedback({
    aiSubject: input.aiSubject,
    aiBody: input.aiBody,
    finalSubject: input.finalSubject,
    finalBody: input.finalBody,
  });
  if (!lesson) return;

  await prisma.feedback.create({
    data: {
      ownerId: input.ownerId,
      draftId: input.draftId,
      agent: 'COMPOSE',
      type: 'EDIT',
      originalText: input.aiBody.slice(0, 4000),
      editedText: input.finalBody.slice(0, 4000),
      lesson,
    },
  });
}

export type { JobPayloads };
