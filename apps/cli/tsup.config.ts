import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  minify: true,
  clean: true,
  outDir: 'dist',
  banner: { js: '#!/usr/bin/env node' },
});
