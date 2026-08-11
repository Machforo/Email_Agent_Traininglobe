import 'dotenv/config';

/**
 * Verifies the approve route's synchronous pre-flight.
 *
 * The SMTP call is async now, but the checks a reviewer needs immediate feedback on
 * must still happen inside the request. This asserts they do — without sending mail.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'atharv.kumar@webisdom.com';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe@123';

let cookie = '';
let failures = 0;

function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function call<T>(path: string, init: RequestInit = {}) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0]!;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text.slice(0, 200);
  }
  return { status: res.status, data: data as T, ms: Date.now() - started };
}

(async () => {
  await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  const drafts = await call<{ drafts: { id: string; sequence: { contact: { email: string } } }[] }>(
    '/api/drafts?status=NEEDS_APPROVAL',
  );
  const draft = drafts.data?.drafts?.[0];
  if (!draft) {
    console.log('  No draft awaiting approval — run `npm run e2e` first to create one.');
    process.exit(0);
  }

  console.log(`\nApprove pre-flight against draft ${draft.id}\n`);

  const res = await call<{ error?: string; code?: string; job?: { id: string } }>(
    `/api/drafts/${draft.id}/approve`,
    { method: 'POST', body: JSON.stringify({}) },
  );

  const rejected = res.status === 400;
  check('responds synchronously', res.ms < 10_000, `${res.ms}ms`);

  if (rejected) {
    check(
      'blocks the send with an actionable reason',
      Boolean(res.data.error),
      `${res.data.code}: ${res.data.error}`,
    );
    check('nothing was queued', !res.data.job);
  } else if (res.status === 202) {
    // Credentials are configured, so a real send was queued. Cancel it immediately —
    // this script must never actually mail a prospect.
    check('queued a send job', Boolean(res.data.job?.id));
    const { prisma } = await import('../src/lib/db');
    if (res.data.job?.id) {
      await prisma.job.update({
        where: { id: res.data.job.id },
        data: { status: 'FAILED', error: 'cancelled by approve-guard-check' },
      });
      console.log('  (cancelled the queued send — this script never mails anyone)');
    }
    await prisma.$disconnect();
  } else {
    check('expected 400 or 202', false, `got ${res.status}: ${JSON.stringify(res.data)}`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('crashed:', err);
  process.exit(1);
});
