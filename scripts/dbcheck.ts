import 'dotenv/config';
import { prisma } from '../src/lib/db';

(async () => {
  const users = await prisma.user.count();
  const institutions = await prisma.institution.count();
  const sequences = await prisma.sequence.count();
  console.log(`DB OK — users=${users} institutions=${institutions} sequences=${sequences}`);
  await prisma.$disconnect();
})();
