import { prisma } from '../db';
import { truncate } from '../utils';
import { chat, chatJson, type GroqResult } from './groq';
import { MODELS, envModel } from './models';
import type {
  ComposedEmail,
  InsightsResult,
  ReplyAnalysis,
  ResearchResult,
  VerificationResult,
} from './types';

/* -------------------------------------------------------------------------- */
/* Run logging                                                                 */
/* -------------------------------------------------------------------------- */

type RunCtx = { draftId?: string; sequenceId?: string };

async function logRun(
  agent: string,
  ctx: RunCtx,
  raw: GroqResult | null,
  prompt: string,
  error?: unknown,
) {
  try {
    await prisma.agentRun.create({
      data: {
        draftId: ctx.draftId ?? null,
        sequenceId: ctx.sequenceId ?? null,
        agent,
        model: raw?.model ?? 'n/a',
        status: error ? 'ERROR' : 'OK',
        promptPreview: truncate(prompt, 2000),
        outputPreview: truncate(raw?.content ?? '', 4000),
        sources: raw?.sources?.length ? JSON.stringify(raw.sources) : null,
        tokensIn: raw?.tokensIn ?? 0,
        tokensOut: raw?.tokensOut ?? 0,
        latencyMs: raw?.latencyMs ?? 0,
        error: error ? truncate(error instanceof Error ? error.message : String(error), 500) : null,
      },
    });
  } catch (e) {
    console.error('[agentRun] log failed', e);
  }
}

/* -------------------------------------------------------------------------- */
/* Feedback memory                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The learning loop. Every human edit to an AI draft and every explicit note is
 * distilled into a "lesson" and replayed into later prompts, so the agents stop
 * repeating the corrections the team already made.
 */
export async function getFeedbackContext(ownerId: string, limit = 18): Promise<string> {
  const rows = await prisma.feedback.findMany({
    where: {
      active: true,
      OR: [{ ownerId }, { global: true }],
      lesson: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  if (!rows.length) return '';
  const lines = rows.map((r) => `- ${r.lesson}`).join('\n');
  return `\nTEAM FEEDBACK — these corrections came from real human reviewers. Follow them strictly:\n${lines}\n`;
}

/**
 * Where a claim came from.
 *
 * `executed_tools` is the authoritative record of pages the model actually fetched.
 * URLs merely typed into the prose are not evidence — the model will happily write a
 * plausible-looking lpu.in/rankings that it never visited. So we only fall back to
 * scraping URLs out of the text when there is no tool trace at all, and never mix the
 * two.
 */
function mergeSources(toolSources: string[], text: string): string[] {
  if (toolSources.length) return toolSources.slice(0, 25);
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\],]+/g)) {
    out.add(m[0].replace(/[.,;]+$/, ''));
  }
  return [...out].slice(0, 25);
}

const HOUSE_STYLE = `
WRITING RULES (non-negotiable):
- Write like a knowledgeable human colleague, not a marketer. Plain, direct sentences.
- Never use: "I hope this email finds you well", "I trust this message", "reaching out", "leverage", "synergy", "in today's fast-paced world", "game-changer", "revolutionise".
- No exclamation marks. No emoji. No bold/markdown formatting — this is a plain email.
- 120-190 words for the body. Short paragraphs, max 3 sentences each.
- Open with something specific and verifiable about THIS institution. Never a generic compliment.
- One clear ask at the end, low-friction (a 15-minute call, or a yes/no question).
- Do not invent statistics, rankings, names, dates, or achievements. If unsure, leave it out.
- Do not include a signature block or "Best regards" line — the system appends the sender's signature.
`;

/* -------------------------------------------------------------------------- */
/* 1. Research agent — web search                                              */
/* -------------------------------------------------------------------------- */

export async function researchInstitution(
  input: {
    institution: string;
    website?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    type?: string | null;
    contactName?: string | null;
    contactTitle?: string | null;
    contactEmail?: string | null;
    notes?: string | null;
    offering: string;
  },
  ctx: RunCtx = {},
): Promise<ResearchResult> {
  const where = [input.city, input.state, input.country].filter(Boolean).join(', ');

  // Step 1: gather evidence with the web-search-enabled model.
  const gatherPrompt = `Research this educational institution using web search. Be factual and cite URLs.

INSTITUTION: ${input.institution}
${input.website ? `WEBSITE: ${input.website}` : ''}
${where ? `LOCATION: ${where}` : ''}
${input.type ? `TYPE: ${input.type}` : ''}
${input.contactName ? `CONTACT PERSON: ${input.contactName}${input.contactTitle ? `, ${input.contactTitle}` : ''}` : ''}

Find and report:
1. What the institution is: size, programmes offered, notable focus areas.
2. Recent developments in the last 24 months: new courses, placements, accreditations, partnerships, rankings, news.
3. Observable GAPS relative to peer institutions — specifically around student employability, industry-readiness, placement outcomes, digital/AI skills training, corporate tie-ups, and curriculum currency. For each gap, state what evidence suggests it and why the gap likely exists.
4. If a contact person is named above, verify whether that person actually holds that role at this institution right now.

Report only what you can source. Explicitly say "not found" where the web gives nothing. Include the URLs you used.
Be terse: bullet points, no preamble, under 450 words total. This report is consumed by another program, not a human.`;

  let evidence = '';
  let sources: string[] = [];
  try {
    const raw = await chat([{ role: 'user', content: gatherPrompt }], {
      model: envModel('search'),
      timeoutMs: 150_000,
    });
    evidence = raw.content;
    sources = mergeSources(raw.sources, evidence);
    await logRun('RESEARCH', ctx, raw, gatherPrompt);
  } catch (err) {
    await logRun('RESEARCH', ctx, null, gatherPrompt, err);
    evidence = 'Web research unavailable. Work only from the details supplied by the team member.';
  }

  // Step 2: structure the evidence into the schema the rest of the pipeline expects.
  const structurePrompt = `You are an outreach research analyst. Convert the research notes into strict JSON.

WHAT WE SELL: ${input.offering}

TEAM MEMBER'S NOTES (high priority — this is what they want the mail to be about):
${input.notes || '(none provided)'}

RESEARCH NOTES FROM WEB SEARCH:
${truncate(evidence, 6000)}

Return JSON exactly matching:
{
  "overview": "2-3 sentence factual description of the institution",
  "programs": ["..."],
  "recentDevelopments": ["specific, dated where possible"],
  "gaps": [{"gap":"...","evidence":"what supports this","whyItExists":"root cause","impact":"consequence for students/institution"}],
  "solutions": [{"forGap":"matching gap text","solution":"what we would actually do","proofPoint":"why it is credible"}],
  "personalizationHooks": ["specific verifiable facts usable as an email opener"],
  "contactFindings": {"nameFound":"","titleFound":"","note":"whether the named contact was confirmed"},
  "confidence": 0-100
}

Rules: 2-4 gaps. Every gap must trace to the research notes or the team member's notes — never invent one. If research was unavailable, set confidence below 35 and keep gaps generic but honest. Solutions must map to the offering above.`;

  try {
    const { data, raw } = await chatJson<ResearchResult>(
      [{ role: 'user', content: structurePrompt }],
      { model: MODELS.structurer, temperature: 0.3, maxTokens: 3000 },
    );
    await logRun('RESEARCH_STRUCTURE', ctx, raw, structurePrompt);
    return {
      ...data,
      gaps: data.gaps ?? [],
      solutions: data.solutions ?? [],
      programs: data.programs ?? [],
      recentDevelopments: data.recentDevelopments ?? [],
      personalizationHooks: data.personalizationHooks ?? [],
      contactFindings: data.contactFindings ?? {},
      sources,
      confidence: data.confidence ?? 40,
    };
  } catch (err) {
    await logRun('RESEARCH_STRUCTURE', ctx, null, structurePrompt, err);
    return {
      overview: `Research could not be completed automatically for ${input.institution}.`,
      programs: [],
      recentDevelopments: [],
      gaps: [],
      solutions: [],
      personalizationHooks: [],
      contactFindings: {},
      sources,
      confidence: 20,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* 2. Composer agent                                                           */
/* -------------------------------------------------------------------------- */

export async function composeEmail(
  input: {
    ownerId: string;
    senderName: string;
    senderOrg: string;
    institution: string;
    contactName?: string | null;
    contactTitle?: string | null;
    research: ResearchResult;
    notes?: string | null;
    template?: { subject: string; body: string; guidance?: string | null } | null;
    stage: number;
    priorMessages?: { stage: number; subject: string; body: string; sentAt?: Date | null }[];
    caseStudyTitles?: string[];
  },
  ctx: RunCtx = {},
): Promise<ComposedEmail> {
  const feedback = await getFeedbackContext(input.ownerId);
  const isFollowUp = input.stage > 0;

  const history = (input.priorMessages ?? [])
    .map(
      (m) =>
        `--- Message ${m.stage === 0 ? '(initial)' : `(follow-up ${m.stage})`}${
          m.sentAt ? ` sent ${m.sentAt.toISOString().slice(0, 10)}` : ''
        } ---\nSubject: ${m.subject}\n${truncate(m.body, 1200)}`,
    )
    .join('\n\n');

  const prompt = `You write B2B outreach emails for ${input.senderOrg}, sent by ${input.senderName}.

TARGET
Institution: ${input.institution}
Contact: ${input.contactName || 'Unknown — address the role, not a guessed name'}${
    input.contactTitle ? ` (${input.contactTitle})` : ''
  }

RESEARCH FINDINGS
Overview: ${input.research.overview}
Recent developments: ${(input.research.recentDevelopments ?? []).join(' | ') || 'none found'}
Gaps identified:
${(input.research.gaps ?? [])
  .map((g, i) => `${i + 1}. ${g.gap}\n   evidence: ${g.evidence}\n   why: ${g.whyItExists}\n   impact: ${g.impact}`)
  .join('\n') || '(none)'}
Our solutions:
${(input.research.solutions ?? [])
  .map((s) => `- ${s.solution} (addresses: ${s.forGap}; credibility: ${s.proofPoint})`)
  .join('\n') || '(none)'}
Personalization hooks: ${(input.research.personalizationHooks ?? []).join(' | ') || 'none'}

TEAM MEMBER'S BRIEF (must be honoured):
${input.notes || '(none)'}

${
  input.template
    ? `TEMPLATE TO FOLLOW — keep its structure, tone and intent, but rewrite the specifics for this institution. Do not leave any {{placeholder}} unfilled.
Subject template: ${input.template.subject}
Body template:
${input.template.body}
${input.template.guidance ? `Extra guidance: ${input.template.guidance}` : ''}`
    : 'No template supplied — write from scratch.'
}

${
  isFollowUp
    ? `THIS IS FOLLOW-UP #${input.stage}. The previous messages got no reply:

${history}

Follow-up rules:
- Do NOT restate the whole original pitch. Assume they skimmed it.
- Add ONE new piece of value not in the earlier mails (an angle, a result, a question).
- Keep it shorter than the previous message. Follow-up 1: ~90 words. Follow-up 2: ~80 words. Follow-up 3: ~60 words and offer a graceful close ("if this isn't a priority, I'll leave it here").
- Reply-style: no new greeting paragraph restating who you are; a single line of context is enough.
${input.caseStudyTitles?.length ? `- Attached case studies (reference them naturally, do not describe in detail): ${input.caseStudyTitles.join(', ')}` : ''}`
    : ''
}

${HOUSE_STYLE}
${feedback}

Return strict JSON:
{"subject":"...","body":"...","rationale":"why this angle","personalizationUsed":["specific facts used"]}

Subject line: under 60 characters, lowercase-ish and specific, no clickbait, no "Re:" prefix unless it is a follow-up.`;

  try {
    const { data, raw } = await chatJson<ComposedEmail>([{ role: 'user', content: prompt }], {
      model: envModel('writer'),
      temperature: 0.65,
      maxTokens: 4500,
    });
    await logRun('COMPOSE', ctx, raw, prompt);
    return {
      subject: (data.subject ?? '').trim(),
      body: (data.body ?? '').trim(),
      rationale: data.rationale ?? '',
      personalizationUsed: data.personalizationUsed ?? [],
    };
  } catch (err) {
    await logRun('COMPOSE', ctx, null, prompt, err);
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Verification agent — web cross-check                                     */
/* -------------------------------------------------------------------------- */

export async function verifyEmail(
  input: {
    institution: string;
    website?: string | null;
    contactName?: string | null;
    contactTitle?: string | null;
    contactEmail?: string | null;
    subject: string;
    body: string;
  },
  ctx: RunCtx = {},
): Promise<VerificationResult> {
  // Step 1: check the factual claims against live web sources.
  const checkPrompt = `You are a fact-checker. Verify every checkable claim in this outreach email using web search.

INSTITUTION NAMED IN EMAIL: ${input.institution}
${input.website ? `CLAIMED WEBSITE: ${input.website}` : ''}
RECIPIENT: ${input.contactName || '(none given)'}${input.contactTitle ? `, ${input.contactTitle}` : ''}${
    input.contactEmail ? ` <${input.contactEmail}>` : ''
  }

EMAIL SUBJECT: ${input.subject}
EMAIL BODY:
${input.body}

Verify specifically:
1. Is the institution's name spelled and formatted exactly as the institution itself uses it?
2. Does the named recipient currently hold the stated role at this institution? Search for them.
3. Every factual assertion about the institution (programmes, rankings, placements, partnerships, recent events, numbers, dates). For each: is it TRUE, UNSUPPORTED, or CONTRADICTED by sources?
4. Anything that reads as a fabricated statistic or invented achievement.

For each claim state the verdict and the URL that supports it. Be strict: if you cannot find support, say UNSUPPORTED.
Be terse: one line per claim, no preamble, under 400 words total. This report is consumed by another program, not a human.`;

  let evidence = '';
  let sources: string[] = [];
  try {
    // Verification is the safety net for the whole pipeline — a transient rate limit
    // must not silently downgrade a mail to "unverified", so give it a second go.
    let raw;
    try {
      raw = await chat([{ role: 'user', content: checkPrompt }], {
        model: envModel('search'),
        timeoutMs: 150_000,
      });
    } catch (first) {
      console.warn('[verify] first attempt failed, retrying:', first);
      await new Promise((r) => setTimeout(r, 8_000));
      raw = await chat([{ role: 'user', content: checkPrompt }], {
        model: envModel('search'),
        timeoutMs: 150_000,
      });
    }
    evidence = raw.content;
    sources = mergeSources(raw.sources, evidence);
    await logRun('VERIFY', ctx, raw, checkPrompt);
  } catch (err) {
    await logRun('VERIFY', ctx, null, checkPrompt, err);
    return {
      verdict: 'REVISE',
      confidence: 30,
      checks: [],
      corrections: [
        {
          issue: 'Automated web verification failed to run.',
          severity: 'MEDIUM',
          fix: 'Review the factual claims manually before approving.',
        },
      ],
      contactVerified: false,
      contactNotes: 'Verification agent unavailable.',
      sources: [],
    };
  }

  // Step 2: turn the findings into a structured verdict.
  const structurePrompt = `Convert these fact-check findings into strict JSON.

EMAIL UNDER REVIEW:
Subject: ${input.subject}
${input.body}

FACT-CHECK FINDINGS:
${truncate(evidence, 6000)}

Return JSON:
{
  "verdict": "PASS" | "REVISE" | "BLOCK",
  "confidence": 0-100,
  "checks": [{"claim":"...","status":"VERIFIED"|"UNVERIFIED"|"CONTRADICTED","evidence":"...","source":"url"}],
  "corrections": [{"issue":"what is wrong","severity":"LOW"|"MEDIUM"|"HIGH","fix":"precise instruction to fix it"}],
  "contactVerified": true|false,
  "contactNotes": "what was established about the recipient"
}

Verdict rules:
- BLOCK if any claim is CONTRADICTED, or the recipient demonstrably does not hold the stated role, or a statistic appears fabricated.
- REVISE if claims are UNVERIFIED, the institution name is wrong/misspelled, or wording overstates what sources support.
- PASS only when nothing needs changing.
Every correction's "fix" must be a concrete rewrite instruction, not a vague suggestion.`;

  try {
    const { data, raw } = await chatJson<VerificationResult>(
      [{ role: 'user', content: structurePrompt }],
      { model: MODELS.analyst, temperature: 0.2, maxTokens: 4000 },
    );
    await logRun('VERIFY_STRUCTURE', ctx, raw, structurePrompt);
    return {
      verdict: data.verdict ?? 'REVISE',
      confidence: data.confidence ?? 50,
      checks: data.checks ?? [],
      corrections: data.corrections ?? [],
      contactVerified: Boolean(data.contactVerified),
      contactNotes: data.contactNotes ?? '',
      sources,
    };
  } catch (err) {
    await logRun('VERIFY_STRUCTURE', ctx, null, structurePrompt, err);
    return {
      verdict: 'REVISE',
      confidence: 35,
      checks: [],
      corrections: [
        { issue: 'Could not structure verification result.', severity: 'MEDIUM', fix: 'Manual review needed.' },
      ],
      contactVerified: false,
      contactNotes: '',
      sources,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* 4. Reviser agent                                                            */
/* -------------------------------------------------------------------------- */

export async function reviseEmail(
  input: {
    ownerId: string;
    subject: string;
    body: string;
    verification: VerificationResult;
    institution: string;
  },
  ctx: RunCtx = {},
): Promise<ComposedEmail> {
  const feedback = await getFeedbackContext(input.ownerId);

  const prompt = `Fix this outreach email using the fact-checker's corrections. Change only what the corrections require — preserve the voice, structure and length everywhere else.

INSTITUTION: ${input.institution}

CURRENT EMAIL
Subject: ${input.subject}
Body:
${input.body}

CORRECTIONS TO APPLY (highest severity first):
${input.verification.corrections
  .slice()
  .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  .map((c, i) => `${i + 1}. [${c.severity}] ${c.issue}\n   FIX: ${c.fix}`)
  .join('\n') || '(none)'}

FAILED CHECKS:
${input.verification.checks
  .filter((c) => c.status !== 'VERIFIED')
  .map((c) => `- "${c.claim}" -> ${c.status}${c.evidence ? ` (${c.evidence})` : ''}`)
  .join('\n') || '(none)'}
${input.verification.contactVerified ? '' : `\nRECIPIENT NOT CONFIRMED: ${input.verification.contactNotes}\nIf the recipient's name or title cannot be confirmed, remove the specific claim about their role rather than guessing.`}

If a claim cannot be supported, delete it or soften it into a question — never replace it with a different invented fact.

${HOUSE_STYLE}
${feedback}

Return strict JSON: {"subject":"...","body":"...","rationale":"what you changed and why","personalizationUsed":["..."]}`;

  try {
    const { data, raw } = await chatJson<ComposedEmail>([{ role: 'user', content: prompt }], {
      model: envModel('writer'),
      temperature: 0.4,
      maxTokens: 4500,
    });
    await logRun('REVISE', ctx, raw, prompt);
    return {
      subject: (data.subject ?? input.subject).trim(),
      body: (data.body ?? input.body).trim(),
      rationale: data.rationale ?? '',
      personalizationUsed: data.personalizationUsed ?? [],
    };
  } catch (err) {
    await logRun('REVISE', ctx, null, prompt, err);
    throw err;
  }
}

function severityRank(s: string) {
  return s === 'HIGH' ? 3 : s === 'MEDIUM' ? 2 : 1;
}

/* -------------------------------------------------------------------------- */
/* 5. Reply agents                                                             */
/* -------------------------------------------------------------------------- */

export async function analyzeReply(
  input: { institution: string; ourLastMessage: string; replyBody: string; fromName?: string | null },
  ctx: RunCtx = {},
): Promise<ReplyAnalysis> {
  const prompt = `A prospect replied to our outreach. Analyse the reply.

INSTITUTION: ${input.institution}
FROM: ${input.fromName || 'unknown'}

OUR LAST MESSAGE:
${truncate(input.ourLastMessage, 2000)}

THEIR REPLY:
${truncate(input.replyBody, 6000)}

Return strict JSON:
{
  "summary": "2-3 sentences: what they actually said and what they want",
  "keyPoints": ["concrete points, questions or objections raised"],
  "sentiment": "POSITIVE"|"NEUTRAL"|"NEGATIVE",
  "intent": "INTERESTED"|"MEETING_REQUEST"|"QUESTION"|"NOT_INTERESTED"|"OUT_OF_OFFICE"|"UNSUBSCRIBE"|"REFERRAL"|"OTHER",
  "urgency": "LOW"|"NORMAL"|"HIGH",
  "suggestedAction": "the single next step we should take",
  "shouldStopSequence": true|false
}

shouldStopSequence must be true for NOT_INTERESTED and UNSUBSCRIBE, and for any genuine human reply (scheduled follow-ups should never keep firing at someone mid-conversation). Set it false only for automated out-of-office bounces.`;

  try {
    const { data, raw } = await chatJson<ReplyAnalysis>([{ role: 'user', content: prompt }], {
      model: MODELS.structurer,
      temperature: 0.25,
      maxTokens: 1500,
    });
    await logRun('REPLY_ANALYZE', ctx, raw, prompt);
    return {
      summary: data.summary ?? 'Reply received.',
      keyPoints: data.keyPoints ?? [],
      sentiment: data.sentiment ?? 'NEUTRAL',
      intent: data.intent ?? 'OTHER',
      urgency: data.urgency ?? 'NORMAL',
      suggestedAction: data.suggestedAction ?? 'Review and respond.',
      shouldStopSequence: data.shouldStopSequence ?? true,
    };
  } catch (err) {
    await logRun('REPLY_ANALYZE', ctx, null, prompt, err);
    return {
      summary: 'A reply was received but could not be analysed automatically.',
      keyPoints: [],
      sentiment: 'NEUTRAL',
      intent: 'OTHER',
      urgency: 'NORMAL',
      suggestedAction: 'Read the reply and respond manually.',
      shouldStopSequence: true,
    };
  }
}

export async function draftReplyResponse(
  input: {
    ownerId: string;
    senderName: string;
    senderOrg: string;
    institution: string;
    contactName?: string | null;
    analysis: ReplyAnalysis;
    replyBody: string;
    threadHistory: { stage: number; direction: string; subject: string; body: string }[];
    template?: { subject: string; body: string; guidance?: string | null } | null;
    research?: ResearchResult | null;
  },
  ctx: RunCtx = {},
): Promise<ComposedEmail> {
  const feedback = await getFeedbackContext(input.ownerId);

  const history = input.threadHistory
    .map(
      (m) =>
        `[${m.direction === 'OUT' ? 'US' : 'THEM'}] ${m.subject}\n${truncate(m.body, 900)}`,
    )
    .join('\n\n');

  const prompt = `Write a reply to a prospect, sent by ${input.senderName} of ${input.senderOrg}.

INSTITUTION: ${input.institution}
CONTACT: ${input.contactName || 'unknown'}

THREAD SO FAR:
${history}

THEIR LATEST REPLY:
${truncate(input.replyBody, 4000)}

ANALYSIS
Summary: ${input.analysis.summary}
Their intent: ${input.analysis.intent} (sentiment ${input.analysis.sentiment})
Points raised: ${input.analysis.keyPoints.join(' | ') || 'none'}
Recommended next step: ${input.analysis.suggestedAction}

${input.research ? `WHAT WE CAN OFFER THEM:\n${(input.research.solutions ?? []).map((s) => `- ${s.solution}`).join('\n')}` : ''}
${input.template ? `REPLY TEMPLATE TO ADAPT:\n${input.template.body}` : ''}

Reply rules:
- Answer every question they asked, directly and in order. Do not dodge.
- If they raised an objection, address it honestly; concede the point where it is fair.
- If they asked for a meeting, propose two concrete slots and offer to work around them.
- If they said no, accept it gracefully in two sentences and leave the door open. Do not pitch again.
- Match their register: if their reply was two lines, yours should be short too.
- Never claim a capability or result that isn't supported by the thread or the offer above.

${HOUSE_STYLE}
${feedback}

Return strict JSON: {"subject":"...","body":"...","rationale":"...","personalizationUsed":[]}
The subject should keep the thread: reuse their subject line, prefixed with "Re: " if not already present.`;

  try {
    const { data, raw } = await chatJson<ComposedEmail>([{ role: 'user', content: prompt }], {
      model: envModel('writer'),
      temperature: 0.55,
      maxTokens: 4000,
    });
    await logRun('REPLY_DRAFT', ctx, raw, prompt);
    return {
      subject: (data.subject ?? '').trim(),
      body: (data.body ?? '').trim(),
      rationale: data.rationale ?? '',
      personalizationUsed: data.personalizationUsed ?? [],
    };
  } catch (err) {
    await logRun('REPLY_DRAFT', ctx, null, prompt, err);
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* 6. Insights agent                                                           */
/* -------------------------------------------------------------------------- */

export async function generateInsights(
  stats: Record<string, unknown>,
  scope: string,
): Promise<InsightsResult> {
  const prompt = `You are a cold-email performance analyst. Analyse these outreach statistics and give specific, actionable advice.

SCOPE: ${scope}

STATS:
${JSON.stringify(stats, null, 2)}

Industry benchmarks for cold B2B education-sector outreach: open rate 35-50%, reply rate 5-12%, positive reply rate 2-5%, bounce rate under 3%. Most replies arrive on follow-up 1 or 2, not the initial mail.

Return strict JSON:
{
  "headline": "one sentence verdict on how this is going",
  "strengths": ["what is genuinely working, tied to a number"],
  "problems": [{"issue":"...","evidence":"the number that shows it","severity":"LOW"|"MEDIUM"|"HIGH"}],
  "recommendations": [{"action":"specific thing to change","why":"the reasoning","expectedImpact":"realistic outcome"}],
  "benchmark": "how this compares to the benchmarks above"
}

Rules: every claim must cite an actual number from the stats. If sample size is too small (under 20 sent) say so plainly and keep advice provisional. 3-5 recommendations, ordered by expected impact. No generic advice like "personalise more" — say exactly what to change.`;

  const { data } = await chatJson<InsightsResult>([{ role: 'user', content: prompt }], {
    model: MODELS.structurer,
    temperature: 0.4,
    maxTokens: 2500,
  });
  return {
    headline: data.headline ?? '',
    strengths: data.strengths ?? [],
    problems: data.problems ?? [],
    recommendations: data.recommendations ?? [],
    benchmark: data.benchmark ?? '',
  };
}

/* -------------------------------------------------------------------------- */
/* 7. Feedback distillation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * When a reviewer edits an AI draft before approving, we ask the model what the
 * human actually changed and turn it into a reusable rule for future drafts.
 */
export async function distillFeedback(input: {
  aiSubject: string;
  aiBody: string;
  finalSubject: string;
  finalBody: string;
}): Promise<string | null> {
  if (input.aiBody.trim() === input.finalBody.trim() && input.aiSubject.trim() === input.finalSubject.trim()) {
    return null;
  }

  const prompt = `A human reviewer edited an AI-written outreach email before sending it. Work out what rule the AI should learn.

AI VERSION
Subject: ${input.aiSubject}
${truncate(input.aiBody, 4000)}

HUMAN-EDITED VERSION (what actually got sent)
Subject: ${input.finalSubject}
${truncate(input.finalBody, 4000)}

Return strict JSON: {"lesson": "one imperative sentence the AI should follow next time", "significant": true|false}

Set significant=false for trivial edits (a typo, one word swapped, whitespace). Only set true when there is a transferable writing lesson. The lesson must be specific and actionable — "open with the recipient's own recent announcement rather than a compliment", not "write better".`;

  try {
    const { data } = await chatJson<{ lesson: string; significant: boolean }>(
      [{ role: 'user', content: prompt }],
      { model: MODELS.utility, temperature: 0.3, maxTokens: 600 },
    );
    if (!data.significant || !data.lesson) return null;
    return data.lesson.trim();
  } catch {
    return null;
  }
}
