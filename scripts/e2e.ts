import 'dotenv/config';

/**
 * End-to-end check against a running dev server AND a running worker.
 *
 * The architecture is now split: the web app only enqueues and polls, and the worker
 * does all AI and email work. So this test asserts two things the old one could not —
 * that no HTTP route blocks (each must return well inside Vercel's ceiling), and that
 * the worker actually picks the job up and finishes it.
 *
 * It stops before approval, because approving sends a real email.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'atharv.kumar@webisdom.com';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe@123';

/** Vercel's hard limit on the plan we target. Every route must beat this comfortably. */
const VERCEL_TIMEOUT_MS = 60_000;

let cookie = '';
let failures = 0;

function check(label: string, condition: boolean, detail = '') {
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
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
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;
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
  console.log(`\nE2E (async architecture) against ${BASE}\n${'='.repeat(64)}`);

  console.log('\n1. Auth');
  const bad = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: 'wrong' }),
  });
  check('rejects a wrong password', bad.status === 401);

  const login = await call<{ user: { name: string; role: string } }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check('logs in', login.status === 200, login.data?.user?.name);

  console.log('\n2. Prospect');
  const created = await call<{ institution: { id: string; contacts: { id: string }[] } }>(
    '/api/institutions',
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Indian Institute of Technology Delhi',
        website: 'https://home.iitd.ac.in',
        city: 'New Delhi',
        type: 'Institute',
        notes:
          'Focus on industry readiness of final-year students and whether the AI curriculum keeps pace with recruiter expectations.',
        contacts: [{ email: `e2e-${Date.now()}@example.com`, title: 'Head of Training and Placement' }],
      }),
    },
  );
  check('creates an institution', created.status === 201);
  const institutionId = created.data?.institution?.id;

  console.log('\n3. Enqueue must return immediately (not run the cascade)');
  const seq = await call<{ sequence: { id: string }; job: { id: string; status: string } }>(
    '/api/sequences',
    { method: 'POST', body: JSON.stringify({ institutionId }) },
  );
  check('returns 202 Accepted', seq.status === 202, `${seq.ms}ms`);
  check(
    `responds well inside Vercel's ${VERCEL_TIMEOUT_MS / 1000}s limit`,
    seq.ms < 10_000,
    `${seq.ms}ms`,
  );
  check('returns a job id', Boolean(seq.data?.job?.id), seq.data?.job?.status);

  const jobId = seq.data?.job?.id;

  console.log('\n4. Worker picks it up and finishes it');
  if (!jobId) {
    check('job processing', false, 'no job id to poll');
  } else {
    type JobView = {
      status: string;
      stage: string;
      error: string | null;
      result: { draftId?: string } | null;
    };

    const started = Date.now();
    let last = '';
    let done: JobView | null = null;

    // Generous ceiling: the cascade runs 90-355s against Groq's free tier.
    while (Date.now() - started < 480_000) {
      const poll = await call<{ job: JobView }>(`/api/jobs/${jobId}`);
      const job = poll.data?.job;
      if (!job) break;
      if (job.stage !== last) {
        last = job.stage;
        console.log(`     ${((Date.now() - started) / 1000).toFixed(0)}s — ${job.stage}`);
      }
      if (job.status === 'DONE' || job.status === 'FAILED') {
        done = job;
        break;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }

    const secs = ((Date.now() - started) / 1000).toFixed(0);
    check('worker completed the job', done?.status === 'DONE', done?.error ?? `${secs}s`);

    const draftId = done?.result?.draftId;
    check('produced a draft', Boolean(draftId));

    if (draftId) {
      const detail = await call<{
        draft: {
          status: string;
          subject: string;
          body: string;
          confidence: number;
          verificationJson: string | null;
          agentRuns: { status: string }[];
        };
      }>(`/api/drafts/${draftId}`);
      const d = detail.data.draft;
      check('draft awaits approval', d.status === 'NEEDS_APPROVAL');
      check('has a subject and body', d.subject.length > 5 && d.body.length > 150,
        `${d.body.split(/\s+/).length} words`);
      check('no unfilled placeholders', !/\{\{\s*\w+\s*\}\}/.test(d.body + d.subject));
      const runs = d.agentRuns ?? [];
      check('all agent calls succeeded', runs.every((r) => r.status === 'OK'),
        `${runs.filter((r) => r.status === 'OK').length}/${runs.length}`);
      const ver = d.verificationJson ? JSON.parse(d.verificationJson) : null;
      check('verification ran', Boolean(ver), `${ver?.verdict} @ ${ver?.confidence}%`);

      console.log(`\n     Subject: ${d.subject}`);
      console.log(d.body.split('\n').map((l) => '     ' + l).join('\n'));
    }
  }

  console.log('\n5. Every route stays fast');
  for (const path of ['/api/drafts?status=NEEDS_APPROVAL', '/api/analytics?scope=all', '/api/sequences', '/api/replies']) {
    const r = await call(path);
    check(`${path} under 10s`, r.ms < 10_000 && r.status === 200, `${r.ms}ms`);
  }

  console.log('\n6. Guards');
  const dupe = await call('/api/sequences', {
    method: 'POST',
    body: JSON.stringify({ institutionId }),
  });
  check('refuses a duplicate sequence', dupe.status === 409);

  if (institutionId && failures === 0) {
    await call(`/api/institutions/${institutionId}`, { method: 'DELETE' });
  } else if (institutionId) {
    console.log(`\n  (kept institution ${institutionId} for inspection)`);
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nE2E crashed:', err);
  process.exit(1);
});
