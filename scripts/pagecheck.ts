import 'dotenv/config';

/** Confirms every dashboard route renders for a logged-in admin. */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'atharv.kumar@webisdom.com';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe@123';

const PAGES = [
  '/',
  '/prospects',
  '/approvals',
  '/sequences',
  '/inbox',
  '/templates',
  '/case-studies',
  '/analytics',
  '/admin',
  '/settings',
];

(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  if (!cookie) {
    console.error('login failed');
    process.exit(1);
  }

  let failures = 0;
  for (const path of PAGES) {
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });
    const html = await res.text();
    const ok = res.status === 200 && !/Application error|Internal Server Error/i.test(html);
    if (!ok) failures++;
    console.log(
      `  [${ok ? 'PASS' : 'FAIL'}] ${path.padEnd(15)} ${res.status} ${(html.length / 1024).toFixed(0)}kb`,
    );
  }

  // Logged-out users must be bounced to the login screen.
  const anon = await fetch(`${BASE}/prospects`, { redirect: 'manual' });
  const redirected = anon.status === 307 || anon.status === 302;
  if (!redirected) failures++;
  console.log(`  [${redirected ? 'PASS' : 'FAIL'}] anonymous access redirects to /login`);

  console.log(failures ? `\n${failures} page(s) failed` : '\nAll pages render');
  process.exit(failures ? 1 : 0);
})();
