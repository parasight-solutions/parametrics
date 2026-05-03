# S2-15 Organization Member Fixtures Dry-Run Proof

## Scope

S2-15 adds a controlled local fixture seed/audit workflow for `organization_members` fixture records covering owner/admin/manager/viewer/member/invited/disabled cases.

This task does not add backend routes, member-management APIs, invite APIs, role update APIs, disable/remove APIs, frontend workspace/member UI, auth/JWT changes, provider auth changes, report/location behavior changes, Phase 2 providers, or `location_org_map` authorization behavior.

## Docs Inspected

- `docs/codex/README.md`
- `docs/codex/task-template.md`
- `docs/codex/verification-checklist.md`
- `docs/codex/local-proof-pack.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-1-phase-0-proof-pack.md`
- `docs/proof/sprint-2-workspace-member-foundation-proof-pack.md`
- `docs/proof/s2-14-member-management-api-contract.md`
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
- `docs/architecture/member-management-api-contract.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`

## Commands Run

```bash
git status --short
node --check apps/api/src/services/organizationMemberFixtures.js
node --check apps/api/src/scripts/seed.organization-members-fixtures.s2-15.js
node --test apps/api/src/services/organizationMemberFixtures.test.js
npm run -w @parametrics/api seed:organization-members:s2-15
npm run
npm test
node --test src/services/organizationMembers.test.js src/services/organizationAccess.test.js src/routes/orgs.test.js src/routes/reports.test.js src/services/organizationMembersSeedMigration.test.js src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
git diff --check
git diff --name-only -- apps/web
```

The first dry-run attempt could not reach the configured MongoDB from the sandbox. The same dry-run command was rerun with approved network access and succeeded. Apply mode was not run.

`npm run`, `npm test`, and the existing backend matrix were run from `apps/api`.

## Fixture Dataset

Prefixes:

- organization id/name/slug: `s2-15-fixture-`
- membership id: `s2-15-member-`
- user id: `s2-15-user-`

Planned fixture organization:

- id: `s2-15-fixture-org`
- name: `s2-15-fixture-organization`
- slug: `s2-15-fixture-organization`

Planned fixture memberships:

- `s2-15-member-owner`: active owner
- `s2-15-member-admin`: active admin
- `s2-15-member-manager`: active manager with fixture client/location assignments
- `s2-15-member-viewer`: active viewer with fixture client/location assignments
- `s2-15-member-member`: active member
- `s2-15-member-invited`: invited member
- `s2-15-member-disabled`: disabled viewer

No user documents are created. Fixture users are direct `user_id` values only.

## Dry-Run Result

Command:

```bash
npm run -w @parametrics/api seed:organization-members:s2-15
```

Result summary:

- mode: dry-run
- writesPerformed: false
- organization action: insert
- memberships planned: 7
- memberships existing: 0
- memberships backfillable: 7
- memberships to insert: 7
- memberships to update: 0
- memberships conflicting: 0
- role counts: owner 1, admin 1, manager 1, viewer 2, member 2
- status counts: active 5, invited 1, disabled 1
- conflict counts: total 0

The command output contained only summarized fixture IDs/counts and boolean environment readiness logs. No secret values, tokens, OAuth data, emails, or raw records were printed.

## Apply Behavior

Apply mode requires:

```bash
npm run -w @parametrics/api seed:organization-members:s2-15 -- --apply
```

Apply mode was not run for S2-15 verification.

The service applies by exact fixture ids and fixture `{ organization_id, user_id }` pairs only. It performs no deletes, creates no user records, and does not use or modify `location_org_map`.

## Idempotency And Conflict Behavior

The fixture plan is idempotent:

- existing exact fixture records are not duplicated
- fixture membership updates preserve `created_at`
- safe fixture-owned fields may be updated only for records with exact fixture prefixes
- a second apply should leave a follow-up dry-run with zero backfillable fixture memberships

Conflict behavior:

- if a non-fixture record exists for a planned fixture `{ organization_id, user_id }`, the plan reports a conflict and apply fails before writes
- if a fixture membership id exists with a different fixture org/user pair, the plan reports a mismatch and apply fails before writes
- if the fixture organization id exists but is not clearly fixture-owned by prefix, the plan reports a conflict and apply fails before writes

## Test Results

Focused checks passed:

- `node --check apps/api/src/services/organizationMemberFixtures.js`
- `node --check apps/api/src/scripts/seed.organization-members-fixtures.s2-15.js`
- `node --test apps/api/src/services/organizationMemberFixtures.test.js`

Existing backend matrix passed:

```bash
node --test src/services/organizationMembers.test.js src/services/organizationAccess.test.js src/routes/orgs.test.js src/routes/reports.test.js src/services/organizationMembersSeedMigration.test.js src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
```

Result: 13 passing test files, 0 failures.

Package/diff checks:

- `npm run` in `apps/api`: passed and listed `seed:organization-members:s2-15`
- `npm test` in `apps/api`: failed with the expected missing `test` script
- `git diff --check`: passed
- `git diff --name-only -- apps/web`: no frontend source diff

## Non-Goals Confirmed

S2-15 did not add:

- backend API routes
- member creation APIs
- invite APIs
- role update APIs
- remove/disable APIs
- frontend workspace/member UI
- auth/JWT/provider behavior changes
- report/location behavior changes
- Phase 2 providers or multi-channel metrics
- `location_org_map` writes or canonical behavior
- destructive cleanup

## Remaining Risks

- Apply mode is implemented but intentionally not run until GPT verification and explicit approval.
- Fixture users are direct ids only; no local token/user fixture workflow exists yet.
- Live allow/deny smoke coverage still depends on a later task that can safely use or pair tokens with fixture user ids.
- The fixture organization and membership writes are not transactional, matching the current small-script local fixture scope.

## GPT Decision

Pass

The fixture workflow was verified after dry-run proof, fixture tests, existing backend matrix, and diff checks.
