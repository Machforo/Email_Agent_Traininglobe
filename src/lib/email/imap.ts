import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { prisma } from '../db';
import { htmlToText } from '../utils';
import { enqueue } from '../jobs/queue';
import { recordBounce } from './send';
import { credentialsFor } from './smtp';
import type { User } from '@/generated/prisma/client';

/**
 * Reply + bounce detection over IMAP.
 *
 * We never mark anything as seen or move mail — the member's real inbox stays exactly
 * as they left it.
 *
 * Two things this has to get right on a real mailbox (the test account has ~37,000
 * messages):
 *
 *  1. **Incremental.** We remember the highest UID seen per user and only ask for
 *     what arrived since. Re-scanning a fortnight every five minutes pulled ~2,900
 *     full message bodies per poll, which blocked the cron loop and eventually timed
 *     the socket out.
 *  2. **Envelope first.** Headers are cheap, full bodies are not. We fetch envelopes,
 *     keep only messages that could plausibly be a reply from a live prospect or a
 *     bounce notice, and download bodies for just those.
 */

/** Only used the very first time we poll a mailbox, before we have a UID watermark. */
const FIRST_RUN_LOOKBACK_DAYS = 3;

/** Hard ceiling on bodies downloaded in a single poll, so one cycle can't run away. */
const MAX_BODIES_PER_POLL = 40;

export type PollSummary = {
  userId: string;
  scanned: number;
  replies: number;
  bounces: number;
  errors: string[];
};

/** Watermark so each poll only looks at genuinely new mail. */
type UidState = { uid: number; uidValidity: string };

async function readUidState(userId: string): Promise<UidState | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: uidKey(userId) } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as UidState;
  } catch {
    return null;
  }
}

async function writeUidState(userId: string, state: UidState) {
  await prisma.systemSetting.upsert({
    where: { key: uidKey(userId) },
    create: { key: uidKey(userId), value: JSON.stringify(state) },
    update: { value: JSON.stringify(state) },
  });
}

function uidKey(userId: string) {
  return `imap:uid:${userId}`;
}

export async function pollMailbox(user: User): Promise<PollSummary> {
  const summary: PollSummary = { userId: user.id, scanned: 0, replies: 0, bounces: 0, errors: [] };

  const creds = credentialsFor(user);
  if (!creds) {
    summary.errors.push('No IMAP credentials configured');
    return summary;
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
    // Without these a stalled connection hangs until the OS gives up.
    greetingTimeout: 15_000,
    socketTimeout: 90_000,
  });

  // ImapFlow reports socket failures by emitting an 'error' event, not by rejecting
  // the pending promise. With no listener Node treats it as an unhandled 'error' and
  // terminates the process — which is exactly how the worker died. Swallow it here and
  // let the surrounding try/catch deal with whatever operation was in flight.
  client.on('error', (err: unknown) => {
    summary.errors.push(`imap: ${err instanceof Error ? err.message : String(err)}`);
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailbox = client.mailbox;
      const uidValidity =
        mailbox && typeof mailbox !== 'boolean' ? String(mailbox.uidValidity ?? '') : '';

      const saved = await readUidState(user.id);
      // If the server reset UIDVALIDITY every stored UID is meaningless — start over.
      const watermark = saved && saved.uidValidity === uidValidity ? saved.uid : 0;

      const range = watermark
        ? { uid: `${watermark + 1}:*` }
        : { since: new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 86_400_000) };

      // Addresses worth opening: people we are actually in conversation with.
      const liveContacts = await liveContactEmails(user.id);

      let highestUid = watermark;
      const candidates: number[] = [];

      for await (const msg of client.fetch(range, { envelope: true, uid: true })) {
        // A `N:*` range always yields at least the newest message, even when nothing
        // is new, so re-check the watermark rather than trusting the range.
        if (msg.uid <= watermark) continue;

        summary.scanned++;
        if (msg.uid > highestUid) highestUid = msg.uid;

        const from = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? '';
        const subject = msg.envelope?.subject ?? '';
        if (!from) continue;
        if (from === user.smtpEmail?.toLowerCase()) continue;

        if (liveContacts.has(from) || looksLikeBounce(from, subject)) {
          candidates.push(msg.uid);
        }
      }

      for (const uid of candidates.slice(0, MAX_BODIES_PER_POLL)) {
        try {
          const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!message || typeof message === 'boolean' || !message.source) continue;

          const parsed = await simpleParser(message.source);
          const outcome = await ingestMessage(user, parsed);
          if (outcome === 'REPLY') summary.replies++;
          else if (outcome === 'BOUNCE') summary.bounces++;
        } catch (err) {
          summary.errors.push(err instanceof Error ? err.message : String(err));
        }
      }

      if (highestUid > watermark) {
        await writeUidState(user.id, { uid: highestUid, uidValidity });
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    try {
      await client.logout();
    } catch {
      /* connection already gone */
    }
  }

  return summary;
}

/**
 * Addresses we are mid-conversation with. Anything else in the inbox is somebody
 * else's mail and none of our business, so we never open it.
 */
async function liveContactEmails(userId: string): Promise<Set<string>> {
  const sequences = await prisma.sequence.findMany({
    where: {
      ownerId: userId,
      status: { in: ['ACTIVE', 'PENDING_APPROVAL', 'REPLIED'] },
    },
    select: { contact: { select: { email: true } } },
  });
  return new Set(sequences.map((s) => s.contact.email.toLowerCase()));
}

function looksLikeBounce(fromAddr: string, subject: string): boolean {
  if (/mailer-daemon|postmaster/i.test(fromAddr)) return true;
  return /^(undeliverable|delivery status notification|mail delivery|returned mail|delivery failure)/i.test(
    subject,
  );
}

type Outcome = 'REPLY' | 'BOUNCE' | 'IGNORED';

async function ingestMessage(user: User, parsed: ParsedMail): Promise<Outcome> {
  const messageId = parsed.messageId ?? null;
  if (!messageId) return 'IGNORED';

  // Already ingested (also covers our own sent copies).
  const existing = await prisma.emailMessage.findUnique({ where: { messageId } });
  if (existing) return 'IGNORED';

  const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase() ?? '';
  if (!fromAddr) return 'IGNORED';

  // Ignore our own outgoing mail reflected back by Gmail.
  if (fromAddr === user.smtpEmail?.toLowerCase()) return 'IGNORED';

  const bodyText =
    parsed.text?.trim() || (parsed.html ? htmlToText(String(parsed.html)) : '') || '';

  /* ---- Bounce notifications ---- */
  if (isBounce(parsed, fromAddr)) {
    const target = await matchBounceTarget(user.id, parsed, bodyText);
    if (!target) return 'IGNORED';
    const hard = /5\.\d\.\d|550|551|553|does not exist|user unknown|no such user/i.test(bodyText);
    await recordBounce(target.id, hard ? 'HARD' : 'SOFT', firstLines(bodyText, 3));
    return 'BOUNCE';
  }

  /* ---- Genuine replies ---- */
  const sequence = await matchSequence(user.id, parsed, fromAddr);
  if (!sequence) return 'IGNORED';

  const inbound = await prisma.emailMessage.create({
    data: {
      sequenceId: sequence.id,
      ownerId: user.id,
      direction: 'IN',
      stage: sequence.currentStage,
      status: 'SENT',
      messageId,
      inReplyTo: parsed.inReplyTo ?? null,
      references: normalizeReferences(parsed.references),
      fromEmail: fromAddr,
      toEmail: user.smtpEmail ?? '',
      subject: parsed.subject ?? '(no subject)',
      bodyText,
      bodyHtml: parsed.html ? String(parsed.html) : null,
      receivedAt: parsed.date ?? new Date(),
    },
  });

  // Hand the AI work to the queue. Analysing and drafting a response takes a minute or
  // more; doing it inline would stall the mailbox scan and risk an IMAP socket timeout,
  // which is what used to kill this process.
  await enqueue(
    'PROCESS_REPLY',
    user.id,
    { emailMessageId: inbound.id },
    { sequenceId: sequence.id },
  );

  return 'REPLY';
}

function isBounce(parsed: ParsedMail, fromAddr: string): boolean {
  if (/mailer-daemon|postmaster|no-?reply@.*(google|gmail)/i.test(fromAddr)) return true;
  const contentType = parsed.headers.get('content-type');
  const ctValue =
    typeof contentType === 'object' && contentType && 'value' in contentType
      ? String((contentType as { value: string }).value)
      : '';
  if (/multipart\/report/i.test(ctValue)) return true;
  const subject = parsed.subject ?? '';
  return /^(undeliverable|delivery status notification|mail delivery|returned mail|delivery failure)/i.test(
    subject,
  );
}

/** Find which of our sent messages a bounce refers to, by scanning it for the address. */
async function matchBounceTarget(userId: string, parsed: ParsedMail, bodyText: string) {
  const haystack = `${parsed.subject ?? ''}\n${bodyText}`;
  const candidates = await prisma.emailMessage.findMany({
    where: { ownerId: userId, direction: 'OUT', status: 'SENT' },
    orderBy: { sentAt: 'desc' },
    take: 200,
  });
  // Prefer a Message-ID match, fall back to the recipient address appearing in the report.
  return (
    candidates.find((m) => m.messageId && haystack.includes(m.messageId)) ??
    candidates.find((m) => haystack.toLowerCase().includes(m.toEmail.toLowerCase())) ??
    null
  );
}

/**
 * Attach an inbound mail to a sequence: first by RFC threading headers (reliable),
 * then by sender address against an in-flight sequence (covers clients that drop
 * References, and people replying from an alias).
 */
async function matchSequence(userId: string, parsed: ParsedMail, fromAddr: string) {
  const refs = new Set<string>();
  if (parsed.inReplyTo) {
    for (const r of parsed.inReplyTo.split(/\s+/)) if (r) refs.add(r.trim());
  }
  const rawRefs = parsed.references;
  if (rawRefs) {
    const list = Array.isArray(rawRefs) ? rawRefs : rawRefs.split(/\s+/);
    for (const r of list) if (r) refs.add(r.trim());
  }

  if (refs.size) {
    const match = await prisma.emailMessage.findFirst({
      where: { ownerId: userId, direction: 'OUT', messageId: { in: [...refs] } },
      orderBy: { sentAt: 'desc' },
      include: { sequence: true },
    });
    if (match) return match.sequence;
  }

  return prisma.sequence.findFirst({
    where: {
      ownerId: userId,
      status: { in: ['ACTIVE', 'PENDING_APPROVAL', 'REPLIED'] },
      contact: { email: { equals: fromAddr } },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

function normalizeReferences(refs: string | string[] | undefined): string | null {
  if (!refs) return null;
  return Array.isArray(refs) ? refs.join(' ') : refs;
}

function firstLines(text: string, n: number): string {
  return text.split('\n').filter(Boolean).slice(0, n).join(' ').slice(0, 400);
}

/** Poll every member who has credentials configured. */
export async function pollAllMailboxes(): Promise<PollSummary[]> {
  const users = await prisma.user.findMany({
    where: { active: true, smtpEmail: { not: null }, smtpPasswordEnc: { not: null } },
  });
  const results: PollSummary[] = [];
  for (const user of users) {
    results.push(await pollMailbox(user));
  }
  return results;
}
