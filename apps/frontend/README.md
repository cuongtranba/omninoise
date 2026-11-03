# Frontend

The Omninoise UI: a React single-page app built with [Vite+](https://viteplus.dev)
(`vp`) and routed with react-router.

- `src/router.tsx` maps URLs to the pages and layouts in `src/app`.
- `src/app/route.guard.tsx` holds the auth redirects (login, logout, org invites).
- `runtime-config.mjs` turns the environment into `window.__RUNTIME_CONFIG__`,
  which `useVariables()` reads. Settings change without a rebuild: the dev server
  serves it, and the Docker entrypoint writes `dist/runtime-config.js` at start.

```bash
pnpm --filter postiz-frontend dev     # http://localhost:4200, reads ../../.env
pnpm --filter postiz-frontend build   # type check, then dist/
```

In production nginx serves `dist/` and falls back to `index.html` for app URLs.
