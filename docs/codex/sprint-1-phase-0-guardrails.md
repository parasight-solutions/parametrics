# Sprint 1 / Phase 0 Guardrails

These guardrails apply to ParaMetrics Sprint 1 / Phase 0 stabilization tasks.

## Current Product State

ParaMetrics is currently a Google Business Profile first operations app. The working frontend is `apps/web`, built with React and Vite. The backend is `apps/api`, built with Express, Mongo, Redis, and BullMQ.

The app already has Google app auth and Google provider integration flows. Some backend direction includes separate API, worker, and scheduler responsibilities, but Sprint 1 tasks must respect what is actually implemented today.

## Target State

The target state is a multi-tenant, multi-channel SaaS. Future architecture may include stronger tenant/org/client boundaries, multiple provider channels, and clearer API/worker/scheduler separation.

That target state is not implemented by assumption. It should guide safe naming and data modeling, but it must not be faked in the UI or backend.

## Completed S1 Items Summary

- S1-01 canonical tenancy model: Defined the intended tenancy concepts and direction.
- S1-02 tenancy fields/migration: Added tenancy-related fields and migration work.
- S1-03 ownership guards: Added backend ownership checks so stale or unauthorized location access is rejected.
- S1-04 Google app auth keep/fix: Preserved and stabilized app auth while keeping Google provider auth separate.
- S1-04.2 frontend stale state reset: Frontend reset behavior for auth identity switch, logout, stale location, and dashboard cache is committed.
- S1-05 auth shortcut hardening: Backend auth fails closed outside explicit local development, and app JWT auth relies on signature verification only.
- S1-06 API process entrypoint: API, worker, and scheduler runtimes remain separate, with an explicit API startup command and documented runtime contract.
- S1-07 worker process entrypoint in progress: worker startup gets a dedicated production-style command and documented runtime contract without starting API or scheduler runtimes.

## Explicit Forbidden Work

Do not add Phase 2 integrations. No new channels, provider platforms, or expanded SaaS features should be introduced during Phase 0 stabilization.

Do not fake tenant support. UI or backend code must not pretend tenant switching exists unless the supporting model and verified flows are part of the task.

Do not auto-bind imported Google locations. Imported Google locations must not be silently attached to an org/client just to make UI state look complete.

Do not loosen backend ownership guards. If a stale Beetle or other location id returns 404 for another user, that is correct backend behavior.

Do not broadly rewrite app architecture. Prefer narrow fixes with deterministic behavior and tests.

Do not mix unrelated working-tree changes into a stabilization commit. In particular, frontend-only tasks must not commit prior backend work.

## Auth And Provider Separation

ParaMetrics app auth and Google provider auth are separate.

Provider reauth problems, such as missing Google refresh tokens or invalid Google grants, should drive reconnect UI. They must not logout the ParaMetrics app user.

Only real app auth failures, such as invalid or unauthorized app JWTs, should clear app auth and redirect to login.

App JWT shortcuts are not allowed outside explicit local development. Production, staging, and other non-local environments must require a strong `JWT_SECRET` and must not accept unsigned, decoded-only, mock, or bypass tokens.

## Storage And Cache Discipline

Frontend state stored in `localStorage` or `sessionStorage` must be scoped and intentional. App-owned UI/cache keys may be cleared on logout or auth identity switch. Unrelated browser storage keys must not be cleared.

Same-user refresh should preserve valid app state. Cross-user login must not preserve selected location, dashboard metrics, Google account selections, or location-bound cache from the prior user.

## Commit Discipline

Every Sprint 1 / Phase 0 task needs a proof pack before commit:

- Scoped changed-file list.
- Scoped diff review.
- Relevant test/build output.
- Manual verification notes when browser behavior matters.
- Known risks and follow-ups.

No commit before GPT verification. No push before explicit approval.
