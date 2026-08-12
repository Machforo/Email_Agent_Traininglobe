import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/lib/db';

/**
 * Load prisma/seed-data.json (from `npm run db:export`) into the current DATABASE_URL.
 *
 * On EC2 (fresh DB):
 *   npx prisma migrate deploy
 *   npm run db:import
 *
 * Pass --wipe to delete existing rows first (destructive). Default is insert-only and
 * will fail on primary-key conflicts if the DB already has data.
 */

const IN = resolve(process.cwd(), 'prisma/seed-data.json');
const wipe = process.argv.includes('--wipe');

type Dump = {
  exportedAt: string;
  users: Record<string, unknown>[];
  institutions: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
  templates: Record<string, unknown>[];
  caseStudies: (Record<string, unknown> & { data: string })[];
  sequences: Record<string, unknown>[];
  drafts: Record<string, unknown>[];
  agentRuns: Record<string, unknown>[];
  emailMessages: Record<string, unknown>[];
  replies: Record<string, unknown>[];
  feedback: Record<string, unknown>[];
  trackingEvents: Record<string, unknown>[];
  suppressions: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  auditLogs: Record<string, unknown>[];
  systemSettings: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
};

async function wipeAll() {
  // Children first (FK order).
  await prisma.trackingEvent.deleteMany();
  await prisma.reply.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.emailMessage.deleteMany();
  await prisma.draft.deleteMany();
  await prisma.job.deleteMany();
  await prisma.feedback.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.sequence.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.institution.deleteMany();
  await prisma.template.deleteMany();
  await prisma.caseStudy.deleteMany();
  await prisma.suppression.deleteMany();
  await prisma.systemSetting.deleteMany();
  await prisma.user.deleteMany();
  console.log('wiped existing rows');
}

async function createMany(label: string, count: number, fn: () => Promise<unknown>) {
  if (!count) {
    console.log(`  ${label}: 0`);
    return;
  }
  await fn();
  console.log(`  ${label}: ${count}`);
}

async function main() {
  if (!existsSync(IN)) {
    console.error(`Missing ${IN}`);
    console.error('Run `npm run db:export` on the source machine first, then copy the file here.');
    console.error('For a fresh install with no dump, use `npm run db:seed` instead.');
    process.exit(1);
  }

  const dump = JSON.parse(readFileSync(IN, 'utf8')) as Dump;
  console.log(`importing dump from ${dump.exportedAt}`);

  if (wipe) await wipeAll();

  await createMany('users', dump.users.length, () =>
    prisma.user.createMany({ data: dump.users as never }),
  );
  await createMany('institutions', dump.institutions.length, () =>
    prisma.institution.createMany({ data: dump.institutions as never }),
  );
  await createMany('contacts', dump.contacts.length, () =>
    prisma.contact.createMany({ data: dump.contacts as never }),
  );
  await createMany('templates', dump.templates.length, () =>
    prisma.template.createMany({ data: dump.templates as never }),
  );
  await createMany('caseStudies', dump.caseStudies.length, () =>
    prisma.caseStudy.createMany({
      data: dump.caseStudies.map((c) => ({
        ...c,
        data: Buffer.from(c.data, 'base64'),
      })) as never,
    }),
  );
  await createMany('sequences', dump.sequences.length, () =>
    prisma.sequence.createMany({ data: dump.sequences as never }),
  );
  await createMany('drafts', dump.drafts.length, () =>
    prisma.draft.createMany({ data: dump.drafts as never }),
  );
  await createMany('emailMessages', dump.emailMessages.length, () =>
    prisma.emailMessage.createMany({ data: dump.emailMessages as never }),
  );
  await createMany('agentRuns', dump.agentRuns.length, () =>
    prisma.agentRun.createMany({ data: dump.agentRuns as never }),
  );
  await createMany('replies', dump.replies.length, () =>
    prisma.reply.createMany({ data: dump.replies as never }),
  );
  await createMany('trackingEvents', dump.trackingEvents.length, () =>
    prisma.trackingEvent.createMany({ data: dump.trackingEvents as never }),
  );
  await createMany('feedback', dump.feedback.length, () =>
    prisma.feedback.createMany({ data: dump.feedback as never }),
  );
  await createMany('suppressions', dump.suppressions.length, () =>
    prisma.suppression.createMany({ data: dump.suppressions as never }),
  );
  await createMany('notifications', dump.notifications.length, () =>
    prisma.notification.createMany({ data: dump.notifications as never }),
  );
  await createMany('auditLogs', dump.auditLogs.length, () =>
    prisma.auditLog.createMany({ data: dump.auditLogs as never }),
  );
  await createMany('systemSettings', dump.systemSettings.length, () =>
    prisma.systemSetting.createMany({ data: dump.systemSettings as never }),
  );
  await createMany('jobs', dump.jobs.length, () =>
    prisma.job.createMany({ data: dump.jobs as never }),
  );

  console.log('import done');
  console.log(
    'If mailbox passwords were in the dump, ENCRYPTION_KEY on this host must match the source.',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
