import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import mime from 'mime';
import { defineConfig, loadEnv, type Plugin } from 'vite-plus';
import { renderRuntimeConfigScript } from './runtime-config.mjs';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(appRoot, '..', '..');

// Dev only: production serves /runtime-config.js from the file written by
// scripts/write-runtime-config.mjs and /uploads from nginx.
const devServerPlugin = (mode: string): Plugin => ({
  name: 'postiz-dev-server',
  apply: 'serve',
  configureServer(server) {
    const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };

    server.middlewares.use('/runtime-config.js', (_req, res) => {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        renderRuntimeConfigScript({
          ...env,
          NODE_ENV: env.NODE_ENV || 'development',
        })
      );
    });

    // The old Next redirect: /api/uploads/* is the legacy location of /uploads/*
    server.middlewares.use('/api/uploads', (req, res) => {
      res.statusCode = env.STORAGE_PROVIDER === 'local' ? 301 : 404;
      if (env.STORAGE_PROVIDER === 'local') {
        res.setHeader('Location', `/uploads${req.url || '/'}`);
      }
      res.end();
    });

    server.middlewares.use('/uploads', (req, res, next) => {
      if (env.STORAGE_PROVIDER !== 'local' || !env.UPLOAD_DIRECTORY) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }

      const base = resolve(env.UPLOAD_DIRECTORY);
      const relative = decodeURIComponent((req.url || '/').split('?')[0]);
      const filePath = resolve(base, `.${relative}`);
      // Confine reads to UPLOAD_DIRECTORY. resolve() collapses any `..`
      // segments (including URL-decoded ones), so this blocks every
      // path-traversal variant.
      if (filePath !== base && !filePath.startsWith(base + sep)) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      let fileStats;
      try {
        fileStats = statSync(filePath);
      } catch {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      if (!fileStats.isFile()) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      // Honor ranged requests: providers that push video in chunks (TikTok,
      // YouTube, LinkedIn, X) fetch byte windows with a Range header and
      // reject anything but a 206, so ignoring Range breaks their uploads.
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end =
        range && range[2]
          ? Math.min(Number(range[2]), fileStats.size - 1)
          : fileStats.size - 1;

      if (range && (start >= fileStats.size || start > end)) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${fileStats.size}`);
        res.end();
        return;
      }

      res.statusCode = range ? 206 : 200;
      res.setHeader(
        'Content-Type',
        mime.getType(filePath) || 'application/octet-stream'
      );
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Last-Modified', fileStats.mtime.toUTCString());
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Accept-Ranges', 'bytes');
      if (range) {
        res.setHeader(
          'Content-Range',
          `bytes ${start}-${end}/${fileStats.size}`
        );
      }
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(filePath, range ? { start, end } : {}).pipe(res);
    });
  },
});

export default defineConfig(({ mode }) => ({
  root: appRoot,
  envDir: repoRoot,
  plugins: [react(), devServerPlugin(mode)],
  resolve: { tsconfigPaths: true },
  define: {
    'import.meta.env.NEXT_PUBLIC_VERSION': JSON.stringify(
      process.env.NEXT_PUBLIC_VERSION ?? ''
    ),
  },
  server: { port: 4200 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
      // Dependencies ship Next/RSC 'use client' directives that mean nothing
      // in a plain SPA bundle.
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          return;
        }
        warn(warning);
      },
    },
  },
}));
