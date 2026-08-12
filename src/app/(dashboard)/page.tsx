import { redirect } from 'next/navigation';

/** Overview lives at /dashboard; keep / as a stable entry that lands there. */
export default function RootPage() {
  redirect('/dashboard');
}
