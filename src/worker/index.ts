import 'dotenv/config';

/**
 * Worker entry point.
 *
 * This exists only to set APP_ROLE before anything else loads. Imports are hoisted and
 * evaluated before top-level statements, so assigning the variable alongside a static
 * `import { prisma }` would be too late — db.ts would already have sized its connection
 * pool for a serverless request. The real worker is loaded dynamically below, after the
 * assignment has taken effect.
 */
process.env.APP_ROLE = 'worker';

void import('./main');
