import { defineConfig } from 'vitest/config';

// Real-Postgres specs for the Redis replacement. The jest setup behind
// `pnpm test` is unused; these run with `pnpm run test:pg`.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['libraries/**/*.spec.ts', 'apps/backend/**/*.spec.ts'],
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The specs share one database, and one of them runs `prisma db push`.
    fileParallelism: false,
  },
});
