# ParaMetrics Runtime Processes

ParaMetrics is currently a Google Business Profile first operations app with three backend runtime roles. Keep these roles separate in local development, staging, and production.

## Current Runtime Model

The backend lives in `apps/api` and uses Express, MongoDB, Redis, BullMQ, and `node-cron`.

Current backend process roles:

- API process: serves HTTP routes and performs startup environment/index checks.
- Worker process: runs BullMQ workers for background jobs.
- Scheduler process: polls scheduled records and enqueues due work.

Do not replace this with one combined production process. The root `npm run dev` convenience command can run multiple processes for local development, but production/staging should manage each runtime independently.

## API Process

Package command:

```bash
npm run -w @parametrics/api start
```

Entrypoint:

```bash
apps/api/src/server.js
```

Existing local alias:

```bash
npm run -w @parametrics/api dev:api
```

The API process imports `apps/api/src/startup/env.js`, mounts Express routes, runs `ensureIndexes()`, and then starts listening on `PORT` or `5050`.

The API command does not start workers or the scheduler.

## Worker Process

Package command:

```bash
npm run -w @parametrics/api dev:workers
```

Entrypoint:

```bash
apps/api/src/workers/index.js
```

Current status: existing/partial. The entrypoint imports worker modules for post generation, post publishing, and review sync. This task documents the boundary only; it does not verify worker job behavior end to end.

## Scheduler Process

Package command:

```bash
npm run -w @parametrics/api dev:scheduler
```

Entrypoint:

```bash
apps/api/src/jobs/scheduler.js
```

Current status: existing/partial. The scheduler currently polls scheduled posts and enqueues publish jobs. This task documents the boundary only; it does not verify scheduler job behavior end to end.

## Required API Environment

API startup currently expects:

- `NODE_ENV`: use `development` locally; use a non-local value such as `staging` or `production` in deployed environments.
- `JWT_SECRET`: required and strong outside `NODE_ENV=development` or `NODE_ENV=test`.
- `MONGODB_URI` or `MONGO_URI`: MongoDB connection string. Defaults exist for local development only.
- `MONGO_DB`, `MONGO_DB_NAME`, or `MONGODB_DB`: database name. Defaults to `parametrics`.
- `APP_ENC_KEY` or `ENCRYPTION_KEY`: required by encrypted Google integration secret handling.
- `PORT`: optional; defaults to `5050`.
- `REDIS_HOST`, `REDIS_PORT`, and `REDIS_TLS`: currently needed because API route modules initialize BullMQ queues for enqueue operations, even though the API process does not run workers.
- Google auth/provider variables as needed by Google login and GBP integration routes:
  - `GOOGLE_OIDC_CLIENT_ID`
  - `GOOGLE_OIDC_CLIENT_SECRET`
  - `GOOGLE_OIDC_REDIRECT_URI`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI`
  - `GOOGLE_POST_CONNECT_REDIRECT`

Worker and scheduler processes also need the same Redis configuration:

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_TLS`

## Local Development

Run only the API:

```bash
npm run -w @parametrics/api dev:api
```

Run all local backend roles together:

```bash
npm run -w @parametrics/api dev
```

From the repo root, the existing convenience command starts API, workers, scheduler, and web:

```bash
npm run dev
```

Use the single-process API command when debugging HTTP route behavior or auth behavior so worker/scheduler side effects do not confuse the run.

## Production And Staging

Recommended API command for a process manager:

```bash
npm run -w @parametrics/api start
```

Run workers and scheduler as separate process-manager services using their package commands. Do not rely on one combined command for production/staging.

## Verified In S1-06

This task verifies:

- The API has a dedicated package command: `npm run -w @parametrics/api start`.
- The API package keeps `dev:api` as the local alias for `src/server.js`.
- API startup is separate from `dev:workers` and `dev:scheduler`.
- Worker and scheduler entrypoints exist and are documented as separate runtimes.
- Runtime documentation captures the current startup contract.

## Remaining Work

S1-07/S1-08 should cover deeper runtime hardening, such as:

- Worker startup contract and failure behavior.
- Scheduler startup contract and failure behavior.
- Production process-manager examples.
- Health/readiness checks that do not mutate data.
- CI or smoke checks for runtime startup without long-running commands.
