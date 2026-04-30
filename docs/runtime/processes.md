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

API CORS behavior:

- Local development and test allow localhost origins, including `localhost`, `127.0.0.1`, and `::1`.
- Production, staging, and other non-local environments must set `CORS_ORIGINS`.
- Non-local API startup fails fast if `CORS_ORIGINS` is missing.
- Wildcard or reflect-all CORS is not allowed with credentials.
- Requests without an `Origin` header, such as server-to-server or curl requests, continue without browser CORS headers.

API rate limiting behavior:

- Phase 0 rate limiting is in-memory and per API process. It is a baseline protection only; horizontally scaled deployments need Redis-backed distributed limiting as a hardening follow-up.
- Basic health checks are not rate-limited.
- Sensitive endpoints return HTTP `429` with JSON `error.code: "rate_limited"` and `error.retry_after_seconds`.
- Authenticated route limit keys prefer `req.user.user_id`; unauthenticated route limit keys fall back to client IP. Each limiter includes its action bucket in the key.

## Worker Process

Package command:

```bash
npm run -w @parametrics/api start:workers
```

Existing local alias:

```bash
npm run -w @parametrics/api dev:workers
```

Entrypoint:

```bash
apps/api/src/workers/index.js
```

The worker process imports `apps/api/src/startup/env.js`, then explicitly imports worker modules for their BullMQ registration side effects.

Currently registered workers:

- `post-generate`: registered by `apps/api/src/workers/postGenerate.worker.js`; consumes the `post-generate` queue, uses Redis, MongoDB, and OpenAI configuration.
- `post-publish`: registered by `apps/api/src/workers/postPublish.worker.js`; consumes the `post-publish` queue, uses Redis, MongoDB, encrypted Google integration secrets, and Google provider configuration.
- `review-sync`: registered by `apps/api/src/workers/reviewSync.worker.js`; consumes the `review-sync` queue, uses Redis, MongoDB, encrypted Google integration secrets, and Google provider configuration.

Worker files that exist but are not registered by `apps/api/src/workers/index.js` today:

- `apps/api/src/workers/contentGen.worker.js`
- `apps/api/src/workers/imageGen.worker.js`
- `apps/api/src/workers/notify.worker.js`

Do not assume those legacy/placeholder workers run in production unless they are explicitly imported by the worker entrypoint in a future task.

The worker command does not start the Express API server and does not import `apps/api/src/jobs/scheduler.js`.

## Scheduler Process

Package command:

```bash
npm run -w @parametrics/api start:scheduler
```

Existing local alias:

```bash
npm run -w @parametrics/api dev:scheduler
```

Entrypoint:

```bash
apps/api/src/jobs/scheduler.js
```

The scheduler process imports `apps/api/src/startup/env.js`, creates a BullMQ queue handle for `post-publish`, and registers scheduler loops only. It does not start the Express API server and does not import `apps/api/src/workers/index.js`.

Currently registered scheduler loops:

- Scheduled publish poller: registered by `apps/api/src/jobs/scheduler.js`; runs every minute with cron expression `* * * * *`.

The scheduled publish poller currently:

- Reads due `posts` records from MongoDB where `status` is `scheduled`, `scheduled_at` is due, and AI content is done or not tracked.
- Atomically moves matching posts to `status: "queued"`.
- Enqueues BullMQ jobs on the `post-publish` queue with job name `scheduled-publish`.
- Uses job ids shaped as `publish_${postId}`.

Job files that exist but are not run by `apps/api/src/jobs/scheduler.js` today:

- `apps/api/src/jobs/recurrence.js`

Do not assume recurrence planning runs in the scheduler production command unless it is explicitly imported by the scheduler entrypoint in a future task.

## Required API Environment

API startup currently expects:

- `NODE_ENV`: use `development` locally; use a non-local value such as `staging` or `production` in deployed environments.
- `JWT_SECRET`: required and strong outside `NODE_ENV=development` or `NODE_ENV=test`.
- `MONGODB_URI` or `MONGO_URI`: MongoDB connection string. Defaults exist for local development only.
- `MONGO_DB`, `MONGO_DB_NAME`, or `MONGODB_DB`: database name. Defaults to `parametrics`.
- `APP_ENC_KEY` or `ENCRYPTION_KEY`: required by encrypted Google integration secret handling.
- `PORT`: optional; defaults to `5050`.
- `CORS_ORIGINS`: comma-separated browser origins allowed to call the API with credentials. Required outside `NODE_ENV=development` or `NODE_ENV=test`. Example: `https://app.parametrics.example`.
- `RATE_LIMIT_WINDOW_SECONDS`: shared rate-limit window in seconds. Defaults to `600`.
- `RATE_LIMIT_AUTH_MAX`: login attempts per window per IP. Defaults to `10`.
- `RATE_LIMIT_OAUTH_MAX`: OAuth start/callback attempts per window per IP. Defaults to `20`.
- `RATE_LIMIT_UPLOAD_MAX`: upload attempts per window per user/IP. Defaults to `30`.
- `RATE_LIMIT_SYNC_MAX`: Google/GBP/review sync trigger attempts per window per user/IP. Defaults to `10`.
- `RATE_LIMIT_GENERATION_MAX`: AI generation, plan-now, create/publish retry attempts per window per user/IP. Defaults to `20`.
- `RATE_LIMIT_MUTATION_MAX`: generic mutation attempts per window per user/IP. Defaults to `120`.
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

## Required Worker Environment

Worker startup currently expects:

- `NODE_ENV`: use `development` locally; use a non-local value such as `staging` or `production` in deployed environments.
- `JWT_SECRET`: required and strong outside `NODE_ENV=development` or `NODE_ENV=test` because the shared startup environment guard runs in the worker process.
- `MONGODB_URI` or `MONGO_URI`: MongoDB connection string. Defaults exist for local development only.
- `MONGO_DB`, `MONGO_DB_NAME`, or `MONGODB_DB`: database name. Defaults to `parametrics`.
- `REDIS_HOST`, `REDIS_PORT`, and `REDIS_TLS`: Redis connection settings used by BullMQ workers and queues.
- `APP_ENC_KEY` or `ENCRYPTION_KEY`: required before workers that import Google integration secret handling can start.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: required when publish or review-sync jobs need to refresh Google provider access tokens.
- `OPENAI_API_KEY`: required when `post-generate` jobs call OpenAI.
- Optional worker tuning variables currently read by `post-generate`:
  - `POST_GEN_CONCURRENCY`
  - `POST_GEN_ATTEMPTS`
  - `POST_GEN_REQUEUE_MS`
  - `POST_GEN_STALE_WORKING_MS`
  - `POST_GEN_WINDOW_HOURS`
  - `OPENAI_POST_MODEL`

Redis is required for worker startup because BullMQ `Worker` instances connect to Redis immediately. MongoDB is used by all currently registered worker modules during job handling, and `post-generate` also uses MongoDB on boot for stale/pending post healing.

Current worker shutdown behavior: no explicit `SIGTERM`/`SIGINT` handlers are registered in `apps/api/src/workers/index.js` or the registered worker modules. Production process managers should send normal termination signals and apply a grace period; future hardening should close BullMQ workers and Redis/Mongo connections explicitly.

## Required Scheduler Environment

Scheduler startup currently expects:

- `NODE_ENV`: use `development` locally; use a non-local value such as `staging` or `production` in deployed environments.
- `JWT_SECRET`: required and strong outside `NODE_ENV=development` or `NODE_ENV=test` because the shared startup environment guard runs in the scheduler process.
- `MONGODB_URI` or `MONGO_URI`: MongoDB connection string. Defaults exist for local development only.
- `MONGO_DB`, `MONGO_DB_NAME`, or `MONGODB_DB`: database name. Defaults to `parametrics`.
- `REDIS_HOST`, `REDIS_PORT`, and `REDIS_TLS`: Redis connection settings used by the BullMQ queue handle that enqueues publish jobs.

Redis is required because the scheduler enqueues jobs into BullMQ. MongoDB is required because the scheduler polls and updates the `posts` collection.

Current scheduler shutdown behavior: no explicit `SIGTERM`/`SIGINT` handlers are registered in `apps/api/src/jobs/scheduler.js`. Production process managers should send normal termination signals and apply a grace period; future hardening should stop cron tasks and close Redis/Mongo connections explicitly.

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

Recommended worker command for a process manager:

```bash
npm run -w @parametrics/api start:workers
```

Recommended scheduler command for a process manager:

```bash
npm run -w @parametrics/api start:scheduler
```

Run workers and scheduler as separate process-manager services using their package commands. Do not rely on one combined command for production/staging.

## Verified In S1-06

This task verifies:

- The API has a dedicated package command: `npm run -w @parametrics/api start`.
- The API package keeps `dev:api` as the local alias for `src/server.js`.
- API startup is separate from `dev:workers` and `dev:scheduler`.
- Worker and scheduler entrypoints exist and are documented as separate runtimes.
- Runtime documentation captures the current startup contract.

## Verified In S1-07

This task verifies:

- The worker has a dedicated production-style package command: `npm run -w @parametrics/api start:workers`.
- The package keeps `dev:workers` as the local alias for `src/workers/index.js`.
- The worker command does not start the API server.
- The worker command does not start scheduler loops.
- The worker entrypoint explicitly imports the currently registered worker modules.
- Runtime documentation captures the worker startup contract, dependencies, registered queues, shutdown behavior, and hardening gaps.

## Verified In S1-08

This task verifies:

- The scheduler has a dedicated production-style package command: `npm run -w @parametrics/api start:scheduler`.
- The package keeps `dev:scheduler` as the local alias for `src/jobs/scheduler.js`.
- The scheduler command does not start the API server.
- The scheduler command does not start BullMQ workers.
- The scheduler entrypoint currently registers the scheduled publish poller only.
- Runtime documentation captures the scheduler startup contract, dependencies, cron frequency, enqueue behavior, shutdown behavior, and hardening gaps.

## Remaining Work

Remaining runtime work includes:

- Production process-manager examples.
- Health/readiness checks that do not mutate data.
- CI or smoke checks for runtime startup without long-running commands.
- Explicit graceful shutdown for scheduler cron tasks, BullMQ workers, Redis connections, and MongoDB connections.
- Redis-backed distributed rate limiting for multi-process or horizontally scaled deployments.
