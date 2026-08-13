/**
 * PM2 process definitions for a production server.
 *
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup     # survive reboots
 *   pm2 logs outreach-worker    # AI jobs live here, not in the web process
 *
 * Two processes, deliberately: the web app is request-scoped and can be restarted at
 * will, while the worker holds cron timers, IMAP, and every Groq/Gemini call.
 */
const path = require('path');
const root = __dirname;
require('dotenv').config({ path: path.join(root, '.env') });

module.exports = {
  apps: [
    {
      name: 'outreach-web',
      cwd: root,
      script: path.join(root, 'node_modules/next/dist/bin/next'),
      args: 'start -H 0.0.0.0 -p 3000',
      env: { NODE_ENV: 'production', PORT: '3000' },
      max_memory_restart: '600M',
      autorestart: true,
    },
    {
      name: 'outreach-worker',
      cwd: root,
      script: path.join(root, 'src/worker/index.ts'),
      interpreter: path.join(root, 'node_modules/.bin/tsx'),
      env: { NODE_ENV: 'production', APP_ROLE: 'worker' },
      max_memory_restart: '400M',
      autorestart: true,
      restart_delay: 10_000,
      instances: 1,
    },
  ],
};
