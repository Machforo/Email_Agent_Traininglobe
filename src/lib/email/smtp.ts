import nodemailer, { type Transporter } from 'nodemailer';
import { tryDecryptSecret } from '../crypto';
import type { User } from '@/generated/prisma/client';

/**
 * Gmail SMTP, one identity per team member.
 *
 * Each user supplies their own Google app password after logging in; it is stored
 * AES-GCM encrypted and only decrypted here, at send time. That way mails genuinely
 * come from the person who owns the relationship, and reply threading works.
 */

export type SenderCredentials = {
  email: string;
  password: string;
  name: string;
};

export function credentialsFor(user: User): SenderCredentials | null {
  const password = tryDecryptSecret(user.smtpPasswordEnc);
  if (!user.smtpEmail || !password) return null;
  return { email: user.smtpEmail, password, name: user.name };
}

export function createTransport(creds: SenderCredentials): Transporter {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
    // Gmail throttles aggressive senders; keep a single connection and pace sends.
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
  });
}

/** Used by the settings screen to check an app password before we store it. */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const transport = createTransport({ email, password, name: '' });
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, error: friendlySmtpError(raw) };
  } finally {
    transport.close();
  }
}

export function friendlySmtpError(raw: string): string {
  if (/Username and Password not accepted|BadCredentials|535/i.test(raw)) {
    return 'Gmail rejected these credentials. Use a 16-character App Password (not your normal Gmail password), generated with 2-Step Verification enabled.';
  }
  if (/Invalid login/i.test(raw)) {
    return 'Invalid login. Check the address and app password.';
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(raw)) {
    return 'Could not reach smtp.gmail.com. Check the network or firewall.';
  }
  if (/Daily user sending (limit|quota) exceeded|550-5\.4\.5/i.test(raw)) {
    return 'Gmail daily sending limit reached for this account. Try again tomorrow.';
  }
  return raw.slice(0, 300);
}

export type OutgoingMail = {
  to: string;
  toName?: string | null;
  subject: string;
  text: string;
  html: string;
  /** RFC-822 threading headers so replies land in the same conversation. */
  inReplyTo?: string | null;
  references?: string | null;
  /** Attachment bytes come from the database, so pass content rather than a path. */
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  listUnsubscribe?: string | null;
};

export type SendResult = {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
};

export async function sendMail(
  creds: SenderCredentials,
  mail: OutgoingMail,
  transport?: Transporter,
): Promise<SendResult> {
  const t = transport ?? createTransport(creds);
  try {
    const headers: Record<string, string> = {};
    if (mail.listUnsubscribe) {
      headers['List-Unsubscribe'] = `<${mail.listUnsubscribe}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }

    const info = await t.sendMail({
      from: { name: creds.name, address: creds.email },
      to: mail.toName ? { name: mail.toName, address: mail.to } : mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      inReplyTo: mail.inReplyTo ?? undefined,
      references: mail.references ?? undefined,
      attachments: mail.attachments,
      headers,
    });

    return {
      messageId: info.messageId,
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
      response: info.response ?? '',
    };
  } finally {
    if (!transport) t.close();
  }
}
