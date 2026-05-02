# S2-08 Organization Members Migration Dry Run

Date: 2026-05-02

## Scope

S2-08 adds `organization_members` indexes and a dry-run-first migration that seeds owner memberships from existing `orgs.owner_user_id || orgs.user_id`.

This proof covers dry-run verification only. Apply mode was not run.

No auth/JWT behavior, route authorization behavior, membership APIs, frontend workspace/member UI, RBAC middleware, billing/entitlements, Phase 2 providers, imported Google location binding, `location_org_map` canonical behavior, or org ownership fields were changed.

## Command

```bash
npm run -w @parametrics/api migrate:organization-members:s2-08
```

The command connected to the configured MongoDB environment. The MongoDB URI was logged by the existing Mongo helper with credentials masked. No secrets, JWTs, OAuth tokens, passwords, or Mongo credentials were printed.

## Dry-Run Summary

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
  "userLookupMissing": 0,
  "samples": {
    "backfillable": [
      {
        "organization_id": "9658a8f2-9f08-45a3-ad58-24de3a34a68e",
        "user_id": "a01c0816-33a9-49c5-b4c4-df3bd825e4dd",
        "email_found": true
      },
      {
        "organization_id": "b272eb4b-0f1b-4814-ae99-8bfaea63f8bf",
        "user_id": "a01c0816-33a9-49c5-b4c4-df3bd825e4dd",
        "email_found": true
      }
    ],
    "existing": [],
    "skipped": [],
    "userLookupMissing": []
  }
}
```

## Result

Pass.

- Dry-run mode reported `writesPerformed: false`.
- Existing orgs scanned: `2`.
- Backfillable owner memberships: `2`.
- Existing memberships: `0`.
- Inserted memberships: `0`.
- Missing owner skips: `0`.
- Missing org id skips: `0`.
- Missing user lookups: `0`.

## Apply Mode

Apply mode was not run.

Apply command, for later explicit approval only:

```bash
npm run -w @parametrics/api migrate:organization-members:s2-08 -- --apply
```

## Remaining Risks

- This dry-run scanned the configured local/development MongoDB environment only.
- Index creation itself is exercised through syntax/tests and API startup index code path, but this proof does not apply writes or create membership documents.
- Route behavior still uses existing user-owned guards until later S2-09/S2-10 tasks intentionally add membership helpers and authorization checks.
