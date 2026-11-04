# OpenAPI coverage — measured (Phase 0, P0-C)

**Measured:** 2026-11-03, worktree `omninoise-phase0`, branch `docs/phase-0-typed-api-handoff-20261103`, source identical to `main` at `f6bea7fe` (the branch only adds docs and one spec).
**Method:** the production build of the backend was started locally against a disposable Postgres 17 container and `/docs-json` was downloaded from it. Nothing was read from or sent to production.
**Evidence files:** [`evidence/openapi.json`](evidence/openapi.json) (the document as served, formatted), [`evidence/api-routes.md`](evidence/api-routes.md) (one row per route), [`evidence/api-inventory.mjs`](evidence/api-inventory.mjs) (the script that computes every number below).

## Headline

The OpenAPI document lists every route, but describes almost nothing about the data that crosses them.

| Measure | Numerator / denominator | Definition |
| --- | --- | --- |
| Routes listed in OpenAPI | **245 / 245** | Handlers found in the controllers that have an operation with the same `operationId` (`Controller_method`) and the same method + path |
| Success response with a usable schema | **0 / 245** | A 2xx response whose content has a schema a client could type a value from (properties, items, a union, or a non-object type) |
| Error responses declared | **0 / 245** | Any 4xx/5xx response in the operation |
| Request body declared | **58 / 107** | Of handlers with a `@Body()` parameter, those whose operation has a `requestBody` |
| Request body with a usable schema | **0 / 107** | Same denominator, schema has at least one property |
| Component schemas with properties | **0 / 48** | All 48 are `{"type":"object","properties":{}}` |
| Path parameters declared | **78 / 78** | Every `:param` in the path appears as an `in: path` parameter (all typed `string`) |
| Query declared | **21 / 35** | Handlers with `@Query()` whose operation has at least one query parameter; the 14 misses are all `@Query() dto: SomeDto` |
| Security declared | **0 / 207** | Of handlers behind an auth middleware, operations with a `security` requirement; the document has no `securitySchemes` |
| Handler return type written down | **3 / 245** | Controller methods with an explicit return type (two are `Promise<any>`, one is `string`) |

Operations by method: GET 105, POST 107, PUT 17, DELETE 16. 216 distinct paths. OpenAPI 3.0.0, title "Omninoise Swagger file", no `servers`.

## Why every schema is empty

- No controller or DTO uses `@ApiProperty`, `@ApiResponse`, `@ApiOkResponse`, `@ApiBody`, `@ApiQuery` or `@ApiBearerAuth` (`grep` count 0 across `apps/` and `libraries/`). The only Swagger decorator in use is `@ApiTags` (30 controllers).
- The `@nestjs/swagger` CLI plugin is not enabled: `apps/backend/nest-cli.json` has `"plugins": []`. Without it, Swagger cannot see class-validator decorators or TypeScript property types, so a DTO class becomes an empty object.
- 49 of the 107 body-taking handlers do not use a DTO class at all: 27 read single fields (25 `@Body('code') code: string`, 2 booleans), 8 take `any` (including `POST /posts` and `POST /public/v1/posts`, the two most important writes, which validate inside the service), and 14 use inline object types such as `{ name: string }`. None of these produce a `requestBody`.

## Concrete examples of weak schemas

| Route | What OpenAPI says | What the wire actually carries (measured locally, see the probes in `api-route-inventory.md`) |
| --- | --- | --- |
| `POST /signatures` | body `$ref SignatureDto` = `{}`; response `201` with no content | body `{content: string, autoAdd: boolean}` (both required by class-validator); response `{"id":"<uuid>"}` |
| `GET /signatures` | response `200` with no content | `[{id, organizationId, content, autoAdd, createdAt: "2026-11-03T09:41:16.818Z", updatedAt, deletedAt: null}]` — Prisma `Date` fields arrive as ISO strings |
| `GET /analytics/{integration}` | `integration` path string, `date` query string, response `200` with no content | see the read trace in `api-route-inventory.md` |
| `POST /posts` | no `requestBody` at all | a 50 MB-capable JSON body validated by the service (`All posts must have an integration id` on a bad body) |
| any authenticated route | no `401`, no security scheme | `401`, empty body, `logout: true` header and a cleared `auth` cookie when the session is missing or invalid |
| any DTO route | no `400` | `{"message": [<class-validator messages>], "error": "Bad Request", "statusCode": 400}` |

## Why generated TypeScript from this document would mislead

A generator such as Orval or `openapi-typescript` run on this document today would produce, for every operation, a request body type of `{}` or nothing, and a response type of `void`/`unknown`. The frontend would compile against types that promise nothing, while the handwritten interfaces it uses now (for example the response models next to `useSWR` calls) would still be the real source of truth. Worse, the generated client would look authoritative: the names, paths and parameters are right, so the emptiness of the bodies is easy to miss in review.

Even with schemas filled in, two gaps remain that a generator cannot close by itself:

- **Dates.** Services return Prisma rows whose fields are `Date` in TypeScript and ISO strings on the wire. A schema derived from the TypeScript types must say `string` (`format: date-time`), and the SPA must not treat them as `Date` objects.
- **Responses are inferred, not declared.** 242 of 245 handlers have no written return type; most return a Prisma payload type, which is a type alias, not a class. Whether the Swagger CLI plugin can turn those into response schemas is **not measured** (its documentation states it adds a response decorator with the response model, without saying how it handles inferred or alias return types). A Phase 1 spike would have to measure it.

## Feasibility of a server-owned contract (no implementation in Phase 0)

| Path | What it needs | Assessment |
| --- | --- | --- |
| Turn on the Swagger CLI plugin | One `nest-cli.json` change, DTO files already end in `.dto.ts`; it reads class-validator decorators (`classValidatorShim`, on by default) | Likely fills the 48 request schemas. Response coverage unknown until measured. Changes the production build, so it is Phase 1 work, and would need a check that the plugin's metadata does not alter runtime validation |
| Hand-write `@ApiResponse` for selected routes | Response DTO classes that mirror Prisma selects | Duplicates the response shape in a second place; the drift risk the project wants to remove |
| Generate a typed client (Orval etc.) from the result | A generated file per build, consumed by the SPA | Only worthwhile once the per-route coverage of the routes it is used for is measured as complete. Until then it would type most responses as `unknown` |

## How to reproduce

From a clean checkout of the branch, with Docker and Node 26.13.0:

1. `docker run -d --name omninoise-phase0-pg -e POSTGRES_USER=phase0 -e POSTGRES_PASSWORD=phase0 -e POSTGRES_DB=phase0 -p 127.0.0.1:55499:5432 postgres:17-alpine`
2. `pnpm install --frozen-lockfile`
3. `pnpm build:backend`
4. `DATABASE_URL=postgresql://phase0:phase0@127.0.0.1:55499/phase0 node_modules/.bin/prisma db push --skip-generate --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma`
5. Start the backend with throwaway values only (no provider keys, no Stripe keys):
   `DATABASE_URL=postgresql://phase0:phase0@127.0.0.1:55499/phase0 JWT_SECRET=phase0-local FRONTEND_URL=http://localhost:4299 NEXT_PUBLIC_BACKEND_URL=http://localhost:3999 BACKEND_INTERNAL_URL=http://localhost:3999 STORAGE_PROVIDER=local UPLOAD_DIRECTORY=/tmp/phase0-uploads IS_GENERAL=true PORT=3999 node --experimental-require-module apps/backend/dist/apps/backend/src/main.js > /tmp/phase0-backend.log 2>&1 &`
6. When `curl -s localhost:3999/` answers `200`: `curl -s localhost:3999/docs-json > /tmp/phase0-openapi.json`
7. `node docs/architecture/evidence/api-inventory.mjs /tmp/phase0-openapi.json /tmp/phase0-backend.log /tmp/phase0-out` prints the summary used above and writes the route table.

Result on 2026-11-03: `/docs-json` → `200 application/json`, 56,072 bytes; boot log contains 245 `Mapped {…}` lines.

Unknowns: response-schema coverage with the CLI plugin enabled; whether any route's real response differs by role or plan (only the two signature routes and the auth/validation paths above were exercised).
