# nestjs-libraries

Server code shared by `apps/backend` and `apps/orchestrator`: the Prisma schema
and repositories (`src/database`), services, DTOs, the social provider
integrations (`src/integrations`), the Postgres job queue (`src/jobs`), the
Postgres-backed cache and rate limiter (`src/redis`, `src/throttler`), uploads
and emails. Imported through the `@gitroom/nestjs-libraries/*` path alias; it
has no package.json of its own.
