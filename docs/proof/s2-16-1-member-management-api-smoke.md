# S2-16.1 Member-Management API Smoke Proof

Date: 2026-05-11

## Scope

S2-16.1 live-smoked the S2-16 direct member-management API routes against the local API and live MongoDB using only the controlled S2-15 fixture scope. This task is verification and proof documentation only.

Routes smoked:

- `GET /api/v1/health`
- `POST /api/v1/orgs/:orgId/members`
- `PATCH /api/v1/orgs/:orgId/members/:memberId`
- `POST /api/v1/orgs/:orgId/members/:memberId/disable`

This task did not change backend source code, frontend source code, API routes, member-management services, auth/JWT/provider behavior, report/location/GBP behavior, RBAC middleware, billing/entitlements, Phase 2 providers, Google location binding, or `location_org_map` canonicality. No workers/scheduler were run. No destructive cleanup was run.

Claude Code is the execution tool for this task. Claude Code did not commit or push.

## Docs Read

- `docs/codex/README.md`
- `docs/codex/task-template.md`
- `docs/codex/verification-checklist.md`
- `docs/codex/local-proof-pack.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-1-phase-0-proof-pack.md`
- `docs/proof/sprint-2-workspace-member-foundation-proof-pack.md`
- `docs/proof/s2-14-member-management-api-contract.md`
- `docs/proof/s2-15-organization-member-fixtures-dry-run.md`
- `docs/proof/s2-15-2-organization-member-fixtures-apply.md`
- `docs/proof/s2-16-member-management-api.md`
- `docs/runtime/processes.md`
- `docs/architecture/workspace-members.md`
- `docs/architecture/member-management-api-contract.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`

## Files Inspected

- `apps/api/src/server.js`
- `apps/api/src/routes/orgs.js`
- `apps/api/src/routes/health.js`
- `apps/api/src/services/organizationMembers.js`
- `apps/api/src/middleware/auth.js`
- `apps/api/src/lib/jwt.js`
- `apps/api/package.json`
- `apps/api/.env.local`

## Files Changed

- `CLAUDE.md` (new, thin Claude Code governance adapter)
- `docs/claude-code/README.md` (new, Claude Code adapter README)
- `docs/proof/s2-16-1-member-management-api-smoke.md` (this proof)
- `docs/codex/sprint-2-phase-1-guardrails.md` (status updates only)
- `docs/backlog/sprint-2-workspace-member-foundation.md` (status updates only)
- `docs/architecture/workspace-members.md` (S2-16.1 smoke status section)

No `apps/api`, `apps/web`, `package.json`, or `package-lock.json` files were modified.

## API Status

Started single-process API only with `npm run dev:api` from `apps/api`. Health probe returned `200`. Workers and scheduler were not started.

After the smoke completed, the API process was stopped. The smoke harness was a temporary `/tmp` ESM file and was removed after the run.

## Auth / Token Strategy

The existing JWT middleware verifies a signed app JWT and does not require an existing user record on the request path. The harness signed short-lived (1h) local app JWTs using the API's `JWT_SECRET` for each fixture requester `user_id`. Tokens were used as `Authorization: Bearer ...` headers only and were never written to logs, terminal output, proof documents, or files. No user, OAuth provider, or session records were created or modified by token signing.

Live role-token strategy notes:

- Requester `user_id` values used exact `s2-15-user-*` fixture prefixes.
- Target `user_id` values for create/patch/disable mutations used exact `s2-16-smoke-user-*` prefixes.
- No real Beetle/current-working user ids were used in tokens or as targets.

## Fixture / Target ID Summary

Fixture organization id: `s2-15-fixture-org`.

Fixture requesters used:

- `s2-15-user-owner` (role owner / status active)
- `s2-15-user-admin` (role admin / status active)
- `s2-15-user-manager` (role manager / status active)
- `s2-15-user-viewer` (role viewer / status active)
- `s2-15-user-member` (role member / status active)
- `s2-15-user-invited` (role member / status invited)
- `s2-15-user-disabled` (role viewer / status disabled)

Fixture target membership ids referenced in negative-path mutations:

- `s2-15-member-owner`
- `s2-15-member-admin`
- `s2-15-member-viewer`

Smoke target user ids created/attempted under `s2-16-smoke-user-*`:

- `s2-16-smoke-user-owner-created` (created by owner; patched to manager; disabled)
- `s2-16-smoke-user-admin-manager` (created by admin)
- `s2-16-smoke-user-admin-attempt-owner` (admin attempt; denied; no record)
- `s2-16-smoke-user-admin-attempt-admin` (admin attempt; denied; no record)
- `s2-16-smoke-user-manager-attempt` (denied; no record)
- `s2-16-smoke-user-viewer-attempt` (denied; no record)
- `s2-16-smoke-user-member-attempt` (denied; no record)
- `s2-16-smoke-user-invited-attempt` (denied; no record)
- `s2-16-smoke-user-disabled-attempt` (denied; no record)

## Commands Run

```bash
git status --short
git log --oneline -5
ls apps/api/.env*
npm run dev:api   # from apps/api, single-process API only
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5050/api/v1/health
node /tmp/s2-16-1-smoke.mjs   # local temp harness, removed after the run
node --test src/services/organizationMemberFixtures.test.js \
  src/services/organizationMembers.test.js \
  src/services/organizationAccess.test.js \
  src/routes/orgs.test.js \
  src/routes/reports.test.js \
  src/services/organizationMembersSeedMigration.test.js \
  src/services/reportStore.test.js \
  src/services/reportXlsx.test.js \
  src/services/reportPdf.test.js \
  src/services/reportService.test.js \
  src/lib/corsConfig.test.js \
  src/middleware/rateLimit.test.js \
  src/services/locationBinding.test.js \
  src/services/auditLog.test.js
cd apps/api && npm run
cd apps/api && npm test
git diff --check
git diff --name-only -- apps/web
git diff --name-only -- apps/api apps/web package.json package-lock.json
pkill -f "node src/server.js"
```

The `/tmp/s2-16-1-smoke.mjs` ESM harness loaded the project env, used `createRequire` to resolve `jsonwebtoken` from `apps/api`, called fixture routes with signed fixture-user tokens, and emitted summarized outcome JSON only. The harness was deleted after the run.

## Success Path Results

Health:

| Case | Status |
| --- | --- |
| A. `GET /api/v1/health` | 200 |

Owner positive flow (target `s2-16-smoke-user-owner-created`):

| Case | HTTP | Outcome |
| --- | --- | --- |
| B. owner create viewer | 200 | `created: true`, role `viewer`, status `active` |
| B. owner patch to manager (empty assignments) | 200 | `updated: true`, role `manager` |
| B. owner patch repeat (no-op) | 200 | `updated: false` |
| B. owner disable | 200 | `disabled: true`, status `disabled` |

Admin positive flow:

| Case | HTTP | Outcome |
| --- | --- | --- |
| C. admin create manager `s2-16-smoke-user-admin-manager` | 200 | `created: true`, role `manager` |

All success responses contained sanitized membership rows only.

## Denial Path Results

Admin negative checks (all expected `403`):

| Case | HTTP | `error.code` |
| --- | --- | --- |
| C. admin create owner | 403 | `member_role_not_allowed` |
| C. admin create admin | 403 | `member_role_not_allowed` |
| C. admin patch fixture owner membership | 403 | `member_role_not_allowed` |
| C. admin disable fixture owner membership | 403 | `member_role_not_allowed` |
| C. admin patch fixture admin membership | 403 | `member_role_not_allowed` |

Denied requester role checks (each tried create + patch on fixture viewer + disable on fixture viewer):

| Requester | Create | Patch viewer | Disable viewer | Code path |
| --- | --- | --- | --- | --- |
| `s2-15-user-manager` (manager) | 403 | 403 | 403 | `organization_role_required` |
| `s2-15-user-viewer` (viewer) | 403 | 403 | 403 | `organization_role_required` |
| `s2-15-user-member` (member) | 403 | 403 | 403 | `organization_role_required` |
| `s2-15-user-invited` (invited member) | 403 | 403 | 403 | `organization_membership_required` |
| `s2-15-user-disabled` (disabled viewer) | 403 | 403 | 403 | `organization_membership_required` |

`invited` and `disabled` requesters return `organization_membership_required` because only active memberships satisfy the active-membership lookup; this matches the contract.

## Idempotency Results

| Case | HTTP | Outcome |
| --- | --- | --- |
| F. duplicate create for `s2-16-smoke-user-owner-created` | 200 | `created: false` |
| F. disable already-disabled `s2-16-smoke-user-owner-created` | 200 | `disabled: false` |
| F. patch with same role/status/assignments | 200 | `updated: false` |

Duplicate create returned the existing sanitized membership unchanged. Disable no-op returned the disabled sanitized membership with `disabled: false`. Repeat patch returned the sanitized membership with `updated: false`.

## Sanitization Result

The harness ran a per-response sanitization check on every membership row in success responses. It rejected any row whose keys included `_id`, `email`, `password`, `token`, `secret`, `oauth`, `auth_code`, or `provider`, while allowing the expected canonical keys (`id`, `organization_id`, `user_id`, `role`, `status`, `assigned_client_ids`, `assigned_location_ids`, `invited_by_user_id`, `created_at`, `updated_at`). All sanitization checks reported `ok`. No unexpected keys were observed.

No raw user records, raw provider payloads, OAuth tokens, JWTs, refresh tokens, ID tokens, encrypted secrets, passwords, or email values were observed in any response or recorded in this proof.

## Last-Owner Smoke

Live last-owner mutation against the fixture owner (`s2-15-member-owner`) was intentionally not attempted because there is only one active owner in the fixture org and a downgrade or disable would damage the canonical fixture state. Instead, the live admin-vs-owner denial cases verified that the admin requester cannot reach the owner-mutation path at all, and the existing unit tests in `apps/api/src/services/organizationMembers.test.js` cover the last-owner protection logic (`last_owner_required`) when an owner caller targets the final active owner.

Skipped live last-owner reason: avoid mutating the canonical S2-15 fixture owner. Coverage: existing service-level unit tests in `organizationMembers.test.js`.

## Live Smoke Coverage Skips

- Live last-owner mutation against `s2-15-member-owner` skipped to preserve fixture canonical state; covered by unit tests in `apps/api/src/services/organizationMembers.test.js`.
- No live tests asserted assignment validation against canonical clients/locations because the fixture organization has no real client/location records. Empty-assignment manager patch case was exercised live; service-level assignment validation tests remain the coverage source.
- No GBP/report routes were smoked in this task; coverage stays with the existing S2-10.2 GBP smoke and the S2-12.1 read-only listing smoke.

## Post-Smoke Fixture State Summary

Summarized aggregate counts only. No raw documents printed.

- fixture organization count (`s2-15-fixture-org`): 1
- fixture organization membership count: 9
- `s2-16-smoke-user-*` memberships created in fixture org: 2
- role counts in fixture org: owner=1, admin=1, manager=3, member=2, viewer=2
- status counts in fixture org: active=6, invited=1, disabled=2
- `location_org_map` references for fixture org / fixture users / smoke users: 0

The +2 smoke memberships are:

- the owner-created membership (`s2-16-smoke-user-owner-created`), now role `manager` status `disabled` after the owner positive flow
- the admin-created membership (`s2-16-smoke-user-admin-manager`), role `manager` status `active`

These smoke memberships remain in place because S2-16.1 follows the same non-destructive convention as S2-15.2 fixture data; no cleanup script exists yet and the task explicitly forbids destructive cleanup.

## Safety Confirmations

- No Beetle/current working organization was touched. All write paths used the `s2-15-fixture-org` organization id only.
- No `location_org_map` writes occurred. The post-smoke aggregate check found zero fixture or smoke references in `location_org_map`.
- No imported Google locations were auto-bound; assignment validation was exercised only with empty arrays for the fixture organization.
- No user records were created. Fixture/target user ids remain synthetic id-only values.
- No worker, scheduler, frontend, or destructive cleanup processes were run.
- The API server was stopped after smoke. No long-running services were left in place.

## Output Hygiene Confirmation

The smoke harness emitted only:

- HTTP status codes
- result booleans (`created`, `updated`, `disabled`)
- sanitization result object (`ok` plus optional reason)
- error code strings from the route's compact JSON error shape
- aggregate counts and prefix-grouped counts

No JWTs, OAuth tokens, refresh tokens, ID tokens, auth codes, authorization headers, encrypted secret payloads, raw provider payloads, raw user records, email addresses, passwords, or full request bodies were printed in terminal output, proof docs, or supporting files.

## Backend Test Matrix

The existing backend matrix continues to pass against the unchanged source code:

```text
1..114
# tests 114
# pass 114
# fail 0
```

The matrix covered: `organizationMemberFixtures.test.js`, `organizationMembers.test.js`, `organizationAccess.test.js`, `orgs.test.js`, `reports.test.js`, `organizationMembersSeedMigration.test.js`, `reportStore.test.js`, `reportXlsx.test.js`, `reportPdf.test.js`, `reportService.test.js`, `corsConfig.test.js`, `rateLimit.test.js`, `locationBinding.test.js`, `auditLog.test.js`.

`cd apps/api && npm run` lists the API scripts as documented. `cd apps/api && npm test` fails with the expected missing-script message because the API package still has no `test` script, matching prior proof packs.

## Diff Checks

- `git diff --check`: no output.
- `git diff --name-only -- apps/web`: no output.
- `git diff --name-only -- apps/api apps/web package.json package-lock.json`: no output.

Pending working-tree changes are docs-only:

```text
?? CLAUDE.md
?? docs/claude-code/
?? docs/proof/s2-16-1-member-management-api-smoke.md
modified: docs/codex/sprint-2-phase-1-guardrails.md
modified: docs/backlog/sprint-2-workspace-member-foundation.md
modified: docs/architecture/workspace-members.md
```

## Remaining Risks

- Smoke memberships under `s2-16-smoke-user-*` remain in the fixture organization because no safe delete route exists yet; future fixture cleanup tooling will need an explicit task.
- Live last-owner mutation remains covered only by unit tests because mutating the fixture owner is unsafe.
- Live assignment-id validation was not exercised with non-empty arrays because the fixture organization has no client/location records.
- The harness ran from `/tmp` and was removed; future repeatable smoke runs will need a small repo-tracked harness in a later task if the team wants reproducible coverage.

## Code Changes Needed

No backend or frontend code changes were needed. The S2-16 implementation behaves as documented in `docs/proof/s2-16-member-management-api.md`.

## Ready For GPT Verification

Yes.

## GPT Decision

Pass.

The S2-16.1 live smoke was verified after fixture-scoped API smoke, sanitized response review, backend test matrix, no-source-diff checks, and diff checks.
