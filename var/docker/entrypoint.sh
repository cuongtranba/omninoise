#!/bin/sh
set -e

nginx
pnpm run prisma-db-push
# exec: pm2-runtime becomes PID 1, so SIGTERM from `docker stop` reaches it.
exec pm2-runtime start /app/var/docker/ecosystem.config.js
