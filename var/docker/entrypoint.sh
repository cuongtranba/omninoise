#!/bin/sh
set -e

# The SPA reads its settings from the container env through this file.
node /app/apps/frontend/scripts/write-runtime-config.mjs /app/apps/frontend/dist
nginx
pnpm run prisma-db-push
# exec: pm2-runtime becomes PID 1, so SIGTERM from `docker stop` reaches it.
exec pm2-runtime start /app/var/docker/ecosystem.config.js
