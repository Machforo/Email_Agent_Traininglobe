import { randomToken } from '../crypto';
import { prisma } from '../db';
import { getSettings, settingBool } from '../settings';
import { notify } from '../api';
import { renderEmail, threadSubject } from './render';
import { credentialsFor, friendlySmtpError, sendMail } from './smtp';

export class SendError extends Error {
  code: string;
  constructor(message: string, code = 'SEND_FAILED') {
    super(message);
    this.code = code;
    this.name = 'SendError';
  }
}

/**
 * Sends an approved draft.
 *
 * Guards applied before anything leaves the machine: the sender must have working
 * credentials, the recipient must not be suppressed, and the user's daily cap must
 * not be exceeded. On success we record the outbound message so follow-ups can
 * thread off it and analytics can attribute opens and replies.
 */
export async function sendDraft(draftId: string): Promise<{ messageId: string; emailId: string }> {
  const draft = await prisma.draft.findUniqueOrThrow({
    where: { id: draftId },
    include: {
      owner: true,
      sequence: { include: { institution: true, contact: true, messages: true } },
    },
  });

  if (draft.status === 'SENT') {
    throw new SendError('This draft has already been sent.', 'ALREADY_SENT');
  }

  const { owner, sequence } = draft;
  const contact = sequence.contact;
  const settings = await getSettings();

  const creds = credentialsFor(owner);
  if (!creds) {
    throw new SendError(
      'No sending credentials on file. Add your Gmail app password in Settings before sending.',
      'NO_CREDENTIALS',
    );
  }

  // Never mail someone who opted out or hard-bounced.
  const suppressed = await prisma.suppression.findUnique({
    where: { email: contact.email.toLowerCase() },
  });
  if (suppressed) {
    throw new SendError(
      `${contact.email} is on the suppression list (${suppressed.reason.toLowerCase()}).`,
      'SUPPRESSED',
    );
  }

  // Daily cap, counted per sender over the last 24h.
  const since = new Date(Date.now() - 86_400_000);
  const sentToday = await prisma.emailMessage.count({
    where: { ownerId: owner.id, direction: 'OUT', sentAt: { gte: since } },
  });
  if (sentToday >= owner.dailySendLimit) {
    throw new SendError(
      `Daily sending limit reached (${owner.dailySendLimit} mails in 24h). This protects the account from Gmail throttling.`,
      'DAILY_LIMIT',
    );
  }

  const trackingId = randomToken(18);

  const rendered = renderEmail({
    bodyText: draft.body,
    signature: owner.signature,
    trackingId,
    trackOpens: settingBool(settings.trackOpens, true),
    trackClicks: settingBool(settings.trackClicks, true),
    unsubscribeFooter: settingBool(settings.unsubscribeFooter, true),
  });

  // Thread follow-ups and replies onto the original conversation.
  const priorOut = sequence.messages
    .filter((m) => m.direction === 'OUT' && m.messageId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const rootId = sequence.rootMessageId ?? priorOut[0]?.messageId ?? null;

  let inReplyTo: string | null = null;
  let references: string | null = null;

  if (draft.kind === 'REPLY' && draft.replyToMessageId) {
    const inbound = await prisma.emailMessage.findUnique({ where: { id: draft.replyToMessageId } });
    inReplyTo = inbound?.messageId ?? null;
    references = [rootId, inbound?.messageId].filter(Boolean).join(' ') || null;
  } else if (priorOut.length) {
    inReplyTo = priorOut[priorOut.length - 1]!.messageId;
    references = priorOut.map((m) => m.messageId).filter(Boolean).join(' ') || null;
  }

  const subject =
    draft.kind === 'FOLLOWUP'
      ? threadSubject(sequence.lastSubject ?? draft.subject, draft.stage)
      : draft.subject;

  const attachments = await loadAttachments(draft.attachCaseStudyIds);

  let result;
  try {
    result = await sendMail(creds, {
      to: contact.email,
      toName: contact.name,
      subject,
      text: rendered.text,
      html: rendered.html,
      inReplyTo,
      references,
      attachments,
      listUnsubscribe: rendered.unsubscribeUrl,
    });
  } catch (err) {
    const message = friendlySmtpError(err instanceof Error ? err.message : String(err));
    await prisma.draft.update({
      where: { id: draft.id },
      data: { status: 'FAILED', error: message.slice(0, 800) },
    });
    throw new SendError(message);
  }

  const email = await prisma.emailMessage.create({
    data: {
      sequenceId: sequence.id,
      ownerId: owner.id,
      direction: 'OUT',
      stage: draft.stage,
      status: 'SENT',
      messageId: result.messageId,
      inReplyTo,
      references,
      fromEmail: creds.email,
      toEmail: contact.email,
      subject,
      bodyText: rendered.text,
      bodyHtml: rendered.html,
      attachmentsJson: attachments.length
        ? JSON.stringify(attachments.map((a) => a.filename))
        : null,
      sentAt: new Date(),
      trackingId,
    },
  });

  await prisma.draft.update({
    where: { id: draft.id },
    data: { status: 'SENT', subject },
  });

  // Advance the sequence: schedule the next follow-up, or close it out.
  const isReply = draft.kind === 'REPLY';
  const nextStage = isReply ? sequence.currentStage : draft.stage + 1;
  const hasMoreFollowUps = nextStage <= sequence.maxFollowUps;
  const nextActionAt =
    !isReply && hasMoreFollowUps
      ? new Date(Date.now() + sequence.followUpDays * 86_400_000)
      : null;

  await prisma.sequence.update({
    where: { id: sequence.id },
    data: {
      status: isReply ? 'ACTIVE' : hasMoreFollowUps ? 'ACTIVE' : 'COMPLETED',
      currentStage: nextStage,
      nextActionAt,
      rootMessageId: rootId ?? result.messageId,
      lastSubject: sequence.lastSubject ?? subject,
    },
  });

  await prisma.institution.update({
    where: { id: sequence.institutionId },
    data: {
      status:
        sequence.institution.status === 'NEW' || sequence.institution.status === 'RESEARCHED'
          ? 'ACTIVE'
          : sequence.institution.status,
    },
  });

  if (isReply && draft.replyToMessageId) {
    await prisma.reply.updateMany({
      where: { emailMessageId: draft.replyToMessageId },
      data: { handled: true },
    });
  }

  return { messageId: result.messageId, emailId: email.id };
}

/**
 * Case-study files live in the database, not on disk: the worker that sends the mail
 * runs on a different host from the app that received the upload, and neither has a
 * filesystem the other can read.
 */
async function loadAttachments(csv: string | null) {
  if (!csv) return [];
  const ids = csv.split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return [];
  const rows = await prisma.caseStudy.findMany({ where: { id: { in: ids } } });
  return rows.map((c) => ({
    filename: c.fileName,
    content: Buffer.from(c.data),
    contentType: c.mimeType,
  }));
}

/** Marks a message as bounced and suppresses the address on a hard bounce. */
export async function recordBounce(
  emailMessageId: string,
  type: 'HARD' | 'SOFT',
  reason: string,
) {
  const message = await prisma.emailMessage.update({
    where: { id: emailMessageId },
    data: { status: 'BOUNCED', bounceType: type, bounceReason: reason.slice(0, 500) },
    include: { sequence: { include: { institution: true } } },
  });

  if (type === 'HARD') {
    await prisma.suppression.upsert({
      where: { email: message.toEmail.toLowerCase() },
      create: { email: message.toEmail.toLowerCase(), reason: 'HARD_BOUNCE', note: reason.slice(0, 300) },
      update: {},
    });
    await prisma.sequence.update({
      where: { id: message.sequenceId },
      data: { status: 'BOUNCED', nextActionAt: null, stoppedReason: 'Hard bounce' },
    });
    await prisma.institution.update({
      where: { id: message.sequence.institutionId },
      data: { status: 'BOUNCED' },
    });
  }

  await notify(
    message.ownerId,
    'BOUNCE',
    `Mail to ${message.toEmail} bounced`,
    reason.slice(0, 200),
    `/sequences/${message.sequenceId}`,
  );

  return message;
}
