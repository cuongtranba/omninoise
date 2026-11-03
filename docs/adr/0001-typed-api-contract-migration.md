# 0001. Earn a server-owned typed contract inside Nest before any Hono route

- **Status:** Proposed (Phase 0 recommendation; nothing here is implemented or approved)
- **Date:** 2026-11-03
- **Deciders:** the owner, at the Phase 1 approval gate

## Context

The goal (from `docs/architecture/omninoise-architecture-gap-review.md`) is one authoritative request/response contract shared by the Vite SPA and the Nest backend, and later, maybe, lighter HTTP routing with Hono RPC. Phase 0 measured the starting point; the evidence is in `docs/architecture/`:

- **The OpenAPI document lists every route and describes no data.** 245/245 routes are in `/docs-json`, but 0/245 have a success-response schema, 0/245 declare errors, 0/48 component schemas have a property, 58/107 body-taking handlers declare a body and 0/107 describe it, no security scheme ([openapi-coverage.md](../architecture/openapi-coverage.md)). No `@Api*` metadata exists beyond `@ApiTags`, and the Swagger CLI plugin is off.
- **Request contracts exist, response contracts mostly do not.** 58 handlers take class-validator DTOs. Responses are inferred Prisma payloads (3/245 handlers write a return type), whose `Date` fields become ISO strings on the wire (measured on `GET /signatures`). The two most important writes, `POST /posts` and `POST /public/v1/posts`, take `any` and validate inside the service.
- **The same shape is already written several times.** For signatures: the Prisma model, `SignatureDto` (class-validator, HTTP), a zod `signatureSchema` with `createdAt: z.string()` in `signatures.tool.ts` (MCP output, one of 70 tools that hand-write zod output schemas), a yup form schema in `signatures.component.tsx`, and an untyped `useSWR('signatures', load)` in the SPA. The project also already turns class-validator DTOs into JSON Schema (`class-validator-jsonschema`, `chat/validation.schemas.helper.ts`) to validate MCP input.
- **Nest owns more than routing.** A browser request passes `AuthMiddleware`, whose dependencies reach `UsersService` → `PaymentService` → `SubscriptionService`, and `NotificationService` → `EmailService` → `JobQueueService` ([nest-coupling-map.md](../architecture/nest-coupling-map.md)). Global `ValidationPipe`, three exception filters (one turns 403 into 401 and clears the cookie), CORS, cookies, raw body and the 50 MB parser are configured in `main.ts`. MCP is mounted with `app.use` on the same Express instance and reads services through `app.get()`. The orchestrator is a second Nest process that shares the same services.
- **The public URL is not the internal path.** nginx strips `/api/`; the backend serves `/signatures`, not `/api/signatures` (measured, pinned by `apps/backend/src/main.spec.ts`).
- **Route discovery is decorator text.** `mcp.parity.spec.ts` finds routes by regex over `@Get/@Post/...`; it matches the runtime 245/245 today and would not see a route defined any other way.

## Options compared

| | (a) Nest + OpenAPI + generated types | (b) Shared Zod contract with a Nest adapter | (c) Isolated Hono route + RPC client |
| --- | --- | --- | --- |
| Source of truth | DTO classes and (to be added) response models in the backend | Zod schemas in a types-only shared library | The Hono route definition |
| Codegen | Yes: OpenAPI → TS types or client per build | No: `z.infer` | No: `hc<AppType>` inference |
| Request validation at runtime | Unchanged class-validator + `ValidationPipe` (same 400 shape) | Zod pipe replaces class-validator per route: different coercion, defaults, nulls and error shape (`{"message":[...]}` would change unless mapped) | Hono validator per route; same shape risk as (b) |
| Response correctness | Only as good as the response schemas; today 0/245 | Can `parse` responses at runtime if wanted | Compile-time inference only, no runtime check |
| Frontend type checking | Generated `.d.ts`, no server imports | Imports a shared library that must stay free of Node/Prisma code | Imports the server's `AppType`: the frontend type graph reaches backend code (bundler vs CommonJS + legacy decorators), risk of slow or broken type checks unless a pre-built declaration file is produced |
| External API (`/public/v1`, SDK, CLI) | Gains a real, publishable OpenAPI document | Can emit JSON Schema/OpenAPI from Zod, extra tooling | Unaffected only if never migrated; Hono's OpenAPI needs `@hono/zod-openapi` |
| Auth, org, filters, MCP | Unchanged | Unchanged (still Nest controllers) | Must reuse Nest DI (`app.get(UsersService)` …) or re-implement `AuthMiddleware`, the 401 filter, CORS and policies; a second route owner the parity spec cannot see |
| Behind nginx | Unchanged | Unchanged | Must mount at internal paths, never `/api/...` |
| Migration cost for one slice | Small: plugin on, response model for the slice, generator | Medium: schema + pipe + error mapping + MCP schema reuse | High: mounting, auth bridge, parity manifest, types-only build, rollback path |
| Net simplification | Removes the SPA's handwritten/untyped models | Could also replace the MCP zod duplicates | Removes Nest boilerplate only for the migrated routes; Nest stays for every other route, the orchestrator and MCP |

## Decision (recommended, pending approval)

1. **Do (a) first, measured, on one slice.** In Phase 1, enable the `@nestjs/swagger` CLI plugin in a branch and re-run `docs/architecture/evidence/api-inventory.mjs` to measure request and response coverage. If it describes the slice's request and response completely, generate **types only** (no runtime client yet) for that slice and use them in the SPA's hooks for it. If response coverage stays at 0, write one response model for the slice and record the duplication cost before going further.
2. **Keep (b) as the follow-up for responses**, specifically to reuse the zod output schemas MCP tools already hand-write, if (a) cannot describe Prisma responses without a second copy. Decide only after (a)'s measurement.
3. **Do not start (c).** Nothing measured supports net simplification: a Hono route would still need Nest DI for auth and services, would add a second route owner, and only gives compile-time types. Revisit only after (a) or (b) has delivered a typed contract and the parity manifest below exists.

### Candidate slices (not implemented)

- **Slice 1 — signatures (`GET /signatures`, `GET /signatures/default`, `POST /signatures`, `PUT /signatures/:id`, `DELETE /signatures/:id`).** Controller → `SignatureService` → `SignatureRepository` → `PrismaRepository<'signatures'>`; organization-scoped; no provider calls, no jobs, no orchestrator use, not in the public API; mirrored by `signaturesTool`; already characterized over HTTP by `main.spec.ts`. The SPA side (`signatures.component.tsx`) is untyped today, so a typed hook is an observable improvement.
- **Slice 2 — a read on the same footing**, chosen from the coupling map's measured candidates (see [nest-coupling-map.md](../architecture/nest-coupling-map.md#candidate-slices)); the handoff's suggested analytics read is *not* low risk, because it calls social-platform APIs.

### Rules any later phase must keep

- **One route owner.** Every `METHOD path` has exactly one owner. Before a second framework exists, replace the regex parser in `mcp.parity.spec.ts` with a manifest collected from the running app (Nest's router plus any other router registered on the HTTP adapter, each tagged with its owner), and fail on a path owned twice or mounted under `/api` ([api-route-inventory.md §6](../architecture/api-route-inventory.md#6-mcp-parity-parser-vs-a-framework-neutral-manifest)).
- **Types only across the boundary.** The SPA may import generated `.d.ts` files or a library with no runtime imports of Node, Prisma or Nest. Enforce with a lint rule or a build check that fails if `apps/frontend` bundles anything from `libraries/nestjs-libraries` or `@prisma/client`.
- **Wire compatibility is the contract, not the TypeScript.** `main.spec.ts` pins the 401/logout/cookie behavior, the 400 validation shape, the `/api` rewrite, CORS, the body-size split and the organization fallback; it must keep passing unchanged through any migration of a slice.
- **No-touch regions until separately approved:** `/public/v1` (SDK, CLI), MCP transports and OAuth discovery (including the `/api`-less discovery URLs found in Phase 0), provider webhooks with raw-body signatures, the CopilotKit stream, multipart uploads, `/posts` with its 50 MB parser, and everything that enqueues `pgonly.jobs`.

### Rollout and rollback (for the Phase 1 slice)

- Rollout: generated types land behind no runtime change (types are erased); the SPA hook for the slice switches to them; `main.spec.ts` and the parity spec stay green; deploy through the normal `main` merge.
- Rollback: revert the PR. With types-only generation there is no runtime state, schema change or data migration to undo. A plugin change to the backend build is the only runtime-adjacent part; its rollback is the same revert, verified by `/docs-json` and `main.spec.ts`.

### How to test surfaces Phase 0 did not exercise, before migrating them

| Surface | What it needs |
| --- | --- |
| Channel OAuth callbacks | A fake provider implementing the provider interface in a disposable environment, never a real social account |
| Uploads (multipart, chunked, upload-from-url) | Local storage provider and fixture files of realistic sizes, asserting the stored media row and the served `/uploads/` file |
| Stripe/RevenueCat webhooks | Locally signed payloads with a test signing secret, asserting no throw and idempotent state |
| CopilotKit stream, MCP streamable HTTP and SSE | An MCP client (or the CLI) against a local backend with an org API key from a disposable database |
| `GET /public/stream` | Range requests against a local media file, checking status 206 and headers |
| `pgonly.jobs` effects | The existing `job.queue.spec.ts` style, against a disposable database |

## Consequences

- Easier: the next step is small, reversible and measurable with the script and tests added in Phase 0.
- Harder: the generated contract is only as good as the server metadata; responses need work the plugin may not do, and that cost must be measured, not assumed.
- To remember: the OpenAPI document is public at `/api/docs-json`; filling it in publishes request/response shapes of browser routes too. Decide per surface whether that is wanted before enabling the plugin in production.
- Cost of reversing: none today (nothing implemented). After Phase 1, reverting types-only generation is a revert of one PR.

**Next explicit approval needed:** whether to start Phase 1 with option (a) on slice 1 (plugin spike + measurement + types-only generation for signatures). Phase 2 (Hono) and Phase 3 stay unapproved.
