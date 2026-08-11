import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { pollMailbox } from '../src/lib/email/imap';

/** Times a real IMAP poll. Run it twice: the second pass should be near-instant. */
(async () => {
  const users = await prisma.user.findMany({
    where: { active: true, smtpEmail: { not: null }, smtpPasswordEnc: { not: null } },
  });

  if (!users.length) {
    console.log('No user has mailbox credentials configured — nothing to poll.');
    await prisma.$disconnect();
    return;
  }

  for (const user of users) {
    const started = Date.now();
    const summary = await pollMailbox(user);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `${user.smtpEmail}: scanned ${summary.scanned} new, ${summary.replies} replies, ` +
        `${summary.bounces} bounces in ${secs}s`,
    );
    for (const e of summary.errors) console.log('   error:', e.slice(0, 200));

    const state = await prisma.systemSetting.findUnique({ where: { key: `imap:uid:${user.id}` } });
    console.log('   watermark:', state?.value ?? '(none)');
  }

  await prisma.$disconnect();
})();
