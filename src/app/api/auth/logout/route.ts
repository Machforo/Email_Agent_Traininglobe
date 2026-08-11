import { audit, handler, ok } from '@/lib/api';
import { clearSessionCookie, getCurrentUser } from '@/lib/auth';

export const POST = handler(async () => {
  const user = await getCurrentUser();
  await clearSessionCookie();
  if (user) await audit(user.id, 'LOGOUT');
  return ok({ ok: true });
});
