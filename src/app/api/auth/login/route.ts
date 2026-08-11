import { z } from 'zod';
import { audit, fail, handler, ok } from '@/lib/api';
import { createSessionToken, setSessionCookie, verifyPassword } from '@/lib/auth';
import { prisma } from '@/lib/db';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = handler(async (req: Request) => {
  const { email, password } = schema.parse(await req.json());

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  // Same message either way — don't leak which accounts exist.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return fail('Incorrect email or password', 401);
  }
  if (!user.active) return fail('This account has been deactivated. Contact your admin.', 403);

  const token = await createSessionToken({
    uid: user.id,
    email: user.email,
    role: user.role as 'ADMIN' | 'MEMBER',
    name: user.name,
  });
  await setSessionCookie(token);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(user.id, 'LOGIN');

  return ok({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      // The UI prompts for the app password when this is false.
      hasSmtp: Boolean(user.smtpPasswordEnc),
    },
  });
});
