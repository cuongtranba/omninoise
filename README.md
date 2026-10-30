# omninoise

omninoise is a self-hosted social media scheduler. It plans, schedules and
publishes posts to TikTok, Facebook, YouTube, Instagram, Threads and the other
supported channels, with a calendar, media library, analytics, team accounts, a
public API and an MCP server for agents.

It runs on **Postgres alone**: no Redis, no Temporal, no Elasticsearch. One
application container and one Postgres container are the whole deployment.

Production runs on Dokploy at https://postiz.lowbit.link and is deployed from
this repository on every push to `main`. Runbooks, decisions and content live in
the private repository
[cuongtranba/omninoise-ops](https://github.com/cuongtranba/omninoise-ops).

## Architecture

```mermaid
flowchart LR
  user["Browser / public API / MCP"] --> nginx["nginx :5000"]
  subgraph app["omninoise container (pm2)"]
    nginx -->|"/"| frontend["frontend :4200 (Vite React)"]
    nginx -->|"/api"| backend["backend :3000 (NestJS)"]
    orchestrator["orchestrator :3002 (job worker)"]
  end
  backend -->|"Prisma + enqueue"| pg[("Postgres 17")]
  orchestrator -->|"claim jobs, publish posts"| pg
  orchestrator --> social["Social platform APIs"]
```

| Part | Path | Role |
| --- | --- | --- |
| Backend | `apps/backend` | NestJS API. Writes data with Prisma and enqueues jobs; it never runs them. |
| Frontend | `apps/frontend` | Vite + React UI, served behind nginx. |
| Orchestrator | `apps/orchestrator` | Job worker. Publishes posts at their scheduled time, refreshes tokens, sends emails and digests, runs autopost. Handlers are in `apps/orchestrator/src/jobs`. |
| Shared code | `libraries/` | Services, Prisma schema, providers and React components shared by the apps. |

Everything is stored in one Postgres database:

- **App data** is in the `public` schema, managed by Prisma
  (`libraries/nestjs-libraries/src/database/prisma/schema.prisma`).
- **The job queue** is `pgonly.jobs` (`libraries/nestjs-libraries/src/jobs`).
  Workers claim due jobs with `FOR UPDATE SKIP LOCKED`, wake on
  `LISTEN pgonly_jobs` with a 1 s poll as fallback, hold a lease that is
  extended while running, and a reaper returns jobs whose lease expired.
  Failed jobs retry (3 attempts by default). Recurring work (missing-post
  sweep, autopost, token refresh, streaks) re-enqueues itself when it finishes.
- **Key-value cache and rate limits** are the unlogged tables `pgonly.kv_store`
  and `pgonly.throttle_hits` (`libraries/nestjs-libraries/src/redis`,
  `libraries/nestjs-libraries/src/throttler`).

The `pgonly` schema is not managed by Prisma; the apps create it on boot.

## Run locally

Requirements: Node 22, pnpm 10 (`packageManager` in `package.json`), Docker.

```bash
pnpm install                  # also generates the Prisma client
pnpm run dev:docker           # Postgres 17 on :5432, pgAdmin on :8085
cp .env.example .env          # then edit, see Configuration
pnpm run prisma-db-push       # apply the Prisma schema
pnpm run dev                  # orchestrator, backend, frontend and extension
```

Open http://localhost:4200. For the dev database started above, set
`DATABASE_URL="postgresql://postiz-local:postiz-local-pwd@localhost:5432/postiz-db-local"`.

`pnpm run dev-backend` starts only the backend and frontend, so no jobs run and
nothing gets published.

## Configuration

Settings are read from `.env` at the repository root. `.env.example` lists every
option, including the per-platform app keys.

| Variable | Needed | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | The Postgres database. The only infrastructure the app needs. |
| `JWT_SECRET` | yes | Signs session tokens. |
| `FRONTEND_URL` | yes | Public URL of the UI. |
| `NEXT_PUBLIC_BACKEND_URL` | yes | Public URL of the API. |
| `BACKEND_INTERNAL_URL` | yes | API URL as seen from the frontend server. |
| `STORAGE_PROVIDER` | optional | `local` (default, with `UPLOAD_DIRECTORY`) or `cloudflare` (with the `CLOUDFLARE_*` keys). |
| `RUN_CRON` | production | `true` enables the hourly sweep that catches missed posts. |
| `DISABLE_REGISTRATION` | optional | `true` closes sign-up. |
| `WORKER_CONCURRENCY_DIVIDER` | optional | Divides each provider queue's concurrency. |
| `EXCLUDE_QUEUE` | optional | Queues this worker should not run. |

## Test and build

```bash
pnpm run test:pg   # job queue, key-value store and throttler against Postgres 17
pnpm run build     # frontend, backend and orchestrator
```

`pnpm run test:pg` uses `TEST_DATABASE_URL` (falling back to `DATABASE_URL`).
One spec runs `prisma db push`, so point it at a disposable database.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`:

1. The checks in `.github/workflows/build.yml` (build and the Postgres tests),
   which also run on every pull request.
2. Build `Dockerfile.dev` for amd64 and arm64 and publish
   `ghcr.io/cuongtranba/omninoise:sha-<short sha>`. There is no `latest` tag.
3. Write that tag into `deploy/compose.yaml`, push the file to Dokploy
   (`compose.update`), start a deployment (`compose.deploy`) and wait for it.
4. Wait until `https://postiz.lowbit.link/api/public/v1/integrations` answers
   401 again.

`deploy/compose.yaml` is the production compose file: the app container and
Postgres. Variable names are in `deploy/.env.example`; the values are set in the
Dokploy environment only. The workflow needs the repository secret
`DOKPLOY_API_KEY`. To roll back, re-run the Deploy workflow of an earlier commit
from the Actions tab.

A stop or deploy is graceful: the orchestrator stops taking new jobs and
finishes the running ones (up to `JOB_WORKER_SHUTDOWN_GRACE_MS`, default 5
minutes). Compose allows 6 minutes before it kills the container. The site is
down while a running publish finishes.

## License

MIT
