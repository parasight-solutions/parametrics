# Sprint 2 — Phase 1 Closeout Proof Pack

Status: COMPLETE (pending GPT verification)

This proof pack is the single source of truth for the Sprint 2 (Phase 1) closeout.
It aggregates the report foundation, storage env hardening, audit / rate-limit
hardening, live smokes, and the workspace / member foundation into one final
record of what is complete, what remains risky, and what should happen next.

Task: S2-30 (Phase 1 / Sprint 2 — Final Closeout).

## Scope Reminder

ParaMetrics is a Google Business Profile first operations app. Sprint 2 focused on
the report foundation: generating, persisting, listing, and downloading reports,
plus the supporting storage and security hardening, and the workspace / member
foundation that backs tenancy. Phase 2 provider adapters remain blocked.

This closeout is docs-only. No backend code, frontend code, routes, tests, or
dependencies were changed by S2-30.

## Source Proof Packs And References

- `docs/proof/sprint-2-report-foundation-proof-pack.md`
- `docs/proof/s2-28-report-storage-env-hardening.md`
- `docs/proof/s2-29-report-audit-rate-limit-hardening.md`
- `docs/proof/s2-29-1-report-audit-rate-limit-live-smoke.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`
- `docs/architecture/report-service.md`
- `docs/architecture/report-history-and-storage.md`
- `docs/runtime/processes.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`

## Current State vs Target State

Current state (delivered in Sprint 2):

- Report metadata abstraction with a normalized metadata contract.
- Synchronous PDF / XLSX generation within the request lifecycle.
- Report persistence: metadata in Mongo, binary artifacts on durable local disk.
- Dashboard snapshot generation route and frontend generation action.
- Durable local disk storage under `REPORT_STORAGE_LOCAL_DIR`, validated at
  startup (fail-fast).
- Listing API and output download API, organization-scoped.
- Report history UI with per-row download.
- Audit metadata and in-process rate limiting on report endpoints.
- Workspace / member foundation (`organization_members`) with member-management
  API and UI.

Target state (deferred, NOT implemented in Sprint 2):

- Pluggable cloud object storage (S3-style) behind the same metadata contract.
- Async report generation queue (worker role).
- Scheduled reports and email delivery (scheduler role).
- Distributed rate limiting (e.g. Redis-backed token bucket).
- Report detail / regenerate flow and saved dashboards / report templates.
- Phase 2 provider adapters.

Current and target state are kept explicitly separate. No target-state feature is
represented as present.

## Final Completed Sprint 2 Scope

All of the following are complete:

- Report metadata abstraction.
- PDF / XLSX generation (synchronous).
- Report persistence (metadata + durable local artifacts).
- Dashboard snapshot route.
- Frontend dashboard generation action.
- Durable local storage under `REPORT_STORAGE_LOCAL_DIR`.
- Listing API (`GET /api/v1/reports/runs`).
- Output download API (`GET /api/v1/reports/runs/:runId/outputs/:format`).
- Dashboard snapshot generation route (`POST /api/v1/reports/dashboard-snapshot`).
- Report history UI (`/reports/history`).
- Storage env hardening (S2-28).
- Audit / rate-limit hardening (S2-29).
- All live smokes (S2-29.1 committed and pushed).

## Workspace / Member Foundation Status

- `organization_members` foundation complete: membership rows link users to
  organizations with a role.
- Member-management UI / API complete: list members, add by existing
  `user_id`, update role, and disable — scoped by `organization_members` with
  owner/admin role rules and last-owner protection. A minimal authenticated
  `/organization-members` page wires these routes.
- Scope limitations remain documented (see
  `docs/backlog/sprint-2-workspace-member-foundation.md`):
  - Membership is by existing app `user_id` only; no email invitation delivery
    or invitation-token issuance / acceptance / resend / cancellation.
  - No nested teams / sub-organizations and no cross-organization transfer.
  - No granular per-resource permissions (role-level only).
  - No safe delete/cleanup route for fixture / smoke memberships.

## Security / Tenancy Summary

- Authorization is enforced via `organization_members` on all report and
  member-management routes.
- No JWT role shortcuts. Roles are resolved from `organization_members`, never
  from JWT claims.
- `location_org_map` (and `locations.org_id`) remain legacy compatibility only
  and are never used as an authorization source; canonical scope is loaded
  server-side from the location/org/client documents.
- No raw buffers or base64 payloads are stored in Mongo; only metadata rows
  (`report_runs.outputs[]` keeps `path: null`).
- No absolute filesystem paths are exposed to clients or logged; the storage
  root is only ever emitted as a redacted label.
- Audit metadata is sanitized: no JWTs, tokens, authorization headers, raw user
  records, emails, absolute paths, or `storage_key`.
- Dedicated rate-limit buckets are in place for report generation, listing, and
  download, keyed per authenticated user (`req.user.user_id`, IP fallback).
- Organization scoping is derived from the authenticated session, never from
  request input; no cross-organization leakage observed in live smoke (S2-29.1).

## Tests / Build Summary

Run by S2-30 (this closeout):

- API (`cd apps/api && npm test`): 203 tests passed, 0 failed, 0 skipped.
- Web (`cd apps/web && npm test -- --run`): 5 test files, 49 tests passed,
  0 failed.
- Web build (`cd apps/web && npm run build`): success, 288 modules transformed.
  Browserslist "caniuse-lite is 8 months old" warning present and unchanged
  (non-blocking).
- `git diff --name-only -- apps/api/src apps/web/src apps/api/package.json
  apps/web/package.json package-lock.json`: empty (no code or dependency changes).
- `git diff --check`: clean (no whitespace errors).

## Remaining Risks

- Report storage is still local disk, not cloud object storage. Durability and
  multi-node availability depend on the deployment host's disk.
- Rate limiting is in-process (single-node); distributed rate limiting is not
  implemented. Multiple API nodes would each enforce their own buckets.
- Report generation is still synchronous within the request lifecycle; large
  reports can hold the request open.
- No scheduled report queue or email delivery.
- No report detail / regenerate flow.
- No Phase 2 providers.
- Browserslist warning during web build is unchanged (cosmetic, non-blocking).

## Pass / Not Pass

PASS.

All Sprint 2 report-foundation, storage-hardening, audit/rate-limit, and
workspace/member foundation scope is complete. All API and web tests pass, the
web build succeeds, there are no code or dependency diffs from this docs-only
closeout, and `git diff --check` is clean. Remaining items are documented as
deferred target-state work, not Sprint 2 gaps.

## Recommended Next Phase 1 Work

1. Deployment env checklist for `REPORT_STORAGE_LOCAL_DIR` (absolute path,
   writable by the API user, durable non-ephemeral storage).
2. Production smoke after deploy (generate / list / download / rate-limit) on the
   real environment.
3. Workspace / member assignment UX polish if needed (within documented scope
   limitations).
4. Then saved dashboards / report templates — only if explicitly approved.

## Phase 2 Status

Phase 2 provider adapter work remains BLOCKED until explicit approval. No provider
adapter scaffolding, provider routes, or provider config are in scope.

## GPT Decision

Pass.

The Sprint 2 final closeout proof pack was verified after docs-only review, API npm test, web tests, web build, no-source-diff checks, no-lockfile-diff checks, and diff checks.
