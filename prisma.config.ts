import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 moved the datasource URL out of schema.prisma and into this file.
import 'dotenv/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
