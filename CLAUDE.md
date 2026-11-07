This project is Omninoise, a self-hosted fork of Postiz (the README calls it omninoise): a tool to schedule social media and chat posts to 28+ channels.
This repository is PUBLIC. It holds only the application: backend, orchestrator, frontend, shared libraries and the deployment files in `deploy/`.
Agent skills, the `omninoise` CLI, the video/carousel studio, voice tooling and channel content are NOT part of this repo. They live in the private ops repo `cuongtranba/omninoise-ops` (see its ADR 0037); do not add them here.
You can add posts to the calendar, they will be added into the job queue and posted at the right time.
You can find things like:
- Schedule posts
- Calendar view
- Analytics
- Team management
- Media library

This project is a monorepo: the root package.json holds the dependencies and the tasks, and each app in apps/ has a small package.json with its own scripts (dev/build, publish for apps/sdk); libraries/ has none.
Made with PNPM; tasks run with Vite+ (`vp`).
We have 4 important folders

- apps/backend - this is where the API code is (NESTJS)
- apps/orchestrator - this runs the background jobs (NESTJS): a Postgres job queue (`pgonly.jobs`, see `libraries/nestjs-libraries/src/jobs`) with the job handlers in `jobs/` and the services they call in `activities/`
- apps/frontend - this is the code of the frontend (Vite + React single-page app, react-router)
- /libraries contains a lot of services shared between backend and orchestrator and frontend components.

We are using only pnpm, don't use any other dependency manager.
Never install frontend components from npmjs, focus on writing native components.

The project uses tailwind 3, before writing any component look at:
- /apps/frontend/src/app/colors.scss
- /apps/frontend/src/app/global.scss
- /apps/frontend/tailwind.config.cjs

All the --color-custom* are deprecated, don't use them.

And check other components in the system before to get the right design.

When working on the backend we need to pass the 3 layers:
DTO >> Controller >> Service >> Repository (no shortcuts)
In some cases we will have
DTO >> Controller >> Manager >> Service >> Repository.

Most of the server logic should be inside of libraries/nestjs-libraries.
The backend repository is mostly used to write controller, and import files from libraries/nestjs-libraries.

For the frontend follow this:
- Many of the UI components lives in /apps/frontend/src/components/ui
- Routing: pages and layouts live in /apps/frontend/src/app, and /apps/frontend/src/router.tsx maps URLs to them (react-router, lazy routes). Auth redirects are client-side in /apps/frontend/src/app/route.guard.tsx.
- Runtime settings reach the browser through `window.__RUNTIME_CONFIG__`, built from env by /apps/frontend/runtime-config.mjs (served in dev by the Vite config, written by the Docker entrypoint in production) and read with `useVariables()`. Never put a secret in it, and never read `process.env` in frontend code.
- Components are in /apps/frontend/src/components
- always use SWR to fetch stuff, and use "useFetch" hook from /libraries/helpers/src/utils/custom.fetch.tsx

When using SWR, each one have to be in a separate hook and must comply with react-hooks/rules-of-hooks, never put oxlint-disable-next-line (or eslint-disable-next-line) on it.

It means that this is valid:
const useCommunity = () => {
   return useSWR....
}

This is not valid:
const useCommunity = () => {
  return {
    communities: () => useSWR<CommunitiesListResponse>("communities", getCommunities),
    providers: () => useSWR<ProvidersListResponse>("providers", getProviders),
  };
}

- The toolchain is Vite+ (`vp`): Oxlint for lint, Oxfmt for format, Vitest for tests. Lint, format and test only from the root, where `vite.config.ts` holds their config: `vp lint`, `vp fmt`, `vp check` (lint + format check, what CI runs), `vp test`. Run package.json scripts with `vp run <script>` (e.g. `vp run dev`, `vp run build`, `vp run prisma-db-push`); `vp build` and `vp dev` are Vite's built-ins and skip the scripts. Without the global `vp` CLI, prefix with `pnpm exec`.
- Never use `// @ts-ignore`, `// @ts-expect-error` or `// @ts-nocheck`, and don't swap them for `as any` or `as unknown as`. Fix the type instead. Lint enforces this (`typescript/ban-ts-comment`).
- Use only pnpm to install and add dependencies (`pnpm install`, `pnpm add`), not `vp install`/`vp add`.
- Never use RAW SQL queries, always use Prisma. The one exception is the `pgonly` schema, which Prisma does not manage: the job queue, the key-value and throttle tables, and the TimescaleDB analytics hypertables (`libraries/nestjs-libraries/src/database/prisma/analytics`). They use the `pg` pool from `libraries/nestjs-libraries/src/pg/pg.pool.ts` with parameterised queries and idempotent DDL through `ensurePgOnlySchema`; never `$queryRaw`, and never raw SQL on Prisma's `public` tables.
- The system is in production with many users, if you want to change something, you need to be sure that you are not breaking anything for existing users and a migration might be needed
- Whenever you generate a PR, PR description, or similar, **always** follow the PR Template (.github/PULL_REQUEST_TEMPLATE.md)
- Every PR description **must** contain a `# QA` section with real, numbered steps a reviewer can follow to verify the change (setup, action, expected result), written so they can be run without asking the author anything. This is not optional and applies to humans and agents alike, including one-line fixes. The section is extracted verbatim and shown on the review board, so:
  - Use the exact heading `# QA` (`# Testing`, `# Test plan`, `# How to test`, `# How to verify`, `# Verification`, `# Steps to test` and `# Manual testing` are also recognised, but prefer `# QA`). The whole heading must match, so something like `## Testing philosophy` is not picked up.
  - Never leave the template placeholder in place, and never write `N/A`, `TBD`, `todo`, `none` or a bare empty checkbox as the whole section - those all count as no QA at all and the board will show the PR as missing testing notes.
  - Steps inside a fenced code block are ignored, so keep them as plain numbered lines. Write each step as a numbered checkbox (`1. [ ] step`) so a reviewer can tick it off while working through it - the numbering is what the board extracts, the checkbox is for the reviewer.
- Every PR description **must** answer `# What kind of change does this PR introduce?` with actual detail, not just a category. `Bug fix.` / `Feature.` on its own is not acceptable. State the type, the area it touches (backend, frontend, orchestrator, a specific provider or screen), and in one to three sentences what concretely changed and where - the key function, endpoint, file or field - plus what deliberately stayed the same. A reader should understand the change from this section alone, without opening the diff.
- Avoid as much as possible creating new files with pure logic of algorithms, it's usually wrong
- When you write code, make sure that what you add looks like something similar somewhere else in the code, don't make weird patterns
- When you finished running, run another agents that matches the new code with the existing system code, to see that it looks similar and is not a weird pattern.
- Background work runs on the Postgres job queue (`pgonly.jobs`; queue code in `libraries/nestjs-libraries/src/jobs`, handlers in `apps/orchestrator/src/jobs`, the services they call in `apps/orchestrator/src/activities`). Jobs are persisted rows, so the payload of a job that is already queued outlives the deploy that enqueued it. A handler is registered by its `kind` string (`worker.register('post.publish', ...)`), and a row whose kind has no handler fails and is retried. Therefore never rename or remove a registered `kind`, and never change the shape of its payload in a way that breaks rows already in the table (remove a field, rename it, change its type, make an optional field required): add new fields as optional and read them defensively, or register a new `kind` and enqueue that one from every place that enqueues the old one. Keep the old handler until its queued jobs are gone.
- Activity methods in `apps/orchestrator/src/activities` take a single object of ids (see the comment in `clipping.activity.ts`), so a field can be added to that object without a new activity. Do not change the existing positional or required parameters of an activity that a registered job calls; add an optional field or create a new activity.
- Code must always be generic, there can't be a way that a specific logic, let's say facebook or instagram, appear in a file that use a generic logic, instead, we need to edit the interface of the provider, add another function, and then generically call it from the generic code, and then implement the specific logic in the provider implementation. we can't have something like if(facebookProvider) {} inside a non facebook provider file.
- Before adding a field to a shared repository/service `select` or changing a shared method's return shape, grep for all its consumers (frontend, public API, MCP/agent tools, orchestrator, webhooks) and confirm the change is intended for each.
- Exposing a stored field to a new external surface (public API, MCP, webhooks) is a data-exposure decision — ask first, and check what existing production rows hold for that column before shipping it.
- Every web route in `apps/backend/src/api/routes` must have an MCP tool (`libraries/nestjs-libraries/src/chat/tools`) that lists it in `mirrors` and calls the same service method, or an entry in `EXCLUDED` in `libraries/nestjs-libraries/src/chat/mcp.parity.spec.ts` with the reason; the spec fails CI otherwise. A tool for a super-admin route must run the same check through `UsersService.assertSuperAdminById`.
- Never silently change the meaning or format of a value persisted in an existing DB column; that affects every reader and all historical rows, so ask first. 
- Never return a raw Prisma row from a model that holds credentials (`Integration`, `User` and similar) in a controller response. Repository writes on those models must use a `select` with only the fields the caller needs (like `setTimes` with `select: { id: true }`), or the controller returns nothing. This applies even where nearby code looks different.
- Be extra careful with code invoked by webhooks of external systems (Stripe, RevenueCat and other payment providers), including everything they call down the stack (e.g. `SubscriptionService.createOrUpdateSubscription`, `modifySubscription`, `deleteSubscription`). That code must not throw exceptions: never add a `throw`, and wrap any call that can fail (DB, provider API) so a failure is caught and logged instead of propagating. A webhook that throws leaves billing state half-applied for a paying customer.
