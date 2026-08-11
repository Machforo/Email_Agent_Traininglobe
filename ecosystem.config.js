/**
 * PM2 process definitions for a production server.
 *
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup     # survive reboots
 *   pm2 logs                    # tail both processes
 *
 * Two processes, deliberately: the web app is request-scoped and can be restarted at
 * will, while the worker holds cron timers and IMAP connections.
 */
module.exports = {
  apps: [
    {
      name: 'outreach-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      env: { NODE_ENV: 'production', PORT: '3000' },
      max_memory_restart: '600M',
      autorestart: true,
    },
    {
      name: 'outreach-worker',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'src/worker/index.ts',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
      autorestart: true,
      // A crash loop here usually means bad credentials or no network; back off
      // rather than hammering Gmail.
      restart_delay: 10_000,
      // Only one worker, ever. Two would double-send follow-ups.
      instances: 1,
    },
  ],
};
