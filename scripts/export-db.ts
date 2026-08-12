import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/lib/db';

/**
 * Dump the current DATABASE_URL into prisma/seed-data.json for moving to another host
 * (e.g. local PGlite → EC2 Postgres).
 *
 *   npm run pg          # if using local PGlite
 *   npm run db:export
 *
 * Then copy prisma/seed-data.json to the server and run `npm run db:import` there.
 *
 * Note: smtpPasswordEnc values only decrypt if ENCRYPTION_KEY matches on the target.
 */

const OUT = resolve(process.cwd(), 'prisma/seed-data.json');

async function main() {
  const [
    users,
    institutions,
    contacts,
    templates,
    caseStudies,
    sequences,
    drafts,
    agentRuns,
    emailMessages,
    replies,
    feedback,
    trackingEvents,
    suppressions,
    notifications,
    auditLogs,
    systemSettings,
    jobs,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.institution.findMany(),
    prisma.contact.findMany(),
    prisma.template.findMany(),
    prisma.caseStudy.findMany(),
    prisma.sequence.findMany(),
    prisma.draft.findMany(),
    prisma.agentRun.findMany(),
    prisma.emailMessage.findMany(),
    prisma.reply.findMany(),
    prisma.feedback.findMany(),
    prisma.trackingEvent.findMany(),
    prisma.suppression.findMany(),
    prisma.notification.findMany(),
    prisma.auditLog.findMany(),
    prisma.systemSetting.findMany(),
    prisma.job.findMany(),
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    users,
    institutions,
    contacts,
    templates,
    caseStudies: caseStudies.map((c) => ({
      ...c,
      data: Buffer.from(c.data).toString('base64'),
    })),
    sequences,
    drafts,
    agentRuns,
    emailMessages,
    replies,
    feedback,
    trackingEvents,
    suppressions,
    notifications,
    auditLogs,
    systemSettings,
    jobs,
  };

  writeFileSync(OUT, JSON.stringify(dump, null, 2));

  const counts = Object.fromEntries(
    Object.entries(dump)
      .filter(([k, v]) => k !== 'exportedAt' && Array.isArray(v))
      .map(([k, v]) => [k, (v as unknown[]).length]),
  );
  console.log(`wrote ${OUT}`);
  console.log(counts);
  console.log(
    '\nCopy prisma/seed-data.json to EC2, set DATABASE_URL, then:\n  npx prisma migrate deploy && npm run db:import\n',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
