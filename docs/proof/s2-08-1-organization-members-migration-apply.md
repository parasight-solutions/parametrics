# S2-08.1 Organization Members Migration Apply

Date: 2026-05-02

## Scope

S2-08.1 applied and verified the `organization_members` owner seed migration against the configured MongoDB environment.

This was verification/apply/proof work only. No auth/JWT behavior, route authorization behavior, membership APIs, RBAC middleware, frontend workspace/member UI, billing/entitlements, Phase 2 providers, Google location binding behavior, or `location_org_map` canonical behavior was changed.

No destructive cleanup scripts were run.

## Pre-Apply Working Tree

Command:

```bash
git status --short
```

Result: clean.

## Files Inspected

- `docs/codex/README.md`
- `docs/codex/task-template.md`
- `docs/codex/verification-checklist.md`
- `docs/codex/local-proof-pack.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-1-phase-0-proof-pack.md`
- `docs/proof/s2-08-organization-members-migration-dry-run.md`
- `docs/runtime/processes.md`
- `docs/architecture/location-org-mapping.md`
- `docs/architecture/report-service.md`
- `apps/api/src/scripts/migrate.organization-members.s2-08.js`
- `apps/api/src/services/organizationMembersSeedMigration.js`
- `apps/api/src/startup/ensureIndexes.js`
- `apps/api/src/services/organizationMembersSeedMigration.test.js`

## Commands Run

Syntax checks:

```bash
cd apps/api && node --check src/scripts/migrate.organization-members.s2-08.js src/startup/ensureIndexes.js
```

Result: passed with no output.

Focused backend tests:

```bash
cd apps/api && node --test src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js src/services/organizationMembersSeedMigration.test.js
```

Result:

```text
1..9
# tests 9
# suites 0
# pass 9
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Dry-run before apply:

```bash
npm run -w @parametrics/api migrate:organization-members:s2-08
```

Apply:

```bash
npm run -w @parametrics/api migrate:organization-members:s2-08 -- --apply
```

Dry-run after apply:

```bash
npm run -w @parametrics/api migrate:organization-members:s2-08
```

Live index creation/verification:

```bash
node --input-type=module -e "<run ensureIndexes without starting API server>"
node --input-type=module -e "<list organization_members indexes and summarized counts>"
```

The MongoDB URI was printed only by the existing Mongo helper with credentials masked. No secrets, emails, tokens, passwords, or raw user records were printed.

## Dry-Run Before Apply Summary

```json
{
  "task": "S2-08 organization_members owner seed migration",
  "mode": "dry-run",
  "writesPerformed": false,
  "orgsScanned": 2,
  "membershipsBackfillable": 2,
  "membershipsExisting": 0,
  "membershipsInserted": 0,
  "skippedMissingOwner": 0,
  "skippedMissingOrgId": 0,
  "skippedUserMissing": 0,
  "userLookupMissing": 0
}
```

The dry-run showed only safe owner memberships to seed. There were no missing owner, missing organization id, missing user lookup, orphan, or ambiguous cases.

## Apply Summary

```json
{
  "task": "S2-08 organization_members owner seed migration",
  "mode": "apply",
  "writesPerformed": true,
  "orgsScanned": 2,
  "membershipsBackfillable": 2,
  "membershipsExisting": 0,
  "membershipsInserted": 2,
  "skippedMissingOwner": 0,
  "skippedMissingOrgId": 0,
  "skippedUserMissing": 0,
  "userLookupMissing": 0
}
```

Apply inserted 2 active owner memberships using the migration's idempotent upsert path.

## Dry-Run After Apply Summary

```json
{
  "task": "S2-08 organization_members owner seed migration",
  "mode": "dry-run",
  "writesPerformed": false,
  "orgsScanned": 2,
  "membershipsBackfillable": 0,
  "membershipsExisting": 2,
  "membershipsInserted": 0,
  "skippedMissingOwner": 0,
  "skippedMissingOrgId": 0,
  "skippedUserMissing": 0,
  "userLookupMissing": 0
}
```

The post-apply dry-run confirmed zero remaining backfillable owner memberships.

## Index Verification

Immediately after the migration apply, the live `organization_members` collection contained the membership documents and MongoDB's default `_id_` index. The existing startup index helper was then run once without starting the API server:

```json
{
  "ensureIndexes": "completed"
}
```

Verified live `organization_members` index names:

```json
[
  "_id_",
  "idx_organization_members_invited_org_email",
  "idx_organization_members_org_status_role_updated_at",
  "idx_organization_members_user_status_updated_at",
  "uniq_organization_members_id",
  "uniq_organization_members_org_user"
]
```

Expected missing indexes:

```json
[]
```

## Membership Count Summary

Summarized live counts only:

```json
{
  "total": 2,
  "ownerCount": 2,
  "byRoleStatus": [
    {
      "role": "owner",
      "status": "active",
      "count": 2
    }
  ]
}
```

No emails, tokens, secrets, passwords, or raw membership records were printed.

## Code Changes Needed

No code changes were needed.

The migration apply succeeded, the post-apply dry-run was idempotent, and the configured startup index helper created the expected `organization_members` indexes.

## Pass/Fail Summary

Pass.

- Working tree was clean before apply.
- Migration script and index startup file passed syntax checks.
- Focused backend tests passed.
- Dry-run before apply showed 2 safe owner memberships to seed and no skipped/missing cases.
- Apply inserted 2 owner memberships.
- Dry-run after apply showed 0 remaining backfillable owner memberships and 2 existing memberships.
- Live `organization_members` indexes were verified.
- Summarized membership counts matched expected owner seed results.
- No destructive cleanup scripts were run.
- No route authorization, auth/JWT, frontend, Phase 2 provider, or location binding behavior was changed.

## Remaining Risks

- This proof applies to the configured MongoDB environment used by the local runtime configuration.
- Running `ensureIndexes()` maintains indexes for all configured collections, not only `organization_members`.
- Route behavior still uses existing user-owned guards until later workspace/member authorization tasks intentionally add membership-aware access checks.
