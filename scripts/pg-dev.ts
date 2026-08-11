import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * Local Postgres for development, with nothing to install.
 *
 * Production runs on a managed Postgres at Render. Rather than let local dev drift onto
 * a different engine (SQLite), this serves PGlite — real Postgres compiled to WASM —
 * over the Postgres wire protocol, so Prisma, the migrations and every query behave
 * exactly as they will in production.
 *
 *   npm run pg
 *
 * Data persists in ./.pgdata. Delete that folder for a clean slate.
 * Not for production: PGlite is single-connection and single-process.
 */

const PORT = Number(process.env.PG_DEV_PORT ?? 5433);

async function main() {
  const db = await PGlite.create({ dataDir: './.pgdata' });
  const server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: '127.0.0.1',
    // Defaults to 1, which is not enough: the Next.js dev server and the worker each
    // hold a pool, so a single-connection server drops one of them with
    // "Server has closed the connection". Queries are queued internally.
    maxConnections: 20,
  });

  await server.start();
  console.log(`local postgres ready on port ${PORT}`);
  console.log(`DATABASE_URL="postgresql://postgres:postgres@localhost:${PORT}/postgres"`);
  console.log('(dev only — ctrl-c to stop)');

  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error('failed to start local postgres:', err);
  process.exit(1);
});
