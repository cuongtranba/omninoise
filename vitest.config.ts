import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Real-Postgres specs for the Redis replacement. The jest setup behind
// `pnpm test` is unused; these run with `pnpm run test:pg`.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['libraries/**/*.spec.ts'],
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
