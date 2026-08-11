import { prisma } from '../db';
import { getSettings, settingNumber } from '../settings';
import { renderTemplate } from '../utils';
import {
  analyzeReply,
  composeEmail,
  draftReplyResponse,
  researchInstitution,
  reviseEmail,
  verifyEmail,
} from './agents';
import type { ResearchResult, VerificationResult } from './types';

/**
 * The cascade, wired to the database.
 *
 *   Research (web)  ->  Compose  ->  Verify (web fact-check)  ->  Revise  ->  human approval
 *
 * Each stage persists its artefacts on the Draft row so the reviewer can see exactly
 * what the agents found and changed before they approve.
 */

type PipelineOptions = {
  templateId?: string | null;
  caseStudyIds?: string[];
  forceResearch?: boolean;
};

export async function generateDraftForSequence(
  sequenceId: string,
  stage: number,
  opts: PipelineOptions = {},
) {
  const settings = await getSettings();
  const maxLoops = settingNumber(settings.maxRevisionLoops, 2);

  const sequence = await prisma.sequence.findUniqueOrThrow({
    where: { id: sequenceId },
    include: {
      institution: true,
      contact: true,
      owner: true,
      messages: { where: { direction: 'OUT' }, orderBy: { createdAt: 'asc' } },
    },
  });

  const { institution, contact, owner } = sequence;

  // A draft row is created up-front so the UI can show "generating" state and so
  // every agent run has something to attach to.
  const draft = await prisma.draft.create({
    data: {
      sequenceId,
      ownerId: sequence.ownerId,
      kind: stage === 0 ? 'OUTREACH' : 'FOLLOWUP',
      stage,
      status: 'GENERATING',
      templateId: opts.templateId ?? null,
      attachCaseStudyIds: opts.caseStudyIds?.length ? opts.caseStudyIds.join(',') : null,
    },
  });

  const ctx = { draftId: draft.id, sequenceId };

  try {
    /* ---- 1. Research (cached on the institution unless forced or stale) ---- */
    let research: ResearchResult | null = null;
    const cacheAgeDays = institution.researchedAt
      ? (Date.now() - institution.researchedAt.getTime()) / 86_400_000
      : Infinity;

    if (!opts.forceResearch && institution.researchJson && cacheAgeDays < 30) {
      try {
        research = JSON.parse(institution.researchJson) as ResearchResult;
      } catch {
        research = null;
      }
    }

    if (!research) {
      research = await researchInstitution(
        {
          institution: institution.name,
          website: institution.website,
          city: institution.city,
          state: institution.state,
          country: institution.country,
          type: institution.type,
          contactName: contact.name,
          contactTitle: contact.title,
          contactEmail: contact.email,
          notes: institution.notes,
          offering: settings.offering,
        },
        ctx,
      );
      await prisma.institution.update({
        where: { id: institution.id },
        data: {
          researchJson: JSON.stringify(research),
          researchedAt: new Date(),
          status: institution.status === 'NEW' ? 'RESEARCHED' : institution.status,
        },
      });
    }

    await prisma.draft.update({
      where: { id: draft.id },
      data: { researchSummary: JSON.stringify(research) },
    });

    /* ---- 2. Compose ---- */
    const template = opts.templateId
      ? await prisma.template.findUnique({ where: { id: opts.templateId } })
      : await pickTemplate(sequence.ownerId, stage);

    const caseStudies = opts.caseStudyIds?.length
      ? await prisma.caseStudy.findMany({ where: { id: { in: opts.caseStudyIds } } })
      : [];

    const vars = templateVars({
      institution: institution.name,
      contactName: contact.name,
      contactTitle: contact.title,
      city: institution.city,
      senderName: owner.name,
      orgName: settings.orgName,
    });

    let composed = await composeEmail(
      {
        ownerId: sequence.ownerId,
        senderName: owner.name,
        senderOrg: settings.orgName,
        institution: institution.name,
        contactName: contact.name,
        contactTitle: contact.title,
        research,
        notes: institution.notes,
        template: template
          ? {
              subject: renderTemplate(template.subject, vars),
              body: renderTemplate(template.body, vars),
              guidance: template.guidance,
            }
          : null,
        stage,
        priorMessages: sequence.messages.map((m) => ({
          stage: m.stage,
          subject: m.subject,
          body: m.bodyText,
          sentAt: m.sentAt,
        })),
        caseStudyTitles: caseStudies.map((c) => c.title),
      },
      ctx,
    );

    if (template) {
      await prisma.template.update({
        where: { id: template.id },
        data: { useCount: { increment: 1 } },
      });
    }

    const aiSubject = composed.subject;
    const aiBody = composed.body;

    /* ---- 3. Verify -> 4. Revise (loop) ---- */
    let verification: VerificationResult | null = null;
    let revisions = 0;

    for (let i = 0; i <= maxLoops; i++) {
      verification = await verifyEmail(
        {
          institution: institution.name,
          website: institution.website,
          contactName: contact.name,
          contactTitle: contact.title,
          contactEmail: contact.email,
          subject: composed.subject,
          body: composed.body,
        },
        ctx,
      );

      if (verification.verdict === 'PASS' || i === maxLoops) break;

      composed = await reviseEmail(
        {
          ownerId: sequence.ownerId,
          subject: composed.subject,
          body: composed.body,
          verification,
          institution: institution.name,
        },
        ctx,
      );
      revisions++;
    }

    // Persist what the verifier established about the human contact.
    if (verification) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          verified: verification.contactVerified,
          verifiedAt: new Date(),
          verificationNotes: verification.contactNotes,
        },
      });
    }

    const updated = await prisma.draft.update({
      where: { id: draft.id },
      data: {
        subject: composed.subject,
        body: composed.body,
        aiSubject,
        aiBody,
        verificationJson: verification ? JSON.stringify(verification) : null,
        confidence: verification?.confidence ?? 0,
        revisionCount: revisions,
        templateId: template?.id ?? null,
        status: 'NEEDS_APPROVAL',
      },
    });

    await prisma.sequence.update({
      where: { id: sequenceId },
      data: { status: 'PENDING_APPROVAL' },
    });

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.draft.update({
      where: { id: draft.id },
      data: { status: 'FAILED', error: message.slice(0, 800) },
    });
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Reply handling                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Called when the IMAP poller finds an inbound message on a sequence: summarise it,
 * stop the follow-up clock, and prepare a response for human approval.
 */
export async function processInboundReply(emailMessageId: string) {
  const inbound = await prisma.emailMessage.findUniqueOrThrow({
    where: { id: emailMessageId },
    include: {
      sequence: {
        include: {
          institution: true,
          contact: true,
          owner: true,
          messages: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });

  const seq = inbound.sequence;
  const lastOut = [...seq.messages].reverse().find((m) => m.direction === 'OUT');

  const analysis = await analyzeReply(
    {
      institution: seq.institution.name,
      ourLastMessage: lastOut?.bodyText ?? '',
      replyBody: inbound.bodyText,
      fromName: seq.contact.name,
    },
    { sequenceId: seq.id },
  );

  const reply = await prisma.reply.create({
    data: {
      sequenceId: seq.id,
      emailMessageId: inbound.id,
      summary: analysis.summary,
      keyPoints: JSON.stringify(analysis.keyPoints),
      sentiment: analysis.sentiment,
      intent: analysis.intent,
      urgency: analysis.urgency,
      suggestedAction: analysis.suggestedAction,
    },
  });

  // An out-of-office shouldn't derail the sequence; anything else should.
  if (analysis.shouldStopSequence) {
    await prisma.sequence.update({
      where: { id: seq.id },
      data: {
        status: 'REPLIED',
        nextActionAt: null,
      },
    });
    await prisma.institution.update({
      where: { id: seq.institutionId },
      data: {
        status:
          analysis.intent === 'NOT_INTERESTED' || analysis.intent === 'UNSUBSCRIBE'
            ? 'LOST'
            : 'ENGAGED',
      },
    });
  }

  if (analysis.intent === 'UNSUBSCRIBE') {
    await prisma.suppression.upsert({
      where: { email: seq.contact.email.toLowerCase() },
      create: { email: seq.contact.email.toLowerCase(), reason: 'UNSUBSCRIBE' },
      update: {},
    });
    return { reply, analysis, draft: null };
  }

  // No point drafting a reply to an auto-responder or a hard no.
  if (analysis.intent === 'OUT_OF_OFFICE' || analysis.intent === 'NOT_INTERESTED') {
    return { reply, analysis, draft: null };
  }

  const settings = await getSettings();
  const template = await pickTemplate(seq.ownerId, -1); // -1 => REPLY stage template

  let research: ResearchResult | null = null;
  try {
    research = seq.institution.researchJson
      ? (JSON.parse(seq.institution.researchJson) as ResearchResult)
      : null;
  } catch {
    research = null;
  }

  const draft = await prisma.draft.create({
    data: {
      sequenceId: seq.id,
      ownerId: seq.ownerId,
      kind: 'REPLY',
      stage: seq.currentStage,
      status: 'GENERATING',
      replyToMessageId: inbound.id,
      templateId: template?.id ?? null,
    },
  });

  try {
    const composed = await draftReplyResponse(
      {
        ownerId: seq.ownerId,
        senderName: seq.owner.name,
        senderOrg: settings.orgName,
        institution: seq.institution.name,
        contactName: seq.contact.name,
        analysis,
        replyBody: inbound.bodyText,
        threadHistory: seq.messages.map((m) => ({
          stage: m.stage,
          direction: m.direction,
          subject: m.subject,
          body: m.bodyText,
        })),
        template: template
          ? { subject: template.subject, body: template.body, guidance: template.guidance }
          : null,
        research,
      },
      { draftId: draft.id, sequenceId: seq.id },
    );

    const saved = await prisma.draft.update({
      where: { id: draft.id },
      data: {
        subject: composed.subject || `Re: ${inbound.subject.replace(/^re:\s*/i, '')}`,
        body: composed.body,
        aiSubject: composed.subject,
        aiBody: composed.body,
        status: 'NEEDS_APPROVAL',
        confidence: 70,
      },
    });

    return { reply, analysis, draft: saved };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.draft.update({
      where: { id: draft.id },
      data: { status: 'FAILED', error: message.slice(0, 800) },
    });
    return { reply, analysis, draft: null };
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const STAGE_NAMES = ['INITIAL', 'FOLLOWUP_1', 'FOLLOWUP_2', 'FOLLOWUP_3'];

export function stageName(stage: number): string {
  if (stage < 0) return 'REPLY';
  return STAGE_NAMES[stage] ?? 'FOLLOWUP_3';
}

/** Prefer the user's own active template for the stage, else a shared one. */
async function pickTemplate(ownerId: string, stage: number) {
  const name = stageName(stage);
  return (
    (await prisma.template.findFirst({
      where: { ownerId, stage: name, isActive: true },
      orderBy: { updatedAt: 'desc' },
    })) ??
    (await prisma.template.findFirst({
      where: { isShared: true, stage: name, isActive: true },
      orderBy: { updatedAt: 'desc' },
    }))
  );
}

export function templateVars(input: {
  institution: string;
  contactName?: string | null;
  contactTitle?: string | null;
  city?: string | null;
  senderName: string;
  orgName: string;
}): Record<string, string> {
  const first = input.contactName?.trim().split(/\s+/)[0] ?? '';
  return {
    institution: input.institution,
    institution_name: input.institution,
    contact_name: input.contactName ?? '',
    first_name: first,
    contact_title: input.contactTitle ?? '',
    city: input.city ?? '',
    sender_name: input.senderName,
    my_name: input.senderName,
    org_name: input.orgName,
    company: input.orgName,
  };
}
