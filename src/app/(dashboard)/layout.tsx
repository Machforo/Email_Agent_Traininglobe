import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { getCurrentUser } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  // Middleware only checks that a cookie exists; this is the real authorisation check.
  if (!user) redirect('/login');

  return (
    <Shell
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as 'ADMIN' | 'MEMBER',
        hasSmtp: Boolean(user.smtpPasswordEnc),
        smtpEmail: user.smtpEmail,
      }}
    >
      {children}
    </Shell>
  );
}
