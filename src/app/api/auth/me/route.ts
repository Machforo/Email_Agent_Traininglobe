import { handler, ok } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';

export const GET = handler(async () => {
  const user = await getCurrentUser();
  if (!user) return ok({ user: null });
  return ok({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      hasSmtp: Boolean(user.smtpPasswordEnc),
      smtpEmail: user.smtpEmail,
      signature: user.signature,
      dailySendLimit: user.dailySendLimit,
    },
  });
});
