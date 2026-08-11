import 'dotenv/config';

/**
 * Full-system test.
 *
 * Exercises every user-facing flow against a running app + worker + Postgres, over the
 * real HTTP API — no internal shortcuts, so it tests what the team will actually touch.
 *
 * It DOES send one real email, to the operator's own address (never a prospect), because
 * that is the only way to verify SMTP, threading, and open/click tracking end to end.
 * Set SKIP_SEND=1 to leave that section out.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'atharv.kumar@webisdom.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe@123';
// Never hardcode a credential here — this file is committed. Set TEST_APP_PASSWORD.
const APP_PASSWORD = (process.env.TEST_APP_PASSWORD ?? '').replace(/\s+/g, '');
const SELF = ADMIN_EMAIL; // every test mail goes here and nowhere else
const SKIP_SEND = process.env.SKIP_SEND === '1';

let cookie = '';
let memberCookie = '';
let pass = 0;
const failures: string[] = [];
const skipped: string[] = [];

function section(title: string) {
  console.log(`\n${title}\n${'─'.repeat(title.length)}`);
}
function check(label: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else failures.push(label);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}
function skip(label: string, why: string) {
  skipped.push(label);
  console.log(`  [SKIP] ${label} — ${why}`);
}

async function call<T>(path: string, init: RequestInit = {}, who: 'admin' | 'member' | 'anon' = 'admin') {
  const jar = who === 'admin' ? cookie : who === 'member' ? memberCookie : '';
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(jar ? { Cookie: jar } : {}),
      ...(init.headers ?? {}),
    },
    redirect: 'manual',
  });
  const sc = res.headers.get('set-cookie');
  if (sc) {
    const v = sc.split(';')[0]!;
    if (who === 'member') memberCookie = v;
    else if (who === 'admin') cookie = v;
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text.slice(0, 300);
  }
  return { status: res.status, data: data as T, ms: Date.now() - started, headers: res.headers };
}

async function waitForJob(jobId: string, timeoutMs = 480_000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    const r = await call<{ job: { status: string; stage: string; error: string | null; result: Record<string, string> | null } }>(
      `/api/jobs/${jobId}`,
    );
    const job = r.data?.job;
    if (!job) return null;
    if (job.stage !== last) {
      last = job.stage;
      console.log(`         ${((Date.now() - started) / 1000).toFixed(0)}s · ${job.stage}`);
    }
    if (job.status === 'DONE' || job.status === 'FAILED') return job;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

const cleanup: (() => Promise<void>)[] = [];

(async () => {
  console.log(`\nFULL SYSTEM TEST — ${BASE}`);
  console.log('='.repeat(70));

  /* ---------------------------------------------------------------- 1. AUTH */
  section('1. Authentication and authorisation');

  check('anonymous API access blocked', (await call('/api/institutions', {}, 'anon')).status === 401);
  check('wrong password rejected',
    (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: 'nope' }) }, 'anon')).status === 401);

  const login = await call<{ user: { name: string; role: string } }>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  check('admin login', login.status === 200 && login.data.user.role === 'ADMIN', login.data?.user?.name);

  const memberLogin = await call<{ user: { role: string } }>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'member1@traininglobe.com', password: 'Member@123' }),
  }, 'member');
  check('member login', memberLogin.status === 200 && memberLogin.data.user.role === 'MEMBER');
  check('member blocked from admin routes', (await call('/api/admin/users', {}, 'member')).status === 403);
  check('admin allowed on admin routes', (await call('/api/admin/users')).status === 200);

  /* ------------------------------------------------------------- 2. MAILBOX */
  section('2. Mailbox connection');

  const badCreds = await call<{ error: string }>('/api/auth/smtp', {
    method: 'POST', body: JSON.stringify({ email: SELF, appPassword: 'wrongwrongwrong' }),
  });
  check('rejects a bad app password', badCreds.status === 400, badCreds.data?.error?.slice(0, 60));

  if (!APP_PASSWORD) {
    skip('mailbox connection', 'set TEST_APP_PASSWORD to test the real mailbox');
  } else {
    const smtp = await call<{ ok: boolean }>('/api/auth/smtp', {
      method: 'POST',
      body: JSON.stringify({ email: SELF, appPassword: APP_PASSWORD, signature: 'Traininglobe' }),
    });
    check('accepts a verified app password', smtp.status === 200);
  }

  const me = await call<{ user: { hasSmtp: boolean; smtpEmail: string } }>('/api/auth/me');
  check('mailbox shows connected', me.data.user.hasSmtp === true, me.data.user.smtpEmail);

  const { prisma } = await import('../src/lib/db');
  const rawUser = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  check('app password encrypted at rest',
    Boolean(rawUser?.smtpPasswordEnc) && !rawUser!.smtpPasswordEnc!.includes(APP_PASSWORD),
    rawUser?.smtpPasswordEnc?.slice(0, 22) + '…');

  /* ----------------------------------------------------------- 3. TEMPLATES */
  section('3. Templates');

  const tpls = await call<{ templates: { id: string; stage: string }[] }>('/api/templates');
  check('seeded templates load', tpls.data.templates.length >= 5, `${tpls.data.templates.length}`);

  const newTpl = await call<{ template: { id: string } }>('/api/templates', {
    method: 'POST',
    body: JSON.stringify({ name: 'Test template', stage: 'INITIAL', subject: 'hello {{institution}}', body: 'Hi {{first_name}}, this is a test template body for {{institution}}.' }),
  });
  check('creates a template', newTpl.status === 201);
  const tplId = newTpl.data?.template?.id;
  if (tplId) {
    cleanup.push(async () => { await call(`/api/templates/${tplId}`, { method: 'DELETE' }); });
    check('updates a template', (await call(`/api/templates/${tplId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) })).status === 200);
    check('extracts template variables',
      (await call<{ templates: { id: string; variables: string[] }[] }>('/api/templates')).data.templates
        .find((t) => t.id === tplId)!.variables.includes('institution'));
  }

  /* -------------------------------------------------------- 4. CASE STUDIES */
  section('4. Case studies (stored in Postgres)');

  const pdf = Buffer.from('%PDF-1.4\n% test case study\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'results.pdf');
  form.set('title', 'Test case study');
  form.set('description', 'Placement uplift at a similar institution.');
  const upload = await call<{ caseStudy: { id: string; sizeBytes: number } }>('/api/case-studies', { method: 'POST', body: form });
  check('uploads a case study', upload.status === 201, `${upload.data?.caseStudy?.sizeBytes} bytes`);
  const csId = upload.data?.caseStudy?.id;

  if (csId) {
    const dl = await call<string>(`/api/case-studies/${csId}`);
    check('downloads it back from the DB',
      dl.status === 200 && dl.headers.get('content-type') === 'application/pdf');
    const stored = await prisma.caseStudy.findUnique({ where: { id: csId } });
    check('bytes round-trip intact', Buffer.from(stored!.data).equals(pdf), `${stored!.data.length} bytes`);
    check('list query omits the blob',
      !JSON.stringify((await call('/api/case-studies')).data).includes('"data"'));
  }

  const badType = new FormData();
  badType.set('file', new Blob([new Uint8Array(Buffer.from('x'))], { type: 'application/x-msdownload' }), 'bad.exe');
  badType.set('title', 'Bad');
  check('rejects a disallowed file type', (await call('/api/case-studies', { method: 'POST', body: badType })).status === 400);

  /* ----------------------------------------------------------- 5. PROSPECTS */
  section('5. Prospects');

  const inst = await call<{ institution: { id: string; contacts: { id: string }[] } }>('/api/institutions', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Lovely Professional University',
      website: 'https://www.lpu.in', city: 'Phagwara', state: 'Punjab', type: 'University',
      notes: 'Pitch an AI upskilling programme for final-year students; focus on placement readiness.',
      contacts: [{ email: SELF, name: 'Atharv Kumar', title: 'Head of Training and Placement' }],
    }),
  });
  check('creates a prospect', inst.status === 201);
  const institutionId = inst.data?.institution?.id;
  if (institutionId) cleanup.push(async () => { await call(`/api/institutions/${institutionId}`, { method: 'DELETE' }); });

  check('rejects an invalid email',
    (await call('/api/institutions', { method: 'POST', body: JSON.stringify({ name: 'Bad Uni', contacts: [{ email: 'nope' }] }) })).status === 422);

  const csv = 'institution,email,contact_name,title,notes\nCSV Test College,csv-import@example.com,Dr Test,Dean,Imported by the test suite';
  const imported = await call<{ imported: number; skipped: number }>('/api/institutions/import', { method: 'POST', body: JSON.stringify({ csv }) });
  check('CSV import', imported.status === 200 && imported.data.imported === 1, `${imported.data?.imported} imported`);

  const dupe = await call<{ imported: number; skipped: number }>('/api/institutions/import', { method: 'POST', body: JSON.stringify({ csv }) });
  check('CSV re-import does not duplicate', dupe.data.skipped === 1 && dupe.data.imported === 0);

  const csvInst = await prisma.institution.findFirst({ where: { name: 'CSV Test College' } });
  if (csvInst) cleanup.push(async () => { await prisma.institution.deleteMany({ where: { id: csvInst.id } }); });

  check('member cannot see admin prospects',
    !JSON.stringify((await call('/api/institutions', {}, 'member')).data).includes('Lovely Professional'));

  /* ------------------------------------------------- 6. DRAFT GENERATION */
  section('6. Draft generation (async job)');

  const seqRes = await call<{ sequence: { id: string }; job: { id: string } }>('/api/sequences', {
    method: 'POST', body: JSON.stringify({ institutionId, caseStudyIds: csId ? [csId] : [] }),
  });
  check('enqueues and returns immediately', seqRes.status === 202 && seqRes.ms < 10_000, `${seqRes.ms}ms`);
  const sequenceId = seqRes.data?.sequence?.id;

  const genJob = await waitForJob(seqRes.data?.job?.id ?? '');
  check('worker completes generation', genJob?.status === 'DONE', genJob?.error ?? '');
  const draftId = genJob?.result?.draftId;
  check('produced a draft', Boolean(draftId));

  let draft: { subject: string; body: string; status: string; confidence: number; verificationJson: string | null; researchSummary: string | null; agentRuns: { status: string; agent: string }[] } | undefined;
  if (draftId) {
    draft = (await call<{ draft: typeof draft }>(`/api/drafts/${draftId}`)).data.draft;
    check('draft awaits approval', draft!.status === 'NEEDS_APPROVAL');
    check('has real content', draft!.subject.length > 5 && draft!.body.split(/\s+/).length > 60, `${draft!.body.split(/\s+/).length} words`);
    check('no unfilled placeholders', !/\{\{\s*\w+\s*\}\}/.test(draft!.subject + draft!.body));
    check('no banned opener', !/hope this (email|message) finds you well/i.test(draft!.body));
    check('all agent calls OK', draft!.agentRuns.every((r) => r.status === 'OK'),
      `${draft!.agentRuns.length} calls`);
    const research = draft!.researchSummary ? JSON.parse(draft!.researchSummary) : null;
    check('research found gaps', (research?.gaps?.length ?? 0) > 0, `${research?.gaps?.length} gaps`);
    check('research cited sources', (research?.sources?.length ?? 0) > 0, `${research?.sources?.length} sources`);
    const ver = draft!.verificationJson ? JSON.parse(draft!.verificationJson) : null;
    check('verification ran', Boolean(ver), `${ver?.verdict} @ ${ver?.confidence}%`);
    check('verification checked claims', (ver?.checks?.length ?? 0) > 0, `${ver?.checks?.length} claims`);
  }

  /* ------------------------------------------------------ 7. EDIT / GUARDS */
  section('7. Draft editing and guards');

  if (draftId) {
    check('saves edits', (await call(`/api/drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify({ subject: 'edited by test suite' }) })).status === 200);
    check('member cannot open another user draft', (await call(`/api/drafts/${draftId}`, {}, 'member')).status === 403);
  }
  check('refuses a duplicate sequence',
    (await call('/api/sequences', { method: 'POST', body: JSON.stringify({ institutionId }) })).status === 409);

  /* ------------------------------------------------------------ 8. SENDING */
  section('8. Approve and send (real email to your own address)');

  let sentMessage: { id: string; trackingId: string | null; messageId: string | null; subject: string } | null = null;

  if (SKIP_SEND) {
    skip('real send', 'SKIP_SEND=1');
  } else if (!draftId) {
    skip('real send', 'no draft to send');
  } else {
    // Restore a sane subject after the edit test above.
    await call(`/api/drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify({ subject: draft!.subject }) });

    const approve = await call<{ job: { id: string } }>(`/api/drafts/${draftId}/approve`, {
      method: 'POST', body: JSON.stringify({ feedbackNote: 'Test suite: keep the opener concrete.' }),
    });
    check('approve responds synchronously', approve.status === 202 && approve.ms < 10_000, `${approve.ms}ms`);

    const sendJob = await waitForJob(approve.data?.job?.id ?? '', 180_000);
    check('worker sent the mail', sendJob?.status === 'DONE', sendJob?.error ?? '');

    sentMessage = await prisma.emailMessage.findFirst({
      where: { sequenceId, direction: 'OUT' }, orderBy: { createdAt: 'desc' },
      select: { id: true, trackingId: true, messageId: true, subject: true },
    });
    check('outbound message recorded', Boolean(sentMessage?.messageId), sentMessage?.messageId?.slice(0, 40));

    const afterSend = await prisma.draft.findUnique({ where: { id: draftId } });
    check('draft marked SENT', afterSend?.status === 'SENT');

    const seq = await prisma.sequence.findUnique({ where: { id: sequenceId } });
    check('sequence advanced to follow-up 1', seq?.currentStage === 1);
    check('follow-up scheduled', Boolean(seq?.nextActionAt),
      seq?.nextActionAt ? new Date(seq.nextActionAt).toISOString().slice(0, 16) : '');

    const attachRecorded = await prisma.emailMessage.findUnique({ where: { id: sentMessage!.id } });
    check('case study attached', Boolean(attachRecorded?.attachmentsJson), attachRecorded?.attachmentsJson ?? 'none');

    // The learning loop runs after the send, so give it a moment.
    await new Promise((r) => setTimeout(r, 6000));
    const fb = await prisma.feedback.count({ where: { draftId } });
    check('feedback captured from the reviewer note', fb > 0, `${fb} rule(s)`);
  }

  /* ----------------------------------------------------------- 9. TRACKING */
  section('9. Tracking endpoints');

  if (sentMessage?.trackingId) {
    const px = await fetch(`${BASE}/api/t/o/${sentMessage.trackingId}`);
    check('open pixel returns an image', px.headers.get('content-type') === 'image/gif');
    // Opens within 10s of sending are ignored as mail-client prefetch, so wait it out.
    await new Promise((r) => setTimeout(r, 11_000));
    await fetch(`${BASE}/api/t/o/${sentMessage.trackingId}`);
    const opened = await prisma.emailMessage.findUnique({ where: { id: sentMessage.id } });
    check('open recorded after the prefetch window', (opened?.openCount ?? 0) > 0, `${opened?.openCount} open(s)`);

    const click = await fetch(`${BASE}/api/t/c/${sentMessage.trackingId}?u=${encodeURIComponent('https://www.lpu.in')}`, { redirect: 'manual' });
    check('click redirects', click.status === 302, click.headers.get('location') ?? '');
    const clicked = await prisma.emailMessage.findUnique({ where: { id: sentMessage.id } });
    check('click recorded', (clicked?.clickCount ?? 0) > 0);
  } else {
    skip('tracking against a real message', 'nothing was sent');
  }

  const evil = await fetch(`${BASE}/api/t/c/whatever?u=${encodeURIComponent('javascript:alert(1)')}`, { redirect: 'manual' });
  check('click endpoint refuses javascript:', !(evil.headers.get('location') ?? '').startsWith('javascript:'));

  /* -------------------------------------------------------- 10. SUPPRESSION */
  section('10. Unsubscribe and suppression');

  if (sentMessage?.trackingId) {
    const unsub = await fetch(`${BASE}/api/t/u/${sentMessage.trackingId}`);
    check('unsubscribe page renders', unsub.status === 200);
    const sup = await prisma.suppression.findUnique({ where: { email: SELF.toLowerCase() } });
    check('address suppressed', Boolean(sup), sup?.reason);
    const stopped = await prisma.sequence.findUnique({ where: { id: sequenceId } });
    check('sequence stopped on unsubscribe', stopped?.status === 'STOPPED');

    // Suppression must block a new sequence to this address.
    const blocked = await call<{ error: string }>('/api/sequences', {
      method: 'POST', body: JSON.stringify({ institutionId }),
    });
    check('suppressed address cannot be re-contacted', blocked.status === 400, blocked.data?.error?.slice(0, 50));

    // Don't leave the operator's own address suppressed.
    await prisma.suppression.deleteMany({ where: { email: SELF.toLowerCase() } });
    check('suppression cleaned up for your address',
      !(await prisma.suppression.findUnique({ where: { email: SELF.toLowerCase() } })));
  } else {
    skip('suppression flow', 'nothing was sent');
  }

  /* ----------------------------------------------------------- 11. INBOX */
  section('11. Inbox polling');

  const pollJob = await call<{ result: { processed: number; errors: string[]; detail?: string } }>('/api/admin/jobs', {
    method: 'POST', body: JSON.stringify({ job: 'inbox-poll' }),
  });
  check('inbox poll runs', pollJob.status === 200, pollJob.data?.result?.detail ?? '');
  check('poll reports no errors', (pollJob.data?.result?.errors?.length ?? 0) === 0,
    pollJob.data?.result?.errors?.[0]?.slice(0, 80) ?? '');

  /* -------------------------------------------------------- 12. ANALYTICS */
  section('12. Analytics');

  const analytics = await call<{ stats: { sent: number; rates: Record<string, number> }; leaderboard: unknown[] }>('/api/analytics?scope=all&days=30');
  check('analytics load', analytics.status === 200 && analytics.ms < 10_000, `${analytics.ms}ms`);
  check('counts the sent mail', SKIP_SEND || analytics.data.stats.sent > 0, `sent=${analytics.data?.stats?.sent}`);
  check('admin gets the leaderboard', Array.isArray(analytics.data.leaderboard), `${analytics.data?.leaderboard?.length} members`);
  check('member sees no leaderboard',
    (await call<{ leaderboard?: unknown[] }>('/api/analytics', {}, 'member')).data.leaderboard === undefined);

  const insights = await call<{ insights: { headline: string; recommendations: unknown[] } }>('/api/analytics/insights');
  check('AI insights generate', insights.status === 200 && insights.data.insights.headline.length > 5,
    insights.data?.insights?.headline?.slice(0, 70));

  /* ------------------------------------------------------------ 13. ADMIN */
  section('13. Admin console');

  const settings = await call<{ settings: Record<string, string> }>('/api/admin/settings');
  check('settings load', settings.status === 200 && Boolean(settings.data.settings.orgName));
  check('settings update',
    (await call('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ followUpDays: '4' }) })).status === 200);
  await call('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ followUpDays: '3' }) });

  const newUser = await call<{ user: { id: string } }>('/api/admin/users', {
    method: 'POST', body: JSON.stringify({ name: 'Test Member', email: `test-${Date.now()}@traininglobe.com`, password: 'TestPass@123', role: 'MEMBER' }),
  });
  check('creates a user', newUser.status === 201);
  const newUserId = newUser.data?.user?.id;
  if (newUserId) {
    check('disables a user', (await call(`/api/admin/users/${newUserId}`, { method: 'PATCH', body: JSON.stringify({ active: false }) })).status === 200);
    cleanup.push(async () => { await prisma.user.deleteMany({ where: { id: newUserId } }); });
  }

  const adminRow = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  check('cannot demote the last admin',
    (await call(`/api/admin/users/${adminRow!.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'MEMBER' }) })).status === 400);

  /* --------------------------------------------------------- 14. FEEDBACK */
  section('14. Feedback loop and notifications');

  const rule = await call<{ feedback: { id: string } }>('/api/feedback', {
    method: 'POST', body: JSON.stringify({ lesson: 'Never mention pricing in the first email.' }),
  });
  check('adds a feedback rule', rule.status === 201);
  if (rule.data?.feedback?.id) {
    check('disables a rule', (await call('/api/feedback', { method: 'PATCH', body: JSON.stringify({ id: rule.data.feedback.id, active: false }) })).status === 200);
    cleanup.push(async () => { await prisma.feedback.deleteMany({ where: { id: rule.data.feedback.id } }); });
  }
  check('member cannot create a team-wide rule',
    (await call('/api/feedback', { method: 'POST', body: JSON.stringify({ lesson: 'Global rule attempt from a member.', global: true }) }, 'member')).status === 403);

  const notifs = await call<{ notifications: unknown[]; unread: number }>('/api/notifications');
  check('notifications load', notifs.status === 200, `${notifs.data?.notifications?.length} (${notifs.data?.unread} unread)`);
  check('mark all read', (await call('/api/notifications', { method: 'PATCH', body: JSON.stringify({ all: true }) })).status === 200);

  /* -------------------------------------------------------- 15. JOB QUEUE */
  section('15. Job queue behaviour');

  const jobRows = await prisma.job.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
  check('jobs recorded', jobRows.length > 0, `${jobRows.length} recent`);
  check('no job stuck RUNNING', !jobRows.some((j) => j.status === 'RUNNING' && Date.now() - j.createdAt.getTime() > 600_000));
  check('job ownership enforced',
    (await call(`/api/jobs/${jobRows[0]?.id}`, {}, 'member')).status === 403);

  /* ------------------------------------------------------------ 16. PAGES */
  section('16. Pages render');

  for (const p of ['/', '/prospects', '/approvals', '/sequences', '/inbox', '/templates', '/case-studies', '/analytics', '/admin', '/settings']) {
    const r = await fetch(`${BASE}${p}`, { headers: { Cookie: cookie }, redirect: 'manual' });
    const html = await r.text();
    check(`${p}`, r.status === 200 && !/Application error/i.test(html), `${(html.length / 1024).toFixed(0)}kb`);
  }

  /* ----------------------------------------------------------- CLEAN UP */
  section('Cleanup');
  for (const fn of cleanup.reverse()) {
    try { await fn(); } catch (e) { console.log('  cleanup issue:', e instanceof Error ? e.message : e); }
  }
  console.log('  test data removed');

  await prisma.$disconnect();

  /* -------------------------------------------------------------- RESULT */
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${pass} passed · ${failures.length} failed · ${skipped.length} skipped`);
  if (failures.length) {
    console.log('\nFAILED:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  console.log('='.repeat(70));
  process.exit(failures.length ? 1 : 0);
})().catch(async (err) => {
  console.error('\nTEST RUN CRASHED:', err);
  process.exit(1);
});
