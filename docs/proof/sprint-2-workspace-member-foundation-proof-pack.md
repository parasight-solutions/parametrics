# Sprint 2 Workspace Member Foundation Proof Pack

Date: 2026-05-03

## Scope

S2-13 audited the Sprint 2 workspace/member foundation through S2-12.1 and created this proof pack.

This was documentation/proof/audit work only. No backend code, frontend code, auth middleware, provider auth behavior, member creation APIs, invite APIs, role update APIs, remove/disable APIs, RBAC middleware, billing/entitlements, Phase 2 providers, Google location binding behavior, worker/scheduler behavior, or destructive scripts were changed or run.

## Docs Inspected

- `docs/codex/README.md`
- `docs/codex/task-template.md`
- `docs/codex/verification-checklist.md`
- `docs/codex/local-proof-pack.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-1-phase-0-proof-pack.md`
- `docs/proof/s2-08-organization-members-migration-dry-run.md`
- `docs/proof/s2-08-1-organization-members-migration-apply.md`
- `docs/proof/s2-10-2-gbp-membership-smoke.md`
- `docs/proof/s2-11-1-new-org-owner-membership-smoke.md`
- `docs/proof/s2-12-1-read-only-member-listing-smoke.md`
- `docs/runtime/processes.md`
- `docs/architecture/location-org-mapping.md`
- `docs/architecture/report-service.md`
- `docs/architecture/workspace-member-model.md`
- `docs/architecture/workspace-members.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`

## Files Inspected

- `apps/api/src/services/organizationAccess.js`
- `apps/api/src/services/organizationAccess.test.js`
- `apps/api/src/services/organizationMembers.js`
- `apps/api/src/services/organizationMembers.test.js`
- `apps/api/src/routes/orgs.js`
- `apps/api/src/routes/orgs.test.js`
- `apps/api/src/routes/reports.js`
- `apps/api/src/routes/reports.test.js`
- Workspace/member proof docs listed above

## Starting Working Tree

Command:

```bash
git status --short
```

Result: clean.

## Commits And Proofs Summarized

Recent workspace/member foundation commits reviewed:

```text
3b59855 docs: design workspace member foundation
fa0bceb feat(api): add organization member seed migration
68a7226 chore(api): apply organization member owner seed migration
cf9f5a4 feat(api): add organization membership access helpers
d8f8479 feat(api): protect org and report paths with membership checks
c019b00 feat(api): protect GBP location operations with membership checks
5150789 chore(api): smoke test GBP membership authorization
7ba588c feat(api): create owner membership for new organizations
45746bf chore(api): smoke test new organization owner membership
dc5b50a feat(api): add read-only organization member listing
02681b6 chore(api): smoke test read-only organization member listing
```

Proofs reviewed:

- S2-08 dry-run proof: `docs/proof/s2-08-organization-members-migration-dry-run.md`
- S2-08.1 apply proof: `docs/proof/s2-08-1-organization-members-migration-apply.md`
- S2-10.2 live GBP membership smoke: `docs/proof/s2-10-2-gbp-membership-smoke.md`
- S2-11.1 live new-org owner membership smoke: `docs/proof/s2-11-1-new-org-owner-membership-smoke.md`
- S2-12.1 live member listing smoke: `docs/proof/s2-12-1-read-only-member-listing-smoke.md`

## Completed Task Summary

| Task | Status | Summary |
| --- | --- | --- |
| S2-07 | Complete | Audited current org/user/client/location ownership and designed the workspace/member foundation. |
| S2-08 | Complete | Added `organization_members` indexes and dry-run-first owner seed migration. |
| S2-08.1 | Complete | Applied owner membership migration and verified live indexes/counts with summarized output only. |
| S2-09 | Complete | Added server-side organization membership/access helpers and unit tests. |
| S2-10 | Complete | Added membership checks to low-blast-radius org and report paths. |
| S2-10.1 | Complete | Added membership checks to current GBP location-bound paths after existing owned-location/canonical-scope guards. |
| S2-10.2 | Complete | Live-smoked GBP membership authorization and app-auth preservation. |
| S2-11 | Complete | New org creation creates or preserves an idempotent owner membership for the authenticated creator. |
| S2-11.1 | Complete | Live-smoked new org owner membership creation, idempotency, listing, and update access. |
| S2-12 | Complete | Added read-only `GET /api/v1/orgs/:orgId/members` for active owner/admin/manager requesters. |
| S2-12.1 | Complete | Live-smoked member listing success, sanitization, bounded result, and fail-closed denial. |

## Implementation Summary

`organization_members` is the canonical membership collection for workspace access. The collection has indexes for unique `id`, unique `{ organization_id, user_id }`, user/status lookup, organization/status/role lookup, and invited email lookup.

Supported statuses:

- `active`
- `invited`
- `disabled`

Supported roles:

- `owner`
- `admin`
- `manager`
- `member`
- `viewer`

Assignment arrays:

- `assigned_client_ids` grants manager/viewer scope to specific canonical clients when the route's role policy allows that role.
- `assigned_location_ids` grants manager/viewer scope to specific local canonical location ids when the route's role policy allows that role.
- Empty assignment arrays deny scoped manager/viewer access.
- Owner/admin access ignores assignment arrays.

Current limitations intentionally preserved:

- Existing user-owned location guards still run before membership checks on GBP location-bound paths, so cross-user shared location access is not enabled yet.
- `location_org_map` remains legacy compatibility only and is not an authorization source.
- Imported Google locations are not auto-bound to organizations or clients.
- `orgs.user_id` and `owner_user_id` still exist for compatibility, but membership access is resolved from `organization_members`.
- Org creation and owner-membership creation are not wrapped in a cross-collection transaction.

## Route And Access Matrix

| Area | Endpoint/path | Required access | Notes |
| --- | --- | --- | --- |
| Org list | `GET /api/v1/orgs` | App auth; includes legacy-owned orgs and active membership orgs | Transitional compatibility path. |
| Org create | `POST /api/v1/orgs` for a new org | App auth only before creation | Creates/preserves active owner membership for creator before success. |
| Existing org update | `POST /api/v1/orgs` for existing org id | Active `owner` or `admin` membership | Does not trust JWT role. |
| Bind location | `POST /api/v1/orgs/bind-location` | Active `owner` or `admin` membership for org, then existing owned-location guard | Writes canonical location scope and legacy compatibility fields. |
| Member list | `GET /api/v1/orgs/:orgId/members` | Active `owner`, `admin`, or `manager` membership | Read-only, sanitized, default limit 50, max limit 100. |
| Report generation, location-scoped | `POST /api/v1/reports/dashboard-snapshot` with `location_id` | Existing owned-location guard, canonical scope match, active `owner`, `admin`, or assigned `manager` membership | Generated files are response-only base64; persistence stores metadata only. |
| Report generation, org-level | `POST /api/v1/reports/dashboard-snapshot` without `location_id` | Active `owner` or `admin` membership | Manager is denied for non-location org-level report generation. |
| GBP location-bound reads | Current locations/posts/reviews/recurrence/dashboard/media reads with location scope | Existing owned-location guard, canonical scope, role policy; viewer is allowed only on read paths designed for it | No cross-user shared location access yet. |
| GBP location-bound mutations | Current posts/reviews/recurrence/location operations with mutation scope | Existing owned-location guard, canonical scope, active `owner`, `admin`, or assigned `manager` membership | Viewer/member/invited/disabled/missing membership denied. |

## Verified Security Behavior

- Member listing returns sanitized membership rows only.
- Member listing omits Mongo `_id`, email, password fields, tokens, secrets, OAuth/provider payloads, and raw user records.
- Organization access checks use authenticated `req.user.user_id` as identity only and resolve workspace role from `organization_members`.
- Membership checks do not trust the JWT `role`.
- Report and location-bound checks use explicit org/location scope and canonical loaded location fields.
- `location_org_map` and `locations.org_id` are not used as authorization sources.
- S2-10.2 verified app auth remained preserved after stale-location denial and provider status checks.
- Proof smokes avoided printing full JWTs, emails, OAuth tokens, encrypted secrets, provider payloads, passwords, and raw user records.

## Tested Paths

Backend node:test matrix covered:

- organization member creation/list/sanitization helpers
- organization access helpers
- org routes
- report routes
- owner seed migration service
- report store/PDF/XLSX/service
- CORS config
- rate limiting
- location binding
- audit logging

Live smoke paths covered:

- S2-10.2: GBP location-bound membership auth, stale/scope mismatch denial, provider status/app-auth preservation, report metadata-only persistence.
- S2-11.1: new org creation, owner membership creation, idempotent upsert, org listing, existing org update access.
- S2-12.1: member listing success, sanitization, bounded response, fail-closed denial.

`apps/api` still intentionally has no formal `npm test` script; `npm test` returns missing-script output and focused `node --test` commands are the current verification path.

## Commands Run

Working tree and history:

```bash
git status --short
git log --oneline -n 20
git show --stat --oneline --name-only 3b59855 68a7226 fa0bceb cf9f5a4 d8f8479 c019b00 5150789 7ba588c 45746bf dc5b50a 02681b6
```

Focused backend tests:

```bash
cd apps/api && node --test src/services/organizationMembers.test.js src/services/organizationAccess.test.js src/routes/orgs.test.js src/routes/reports.test.js src/services/organizationMembersSeedMigration.test.js src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
```

API script checks:

```bash
cd apps/api && npm run
cd apps/api && npm test
```

Web checks:

```bash
cd apps/web && npm test -- --run
cd apps/web && npm run build
```

Final checks:

```bash
git diff --check
git diff --name-only -- apps/web
```

## Test Results

Focused backend tests passed:

```text
1..13
# tests 13
# suites 0
# pass 13
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`cd apps/api && npm run` passed and listed the existing API scripts.

`cd apps/api && npm test` failed as expected because the API package still has no `test` script:

```text
npm error Missing script: "test"
```

Web tests passed:

```text
Test Files  3 passed (3)
Tests  8 passed (8)
```

Web build passed:

```text
✓ 284 modules transformed.
✓ built in 7.15s
```

Build warning observed:

```text
Browserslist: browsers data (caniuse-lite) is 8 months old.
```

This warning is not related to S2-13 and no dependency update was performed.

## Explicit Non-Goals

S2-13 did not implement:

- member creation APIs
- invite APIs
- role update APIs
- remove/disable APIs
- frontend workspace/member UI
- JWT/auth middleware changes
- provider auth changes
- RBAC middleware
- billing/entitlements
- Phase 2 providers
- multi-channel metrics
- Google location binding behavior changes
- `location_org_map` canonical behavior
- destructive cleanup scripts
- dependency installation or updates

## Remaining Risks

- No member-management APIs exist yet.
- No invite flow exists yet.
- No frontend workspace/member UI exists yet.
- Cross-user shared location access is still blocked because existing user-owned location guards run before membership checks.
- Member listing has bounded `limit` but no cursor pagination yet.
- S2-12.1 did not have a live viewer/member/invited/disabled fixture; role denial is covered by unit tests.
- Org and owner-membership writes are not transactional across collections.
- The API package still lacks a formal `test` script.
- S2-11.1 retained a temporary local smoke org and membership because no safe delete route exists.
- Web build reports an unrelated stale Browserslist data warning.

## Next Recommended Task

Recommended next task: design a non-destructive member-management API plan before implementation. The next task should define owner/admin-only create/invite/update/disable semantics, fixture strategy for owner/admin/manager/viewer/member/invited/disabled live smoke coverage, pagination/cursor behavior for member listing, and the cross-user location access transition plan.

Do not start frontend workspace/member UI until the member-management API contract and fixture strategy are verified.

## Pass / Not Pass Decision

Pass.

Reason: the implemented workspace/member foundation has documented migration/index proof, helper tests, route tests, three live local API/Mongo smokes, sanitized read-only member listing proof, and no observed Phase 2 drift or secret exposure during this audit.

## GPT Verification

GPT decision: Pass

The proof pack was verified after reviewing the recorded tests, build output, and live smoke proof.
