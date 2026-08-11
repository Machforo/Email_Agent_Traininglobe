import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { encryptSecret } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { verifyCredentials } from '@/lib/email/smtp';

const schema = z.object({
  email: z.string().email(),
  // Google shows app passwords as "abcd efgh ijkl mnop"; strip the spaces for them.
  appPassword: z.string().min(8),
  signature: z.string().max(1000).optional(),
});

/**
 * Stores a member's own Gmail app password so mails send from their address.
 * We authenticate against Gmail first and only persist credentials that work —
 * a wrong password discovered at send time would silently stall a sequence.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const body = schema.parse(await req.json());
  const password = body.appPassword.replace(/\s+/g, '');

  const check = await verifyCredentials(body.email, password);
  if (!check.ok) return fail(check.error, 400);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      smtpEmail: body.email,
      smtpPasswordEnc: encryptSecret(password),
      smtpVerifiedAt: new Date(),
      ...(body.signature !== undefined ? { signature: body.signature } : {}),
    },
  });
  await audit(user.id, 'SMTP_CONFIGURED', 'User', user.id, { email: body.email });

  return ok({ ok: true, email: body.email });
});

export const DELETE = handler(async () => {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { smtpEmail: null, smtpPasswordEnc: null, smtpVerifiedAt: null },
  });
  await audit(user.id, 'SMTP_REMOVED', 'User', user.id);
  return ok({ ok: true });
});
