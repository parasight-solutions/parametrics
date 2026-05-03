# S2-11.1 New Org Owner Membership Smoke

Date: 2026-05-03

## Scope

S2-11.1 smoke-tested S2-11 against the live local API/Mongo environment.

This was verification/proof work only. No backend code, frontend code, auth middleware, provider auth behavior, member-management APIs, invite APIs, billing/entitlements, Phase 2 providers, workers, scheduler, or destructive cleanup scripts were changed or run.

## Pre-Smoke Working Tree

Command:

```bash
git status --short
```

Result: clean.

## API Status

The API was not already listening on the expected local API port. Only the API process was started:

```bash
cd apps/api && npm run dev:api
```

Startup result:

```text
API listening on http://localhost:5050
```

Workers and scheduler were not started. The API process started for this smoke was stopped after verification.

Health smoke:

```text
GET /api/v1/health -> 200 { ok: true }
```

## Smoke Identity

A sanitized smoke script used the existing app JWT signing path in memory for an existing local user selected through an active owner membership. The JWT was never printed.

Selected summarized identity:

```json
{
  "user_id": "a01c0816...e4dd",
  "source": "active_owner_membership_user",
  "token_printed": false,
  "email_printed": false
}
```

No emails, JWTs, OAuth tokens, encrypted secrets, passwords, raw user records, or provider payloads were printed.

## Commands Run

API listener check:

```bash
ss -ltnp
```

API startup:

```bash
cd apps/api && npm run dev:api
```

Sanitized live smoke:

```bash
node --input-type=module -e "<sanitized smoke script: load API env, select active owner user without printing email, mint JWT in memory, create temp org through /api/v1/orgs, verify organization_members, repeat upsert, verify org list/update access, print summarized IDs only>"
```

Notes:

- An initial local smoke command failed at shell-quoting before making an API request or DB write.
- A second local smoke command reached the API but returned `401` because the standalone process had not loaded the same local env stack before signing the JWT; no org or membership was created.
- The final smoke imported the API startup env loader before signing the JWT and passed.

Focused backend tests:

```bash
cd apps/api && node --test src/services/organizationMembers.test.js src/services/organizationAccess.test.js src/routes/orgs.test.js src/routes/reports.test.js src/services/organizationMembersSeedMigration.test.js src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
```

Package/script checks:

```bash
cd apps/api && npm run
cd apps/api && npm test
git diff --check
git diff --name-only -- apps/web
```

## Temporary Organization

Temporary org:

```json
{
  "id": "s2-11-1-smoke-1777790525614-c6930a4f",
  "name_prefix": "s2-11-1-smoke",
  "create_status": 200,
  "status": "active",
  "returned_user_matches_authenticated_user": true,
  "returned_owner_matches_authenticated_user": true,
  "persisted_user_matches_authenticated_user": true,
  "persisted_owner_matches_authenticated_user": true
}
```

## Membership Verification

Membership created for `{ organization_id, user_id }`:

```json
{
  "membership_id": "3d4f84b0-7010-4dab-ba1f-1223fdcea4cd",
  "count_after_create": 1,
  "role_after_create": "owner",
  "status_after_create": "active"
}
```

## Idempotency Result

The same org id was posted to the real authenticated org route a second time with an updated name/description.

```json
{
  "repeat_status": 200,
  "repeat_success": true,
  "count_after_upsert": 1,
  "membership_id_unchanged_after_upsert": true,
  "role_after_upsert": "owner",
  "status_after_upsert": "active",
  "role_status_preserved": true
}
```

Result: pass. Repeating the create/upsert did not duplicate the membership and did not downgrade role/status.

## Org List And Update Access

```json
{
  "org_list_status": 200,
  "org_seen_in_list": true,
  "existing_update_accepted": true
}
```

Result: pass. The created org appeared in the authenticated org listing, and the existing org update path accepted the creator because the owner membership exists.

## Cleanup Decision

Cleanup was not performed.

Reason: there is no safe org delete route. The temporary org and membership were retained for proof/audit instead of performing direct database cleanup.

Retained records:

```json
{
  "organization_id": "s2-11-1-smoke-1777790525614-c6930a4f",
  "membership_id": "3d4f84b0-7010-4dab-ba1f-1223fdcea4cd"
}
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

`cd apps/api && npm run` passed and listed the existing API package scripts.

`cd apps/api && npm test` failed as expected because the API package still has no `test` script:

```text
npm error Missing script: "test"
```

`git diff --check` passed with no output.

`git diff --name-only -- apps/web` returned no frontend diffs.

## No Secret Or Destructive Action Confirmation

- No full JWTs were printed.
- No emails were printed.
- No OAuth access tokens, refresh tokens, ID tokens, encrypted secrets, passwords, raw provider payloads, or raw user records were printed.
- No destructive cleanup scripts were run.
- No workers or scheduler processes were started.
- No frontend files were changed.
- No member-management APIs or invite APIs were added.

## Remaining Risks

- This smoke used the configured live local API/Mongo environment only.
- The temporary org and membership remain in local Mongo because no safe delete route exists.
- The smoke did not verify browser UI behavior because S2-11 is backend route/data behavior only.

## Result

Pass. S2-11 new organization owner membership creation is ready for GPT verification based on live local API/Mongo smoke results and focused backend tests.
