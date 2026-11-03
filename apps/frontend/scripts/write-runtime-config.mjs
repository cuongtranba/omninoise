// Usage: node scripts/write-runtime-config.mjs <distDir>
// Writes <distDir>/runtime-config.js from the process environment. The Docker
// entrypoint runs it at container start so one image serves any configuration.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderRuntimeConfigScript } from '../runtime-config.mjs';

const distDir = process.argv[2];
if (!distDir) {
  console.error('Usage: write-runtime-config.mjs <distDir>');
  process.exit(1);
}

const outDir = resolve(distDir);
await mkdir(outDir, { recursive: true });
await writeFile(
  resolve(outDir, 'runtime-config.js'),
  renderRuntimeConfigScript({
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
  })
);
