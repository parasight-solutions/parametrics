# S2-12.1 Read-Only Member Listing Smoke

Date: 2026-05-03

## Scope

S2-12.1 smoke-tested the S2-12 read-only organization member listing endpoint against the live local API/Mongo environment.

This was verification/proof work only. No backend code, frontend code, auth middleware, provider auth behavior, member creation APIs, invite APIs, role update APIs, remove/disable APIs, billing/entitlements, Phase 2 providers, workers, scheduler, or destructive cleanup scripts were changed or run.

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

## Smoke Identity And Organization

A sanitized smoke script used the existing app JWT signing path in memory for an existing local user selected through an active owner membership. The JWT was never printed.

Selected summarized scope:

```json
{
  "user_id": "a01c0816...e4dd",
  "organization_id": "9658a8f2...a68e",
  "membership_id": "20d7f848...788e",
  "membership_role": "owner",
  "membership_status": "active",
  "org_status": "active",
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
node --input-type=module -e "<sanitized smoke script: load API env, select active owner membership without printing email/raw user record, mint JWT in memory, call GET /api/v1/orgs/:orgId/members, verify sanitization/sort/limit/fail-closed denial, print summarized IDs only>"
```

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

## Endpoint Result

Endpoint:

```text
GET /api/v1/orgs/:orgId/members
```

Success result:

```json
{
  "status": 200,
  "has_members_array": true,
  "count": 1,
  "within_default_limit": true,
  "owner_membership_included": true,
  "only_requested_organization": true,
  "sorted_by_contract": true
}
```

The response included the active owner membership for the requested organization. The result count was within the default limit of 50. The returned rows were verified against the documented deterministic sort contract; with one returned row, the order is trivially sorted.

## Sanitized Response Verification

Observed response row fields:

```json
[
  "assigned_client_ids",
  "assigned_location_ids",
  "created_at",
  "id",
  "organization_id",
  "role",
  "status",
  "updated_at",
  "user_id"
]
```

Sanitization result:

```json
{
  "unexpected_fields": [],
  "forbidden_fields_found": [],
  "safe": true
}
```

The response omitted Mongo `_id`, email, password fields, tokens, secrets, OAuth/provider payloads, and raw user records.

## Denied / Fail-Closed Result

Denied path used the same valid owner token against a harmless non-existent organization id. No membership or org records were mutated.

```json
{
  "method": "nonexistent_org_with_owner_token",
  "status": 403,
  "error_code": "organization_membership_required",
  "fail_closed": true
}
```

Result: pass. The endpoint failed closed before disclosing whether an organization exists.

## Role-Denial Result

Role-denial live smoke was skipped.

Reason: no existing `viewer`, `member`, `invited`, or `disabled` membership fixture with matching existing org/user was found. The smoke did not create or mutate memberships just to test role denial. Unit tests cover viewer/member and invited/disabled denial.

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
- No membership documents were created, updated, disabled, deleted, copied, or otherwise mutated.
- No member-management APIs, invite APIs, role update APIs, or remove/disable APIs were added.

## Remaining Risks

- This smoke used the configured live local API/Mongo environment only.
- Role-denial was not live-smoked because no safe existing fixture was available; unit tests cover the denial matrix.
- The success path returned one member, so sort verification was limited to a trivially sorted one-row response.
- Browser UI behavior was not verified because S2-12 is backend read-only route behavior only.

## Result

Pass. S2-12 read-only organization member listing is ready for GPT verification based on live local API/Mongo smoke results and focused backend tests.
