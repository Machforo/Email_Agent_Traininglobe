#!/usr/bin/env bash
# One-box EC2 start: web + AI worker via PM2. Run from anywhere; cds to the repo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null; then
  echo "Node is not installed. Use nvm and .nvmrc (Node 22)."
  exit 1
fi

npx tsx scripts/ec2-check.ts
npx prisma generate
npx prisma migrate deploy

if [[ ! -d .next ]]; then
  echo "No production build yet — running npm run build"
  npm run build
fi

if ! command -v pm2 >/dev/null; then
  echo "pm2 not found. Install with: npm i -g pm2"
  exit 1
fi

pm2 startOrReload ecosystem.config.js --update-env
pm2 save
echo
echo "Web:    http://$(hostname -I 2>/dev/null | awk '{print $1}'):3000/dashboard"
echo "Health: curl -s http://127.0.0.1:3000/api/health"
echo "Worker: pm2 logs outreach-worker"
echo "Expect health.worker === \"up\" within ~30s."
