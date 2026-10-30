// Backend and orchestrator run `node` directly, not through `pnpm start`, so a
// stop signal reaches the Nest process and its shutdown hooks instead of
// stopping at a wrapper. The environment comes from the container (no dotenv).
const workerGraceMs = Number(process.env.JOB_WORKER_SHUTDOWN_GRACE_MS) || 300000;

module.exports = {
  apps: [
    {
      name: 'backend',
      cwd: '/app/apps/backend',
      script: './dist/apps/backend/src/main.js',
      node_args: '--experimental-require-module',
    },
    {
      name: 'orchestrator',
      cwd: '/app/apps/orchestrator',
      script: './dist/apps/orchestrator/src/main.js',
      node_args: '--experimental-require-module',
      // pm2 SIGKILLs after this; the worker must have time to drain first.
      kill_timeout: workerGraceMs + 30000,
    },
    {
      // Nothing to drain here.
      name: 'frontend',
      cwd: '/app/apps/frontend',
      script: 'pnpm',
      args: 'start',
    },
  ],
};
