import 'dotenv/config';
import { prisma } from '../src/lib/db';

(async () => {
  const runs = await prisma.agentRun.findMany({ orderBy: { createdAt: 'desc' }, take: 12 });
  console.log(`showing ${runs.length} most recent runs\n`);
  for (const r of runs.reverse()) {
    console.log(
      `--- ${r.agent} | ${r.status} | ${r.model} | in=${r.tokensIn} out=${r.tokensOut} | ${(r.latencyMs / 1000).toFixed(1)}s`,
    );
    if (r.error) console.log(`    ERROR: ${r.error.slice(0, 400)}`);
  }
  await prisma.$disconnect();
})();
