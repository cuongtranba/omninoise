import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    format: ['cjs'],
    target: 'node22',
    platform: 'node',
    minify: true,
    clean: true,
    outDir: 'dist',
    // `bin` in package.json points at dist/index.js.
    outExtensions: () => ({ js: '.js' }),
    banner: { js: '#!/usr/bin/env node' },
    dts: false,
  },
});
