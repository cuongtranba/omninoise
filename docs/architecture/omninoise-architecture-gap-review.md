# Omninoise: API Type Safety & Hono Migration — Architecture Gap Review

**Reviewed:** 2026-11-03 (Asia/Ho_Chi_Minh)
**Repository:** https://github.com/cuongtranba/omninoise
**Reviewed branch:** main; commit surfaced by GitHub: `f6bea7fe3d91715f4a04c2aa7624e04935bf5626`
**Evidence level:** read-only source/config review. No local build, integration test, performance benchmark, exhaustive code-search crawl, or runtime OpenAPI extraction was performed. Kanna must confirm latest HEAD and fill every unknown with measured evidence.
**Decision:** User approved staged approach, **authorized Phase 0 only**. Phase 1 (typed FE client), Phase 2 (Hono RPC), Phase 3 (expansion) require separate explicit approval. No production deploy or migration is authorized.

## Objective

Keep Vite SPA and existing runtime behavior; achieve one authoritative request/response contract for FE and BE without handwritten duplicate models. Eventually reduce Nest HTTP boilerplate via isolated Hono RPC routes **only after** measured contract and behavioral compatibility. Do not conflate lighter HTTP routing with removing Nest dependencies from the domain or workers.

## Architecture confirmed from files

| Component | Current system | Evidence |
| --- | --- | --- |
| Frontend | React 19, Vite+ SPA, React Router 7, SWR, custom fetch wrapper | `apps/frontend/package.json`, `src/router.tsx`, `vite.config.ts`, `libraries/helpers/src/utils/custom.fetch.func.ts` |
| Backend | NestJS 11 over Express; guards, filters, DTOs, Swagger, MCP | `apps/backend/src/main.ts`, `app.module.ts`, `api/api.module.ts` |
| Orchestrator | Separate NestJS process, Postgres-backed workers | `apps/orchestrator/src/main.ts`, `app.module.ts` |
| Data and queue | Prisma 6.5 / PostgreSQL 17 and `pgonly.jobs` lease/retry/dedupe queue | `README.md`, `libraries/nestjs-libraries/src/jobs/job.queue.ts` |
| MCP | Attached to Nest DI and Express transport; route/tool parity tests | `libraries/nestjs-libraries/src/chat/start.mcp.ts`, `mcp.parity.spec.ts` |
| Public API | Versioned `/public/v1`, external SDK and CLI consumers | `apps/backend/src/public-api/`, `apps/sdk/`, `apps/cli/` |
| Deployment | Nginx :5000 serves static SPA, proxies `/api/` to Nest :3000 with prefix stripped; PM2 and Docker on Dokploy | `var/docker/nginx.conf`, `var/docker/entrypoint.sh`, `Dockerfile`, `deploy/compose.yaml` |
| Toolchain | pnpm workspace, Vite+ `vp` (Oxlint, Oxfmt, Vitest), Postgres tests | `package.json`, `pnpm-workspace.yaml`, `vite.config.ts` |

## Gaps (findings vs measurements)

### P0 — HTTP API lacks inferred end-to-end types

- `customFetch()` returns a raw `Response`; consumer code such as `apps/frontend/src/components/analytics/analytics.component.tsx` accesses `.json()` without inferred HTTP schema.
- Nest request DTOs use `class-validator`/`class-transformer` (`libraries/nestjs-libraries/src/dtos/users/user.details.dto.ts`).
- `libraries/helpers/src/swagger/load.swagger.ts` registers Swagger, but inspected scripts show no typed frontend client generation.
- **Unknown:** Swagger response metadata coverage and whether a generated client can accurately represent existing responses. Do not claim OpenAPI is complete until measured.

**Phase 0 evidence:** count routes and OpenAPI operations; record response-schema coverage by success/error code, request bodies, parameters, unions, nullable fields and content types. Test whether an existing server-owned contract is viable without manually copying DTOs into the SPA.

### P0 — Nest is coupled to domain, workers and MCP

- `apps/backend/src/app.module.ts` registers many modules/services; `api/api.module.ts` wires auth, guards and middleware.
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` directly uses Nest exceptions, `ValidationPipe`, and `@Injectable`.
- `apps/orchestrator` is itself a Nest process and uses shared DI services.
- `libraries/nestjs-libraries/src/chat/start.mcp.ts` uses `INestApplication`, `app.get()` and Express middleware. Treating it as an ordinary Hono JSON route would be incorrect.

**Phase 0 evidence:** dependency map for candidate low-risk routes; account for transitive Nest modules, DI construction, database and worker dependencies, MCP and API consumers.

### P0 — Observable HTTP/auth behavior must not change

- `apps/backend/src/main.ts`: raw body capture, cookie parsing, compression, CORS allowed/exposed headers, global filters, and special 50 MB JSON parsing for `/posts` and `/copilot`.
- `apps/backend/src/services/auth/auth.middleware.ts`: verify JWT **then re-resolve** active user/org from database, impersonation, cookie handling, Sentry user context.
- `apps/backend/src/services/auth/permissions/permissions.guard.ts`: policy/organization authorization.
- `libraries/helpers/src/utils/custom.fetch.func.ts`: auth, showorg, impersonate, credentials, cache and before/after hooks. `afterRequest=false` produces a never-settling promise; investigate intent before proposing changes.
- `var/docker/nginx.conf`: public `/api/posts` reaches backend `/posts`; a naive Hono `/api/posts` route would be wrong behind this existing proxy.

**Phase 0 evidence:** real existing statuses, response bodies, cookie flags, headers, 401/403/org boundaries, upload/streaming behavior, redirects and public URL rewriting. Capture representative observable behavior through tests; no need to implement complete cutover coverage in Phase 0.

### P0 — MCP parity and external API compatibility

- `mcp.parity.spec.ts` parses **Nest decorator syntax** to enumerate web/public routes; a future Hono route could disappear from this test unless inventory is framework-neutral.
- All authenticated browser routes currently require a mirrored MCP tool or a reasoned EXCLUDED entry.
- Public `/public/v1`, OAuth callbacks, signed webhooks, SSE, multipart, SDK and CLI are independently consumed surfaces.

**Phase 0 evidence:** enumerate these surfaces and propose a framework-neutral manifest/parity design. Preserve current tool semantics and existing tests.

### P1 — Validation and type boundary risks (future phase, NOT authorized now)

- Nest `class-validator`/`class-transformer` and Zod are **not** automatically behavior-equivalent (coercion, defaults, nested types, nulls, omitted fields).
- Frontend has `moduleResolution: bundler` and backend CommonJS/legacy decorator metadata; cross-importing server source can leak runtime Node/DB modules or make type checking slow.
- Hono RPC `hc<AppType>()` is compile-time inference, **not** runtime response verification. In future use types-only/precompiled declarations and explicit status contracts.
- Preserve runtime `window.__RUNTIME_CONFIG__` / `useVariables().backendUrl`; Vite config does **not** imply a global `/api` proxy.

### P2 — Independent documentation and CI issues (record, not scope creep)

- README lists Node 22.18+ but `.node-version` and Docker pin 26.13.0.
- Root Vitest inclusion patterns omit `apps/orchestrator/**/*.spec.ts`; check whether tests are actually omitted.
- `customFetch`'s never-settling branch requires behavior tracing, not a speculative quick fix.

## Tradeoff matrix / decision gate

| Strategy | Benefit | Risk | Status |
| --- | --- | --- | --- |
| Existing Nest Swagger + generated types/client (e.g. Orval) | Minimal runtime change, one server-owned contract | OpenAPI schema completeness unknown | **Audit in Phase 0; implement only after approval** |
| Shared Zod schema for selected legacy route | Single runtime validator/contract | Could alter existing Nest validation behavior | Evaluate in ADR only |
| Isolated Hono route + RPC | Typed SPA and less HTTP boilerplate for migrated slices | DI/auth/MCP/proxy/serialization coupling | Evaluate in ADR only |
| Replace Nest backend + orchestrator now | Maximum rewrite | Very high regression and availability risk | Rejected |

## Phase 0 exit criteria / facts to return

1. Enumerated route inventory (web/public/MCP/webhook/stream) and consumers, with stated confidence/unknowns.
2. Reproducible OpenAPI extraction and measured request/response schema coverage. Distinguish schema-defined from merely route-listed.
3. Trace one UI read and one UI write end to end; characterize auth and public/internal URL rewrite.
4. Narrow, deterministic public-seam characterization tests with real disposable Postgres where needed, or explicit reproducible blockers.
5. Framework/DI dependency map and 1–2 **recommended** low-risk candidate slices, NOT implemented.
6. ADR comparing Nest+generated types, shared schema, Hono RPC; change/rollback considerations and explicit sign-off gate.

## Safety rules

- **No Phase 1/2/3** changes, no Hono install or route migration, no generated typed client yet.
- No changes to DB schemas, `pgonly` job semantics, orchestrator, MCP transport, production config, secrets or live data.
- No direct `main` push; it triggers production deployment. Use a worktree and PR.
- Read `CLAUDE.md`, README, prior docs/ADRs/tests before changes; follow TDD, pnpm, root check/test/build, and PR template including exact numbered `# QA`.
- Never expose Prisma rows with credentials or silently change authorization/public API contracts.
- Stop after Phase 0 report and await explicit user approval.

**Companion handoff:** `docs/handoffs/omninoise-kanna-handoff.md`.
