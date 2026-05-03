# S2-15.2 Organization Member Fixtures Apply Proof

Date: 2026-05-03

## Scope

S2-15.2 applied the controlled S2-15 local organization member fixtures and verified post-apply dry-run state against live MongoDB.

This task changed proof/status documentation only. No backend source code, frontend code, API routes, member-management APIs, invite APIs, auth/JWT behavior, provider auth behavior, report/location behavior, Phase 2 providers, destructive cleanup, or dependency metadata were changed.

## Docs Inspected

- `docs/codex/README.md`
- `docs/codex/task-template.md`
- `docs/codex/verification-checklist.md`
- `docs/codex/local-proof-pack.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-1-phase-0-proof-pack.md`
- `docs/proof/sprint-2-workspace-member-foundation-proof-pack.md`
- `docs/proof/s2-14-member-management-api-contract.md`
- `docs/proof/s2-15-organization-member-fixtures-dry-run.md`
- `docs/runtime/processes.md`
- `docs/architecture/workspace-members.md`
- `docs/architecture/member-management-api-contract.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`

## Starting State

Command:

```bash
git status --short
```

Result: clean.

## Commands Run

```bash
git status --short
npm run -w @parametrics/api seed:organization-members:s2-15
npm run -w @parametrics/api seed:organization-members:s2-15 -- --apply
npm run -w @parametrics/api seed:organization-members:s2-15
node --input-type=module -e '<summarized fixture count query>'
node --check apps/api/src/services/organizationMemberFixtures.js
node --check apps/api/src/scripts/seed.organization-members-fixtures.s2-15.js
node --check apps/api/src/services/organizationMemberFixtures.test.js
node --test apps/api/src/services/organizationMemberFixtures.test.js
cd apps/api && node --test src/services/organizationMembers.test.js src/services/organizationAccess.test.js src/routes/orgs.test.js src/routes/reports.test.js src/services/organizationMembersSeedMigration.test.js src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
cd apps/api && npm run
cd apps/api && npm test
git diff --check
git diff --name-only -- apps/web
```

No API, worker, scheduler, or frontend long-running services were started.

## Pre-Apply Dry-Run Summary

Command:

```bash
npm run -w @parametrics/api seed:organization-members:s2-15
```

Summary:

- mode: dry-run
- writesPerformed: false
- organization action: insert
- membershipsPlanned: 7
- membershipsExisting: 0
- membershipsBackfillable: 7
- membershipsToInsert: 7
- membershipsToUpdate: 0
- membershipsConflicting: 0
- conflictCounts total: 0
- nonFixtureOrgUser conflicts: 0
- nonFixtureOrg conflicts: 0
- fixtureMismatch conflicts: 0
- planned ids used only `s2-15-*` fixture prefixes

Role counts:

- owner: 1
- admin: 1
- manager: 1
- viewer: 2
- member: 2

Status counts:

- active: 5
- invited: 1
- disabled: 1

## Apply Summary

Command:

```bash
npm run -w @parametrics/api seed:organization-members:s2-15 -- --apply
```

Summary:

- mode: apply
- writesPerformed: true
- organization action: insert
- membershipsPlanned: 7
- membershipsExisting: 0
- membershipsBackfillable: 7
- membershipsToInsert: 7
- membershipsToUpdate: 0
- membershipsConflicting: 0
- conflictCounts total: 0
- orgsUpserted: 1
- orgsMatched: 0
- membershipsUpserted: 7
- membershipsMatched: 0
- membershipsModified: 0

The apply created the dedicated fixture organization and seven fixture membership documents. No deletes were run.

## Post-Apply Dry-Run Summary

Command:

```bash
npm run -w @parametrics/api seed:organization-members:s2-15
```

Summary:

- mode: dry-run
- writesPerformed: false
- organization action: existing
- membershipsPlanned: 7
- membershipsExisting: 7
- membershipsBackfillable: 0
- membershipsToInsert: 0
- membershipsToUpdate: 0
- membershipsConflicting: 0
- conflictCounts total: 0

This confirms the fixture apply is idempotent and leaves no remaining backfillable fixture memberships.

## Summarized Live Fixture State

The live MongoDB verification query printed aggregate counts only.

Summary:

- fixtureOrganizationCount: 1
- fixtureMembershipCount: 7
- role counts: admin 1, manager 1, member 2, owner 1, viewer 2
- status counts: active 5, disabled 1, invited 1
- manager assignment counts: 1 membership, 1 assigned client id, 1 assigned location id
- viewer assignment counts: 1 membership, 1 assigned client id, 1 assigned location id
- locationOrgMapFixtureReferenceCount: 0

## Safety Confirmations

- No Beetle/current working organization was targeted; writes were scoped to the exact `s2-15-fixture-`, `s2-15-member-`, and `s2-15-user-` prefixes.
- No non-fixture conflicts were reported before apply.
- No `location_org_map` writes were performed by the fixture script, and the post-apply aggregate query found zero fixture references there.
- No user documents were created.
- No destructive cleanup was run.
- No secrets, tokens, OAuth data, emails, passwords, or raw user records were printed. Env output showed boolean readiness and a masked MongoDB URI only.

## Test Results

Syntax checks passed:

- `node --check apps/api/src/services/organizationMemberFixtures.js`
- `node --check apps/api/src/scripts/seed.organization-members-fixtures.s2-15.js`
- `node --check apps/api/src/services/organizationMemberFixtures.test.js`

Fixture tests passed:

```text
1..1
# tests 1
# pass 1
# fail 0
```

Existing backend matrix passed:

```text
1..13
# tests 13
# pass 13
# fail 0
```

API package checks:

- `npm run` in `apps/api`: passed and listed `seed:organization-members:s2-15`.
- `npm test` in `apps/api`: failed with the expected missing `test` script.

Diff checks:

- `git diff --check`: passed.
- `git diff --name-only -- apps/web`: no frontend diff.

## Remaining Risks

- Fixture users are synthetic ids only; no local token/user fixture workflow exists yet.
- Future live allow/deny route smoke still needs a safe way to authenticate as fixture roles or map test tokens to fixture users.
- Fixture org and membership writes are not transactional, matching the current controlled fixture script scope.

## GPT Decision

Pass

The controlled fixture apply was verified after apply proof, post-apply dry-run, live fixture count summary, fixture tests, existing backend matrix, and diff checks.
