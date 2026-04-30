# Sprint 1 / Phase 0 Proof Pack

Date: 2026-05-01

## Scope Statement

Sprint 1 / Phase 0 was stabilization only. The completed work hardened the current Google Business Profile first product without adding Phase 2 channels, tenant switching UI, audit UI, broad architecture rewrites, or fake tenant behavior.

Phase 0 changes were allowed when they improved correctness, data isolation, auth safety, runtime determinism, or proofability. The current stack remains:

- Frontend: `apps/web` React/Vite.
- Backend: `apps/api` Express, MongoDB native driver, Redis, BullMQ.
- Runtime roles: API, workers, and scheduler are separate production-style processes.

## Current State Vs Target State

Current state:

- ParaMetrics is a GBP-first operations app.
- App auth and Google provider auth are separate flows.
- Locations can be imported from Google without automatic org/client binding.
- Explicit location binding writes canonical `organization_id` and `client_id`.
- Backend ownership guards fail closed for stale, unowned, or unbound scoped data.
- Critical backend actions write best-effort sanitized audit records to MongoDB `audit_logs`.

Target state:

- ParaMetrics is heading toward a multi-tenant, multi-channel SaaS.
- Future work may add stronger tenant/org/client boundaries, additional providers, audit UI/API, distributed rate limiting, readiness checks, and clearer process management.
- Target-state concepts are guardrails only in Phase 0; they are not assumed implemented unless verified.

## Completed Task List

- S1-01 canonical tenancy model: defined the intended organization/client/location ownership chain.
- S1-02 tenancy fields/migration: added tenancy-related fields, default client direction, and index/migration work.
- S1-03 ownership guards: added backend checks for stale or unauthorized location-scoped data.
- S1-04 Google app auth keep/fix: preserved app auth while keeping Google provider auth separate.
- S1-04.2 frontend stale state reset: cleared app-owned UI/cache state on auth identity changes, logout, and stale location conditions.
- S1-05 auth shortcut hardening: production/staging JWT auth fails closed and requires a strong `JWT_SECRET`.
- S1-06 API process entrypoint: documented and verified dedicated API startup command.
- S1-07 worker process entrypoint: documented and verified dedicated worker startup command.
- S1-08 scheduler process entrypoint: documented and verified dedicated scheduler startup command.
- S1-09 location-org mapping direction: established canonical location fields as source of truth while preserving legacy compatibility.
- S1-10 tenancy migration audit: verified safe dry-run/apply migration behavior without auto-binding imported locations.
- S1-11 environment-restricted CORS: required explicit non-local CORS origins and disallowed wildcard/reflect-all behavior with credentials.
- S1-12 sensitive endpoint rate limiting: added centralized in-memory rate limits with consistent JSON `429` responses.
- S1-13 backend audit logging: added best-effort audit logging for critical backend actions without exposing secrets or user-facing audit APIs.
- S1-14 final Phase 0 proof pack: verification/docs-only proof pack for runtime expectations and remaining risks.

## Recent Commit List

Recent `git log --oneline -n 14`:

```text
68a90ee feat(api): add audit logging for critical actions
4b1871f fix(api): add rate limiting to sensitive endpoints
a8bf586 fix(api): restrict CORS origins outside local development
acda82b chore(api): verify safe tenancy migration audit
c08d78a refactor(api): formalize canonical location binding model
3a7d687 chore(api): document dedicated scheduler runtime process
c37e2e7 chore(api): document dedicated worker runtime process
1e143a9 chore(api): document dedicated API runtime process
5b30a29 fix(api): harden app JWT auth outside local development
dc6fbd4 chore(repo): remove uploaded source archive artifacts
2f8c7c7 feat(api): stabilize tenancy ownership and Google auth
eaf26bf fix(web): reset stale session state on auth user switch
ad4c13f reviews improved and login fixed
5bca4b0 Initial Commit
```

S1-14 is not committed in this proof pack.

## Runtime Commands

API:

```bash
npm run -w @parametrics/api start
```

Workers:

```bash
npm run -w @parametrics/api start:workers
```

Scheduler:

```bash
npm run -w @parametrics/api start:scheduler
```

Web test/build:

```bash
npm test -- --run
npm run build
```

Run web commands from `apps/web` or with the matching workspace selector.

## Required Production/Staging Env Vars

Core:

- `NODE_ENV`: use non-local values such as `staging` or `production`.
- `JWT_SECRET`: required outside `development`/`test`; must be strong and at least 32 characters.
- `PORT`: optional for API; defaults to `5050`.

CORS:

- `CORS_ORIGINS`: required outside `development`/`test`; comma-separated allowed browser origins. Wildcard origins are forbidden.

MongoDB:

- `MONGODB_URI` or `MONGO_URI`: MongoDB connection string.
- `MONGO_DB`, `MONGO_DB_NAME`, or `MONGODB_DB`: database name.

Redis:

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_TLS`

Encryption:

- `APP_ENC_KEY` or `ENCRYPTION_KEY`: required for encrypted Google integration secrets.

Google app auth / provider integration:

- `GOOGLE_OIDC_CLIENT_ID`
- `GOOGLE_OIDC_CLIENT_SECRET`
- `GOOGLE_OIDC_REDIRECT_URI`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_POST_CONNECT_REDIRECT`

OpenAI / worker generation:

- `OPENAI_API_KEY`
- `OPENAI_POST_MODEL` optional.
- `POST_GEN_CONCURRENCY` optional.
- `POST_GEN_ATTEMPTS` optional.
- `POST_GEN_REQUEUE_MS` optional.
- `POST_GEN_STALE_WORKING_MS` optional.
- `POST_GEN_WINDOW_HOURS` optional.

Rate limiting:

- `RATE_LIMIT_WINDOW_SECONDS`
- `RATE_LIMIT_AUTH_MAX`
- `RATE_LIMIT_OAUTH_MAX`
- `RATE_LIMIT_UPLOAD_MAX`
- `RATE_LIMIT_SYNC_MAX`
- `RATE_LIMIT_GENERATION_MAX`
- `RATE_LIMIT_MUTATION_MAX`

## Verification Commands To Run

Backend package/script inspection:

```bash
cd apps/api && npm run
```

Backend syntax:

```bash
cd apps/api && node --check src/server.js src/startup/env.js src/lib/authConfig.js src/lib/corsConfig.js src/middleware/rateLimit.js src/services/auditLog.js src/startup/ensureIndexes.js
```

Backend focused node tests:

```bash
cd apps/api && node --test src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
```

Expected missing backend package test script check:

```bash
cd apps/api && npm test
```

Web checks:

```bash
cd apps/web && npm test -- --run
cd apps/web && npm run build
```

Production guard helper smokes:

```bash
node --input-type=module -e "process.env.NODE_ENV='production'; delete process.env.JWT_SECRET; const { getJwtSecret } = await import('./apps/api/src/lib/authConfig.js'); try { getJwtSecret(); console.log('unexpected success'); process.exit(1); } catch (e) { console.log(e.message); }"
node --input-type=module -e "const { resolveAllowedOrigins } = await import('./apps/api/src/lib/corsConfig.js'); try { resolveAllowedOrigins({ NODE_ENV: 'production' }); console.log('unexpected success'); process.exit(1); } catch (e) { console.log(e.message); }"
node --input-type=module -e "process.env.NODE_ENV='production'; process.env.JWT_SECRET='0123456789abcdef0123456789abcdef'; const { getJwtSecret } = await import('./apps/api/src/lib/authConfig.js'); const { resolveAllowedOrigins } = await import('./apps/api/src/lib/corsConfig.js'); console.log(getJwtSecret().length); console.log(resolveAllowedOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.parametrics.example' }).join(','));"
```

Final diff check:

```bash
git diff --check
```

## Actual Verification Results

`git status --short` before edits:

```text
?? .codex
```

The untracked `.codex` entry was pre-existing/unrelated and was not touched.

`cd apps/api && npm run`: passed; listed API scripts:

- `start`
- `start:workers`
- `start:scheduler`
- `dev:api`
- `dev:workers`
- `dev:scheduler`
- `dev`
- `migrate`
- `seed`
- `migrate:tenancy:s1-02`
- `seed:mongo`

`cd apps/api && node --check ...critical files`: passed with no output.

`cd apps/api && node --test src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js`: passed.

```text
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 581.691605
```

`cd apps/api && npm test`: failed as expected because no backend `test` script exists.

```text
npm error Missing script: "test"
```

`cd apps/web && npm test -- --run`: passed.

```text
Test Files  2 passed (2)
Tests  6 passed (6)
Duration  565ms
```

`cd apps/web && npm run build`: passed.

```text
vite v7.1.7 building for production...
Browserslist: browsers data (caniuse-lite) is 8 months old.
282 modules transformed.
built in 6.69s
```

Production missing `JWT_SECRET` helper smoke: passed by failing closed with expected message.

```text
JWT_SECRET is required when NODE_ENV is not development or test
```

Production missing `CORS_ORIGINS` helper smoke: passed by failing closed with expected message.

```text
CORS_ORIGINS is required when NODE_ENV=production
```

Production strong `JWT_SECRET` plus explicit `CORS_ORIGINS` helper smoke: passed.

```text
32
https://app.parametrics.example
```

Full production-style API startup: not run. Importing/running `src/server.js` performs Mongo index setup, starts listening on a port, and imports route modules that initialize BullMQ queue handles. Avoided to prevent port conflicts, live Mongo/Redis dependency confusion, and long-running service behavior during docs-only verification.

Worker/scheduler production startup: not run. These commands connect to Redis and can register workers/scheduler loops. Avoided to prevent processing real jobs or starting long-running services.

Health check: not run because the API server was not started.

`git diff --check`: passed with no output.

## Known Risks And Follow-Ups

- No full backend `npm test` script exists yet; focused Node tests are run directly.
- Phase 0 rate limiting is in-memory and per API process.
- Redis-backed distributed rate limiting remains future hardening.
- Worker graceful shutdown remains future hardening.
- Scheduler graceful shutdown remains future hardening.
- Full readiness/health checks that avoid mutation remain future hardening.
- Audit logs are written server-side, but no audit UI/API exists yet.
- Audit logging is best-effort; Mongo audit write failures are logged server-side and do not fail user requests.
- No live production-style API/worker/scheduler startup was run in this verification pass.

## GPT Verification Decision

GPT decision: Pass.

Sprint 1 / Phase 0 proof pack is ready for commit. Remaining risks are documented and do not block Phase 0 completion.
