import 'dotenv/config';
import { prisma } from '../src/lib/db';

/** Shows the state of the job queue — the first thing to check when work seems stuck. */
(async () => {
  const jobs = await prisma.job.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
  console.log(`${jobs.length} recent job(s)\n`);
  for (const j of jobs) {
    const took =
      j.finishedAt && j.startedAt
        ? `${((j.finishedAt.getTime() - j.startedAt.getTime()) / 1000).toFixed(0)}s`
        : j.startedAt
          ? `running ${((Date.now() - j.startedAt.getTime()) / 1000).toFixed(0)}s`
          : 'not started';
    console.log(`${j.type} | ${j.status} | attempt ${j.attempts}/${j.maxAttempts} | ${took}`);
    if (j.error) console.log(`   error: ${j.error.slice(0, 300)}`);
    if (j.result) console.log(`   result: ${j.result.slice(0, 200)}`);
  }
  await prisma.$disconnect();
})();
