# S2-10.2 GBP Membership Smoke

Date: 2026-05-03

## Scope

S2-10.2 smoke-tested the S2-10.1 location-bound GBP membership authorization changes against the live local API/Mongo environment.

This was verification/proof work only. No backend code, frontend code, auth middleware, provider auth behavior, member APIs, invite APIs, billing/entitlements, Phase 2 providers, workers, scheduler, or destructive scripts were changed or run.

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

The existing Mongo helper printed a masked MongoDB URI. No raw Mongo credentials were printed. Workers and scheduler were not started.

The API process started for this smoke was stopped after verification.

Health smoke:

```text
GET /api/v1/health -> 200 { ok: true }
```

## Smoke Identity And Scope

A sanitized smoke script used the existing app JWT signing path in memory for an existing local user. The JWT was never printed.

Selected summarized scope:

```json
{
  "user_id": "a01c0816...e4dd",
  "organization_id": "9658a8f2...a68e",
  "membership_id": "20d7f848...788e",
  "membership_role": "owner",
  "membership_status": "active",
  "org_status": "active",
  "location_id": "7ce4f68b...8314",
  "client_id": "834213d9...4f9a",
  "location_title": "Beetle Digital - Digital Marketing, Video Production & Training Hub",
  "provider": "google",
  "has_integration_id": true,
  "has_provider_refs": true
}
```

Only summarized IDs and non-secret status fields were printed. No emails, JWTs, OAuth tokens, encrypted secrets, provider payloads, or base64 report files were printed.

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
node --input-type=module -e "<sanitized smoke script: select active owner membership + bound Google location, mint JWT in memory, call API endpoints, print summarized results only>"
```

Focused backend tests:

```bash
cd apps/api && node --test src/services/organizationAccess.test.js src/routes/orgs.test.js src/routes/reports.test.js src/services/organizationMembersSeedMigration.test.js src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
```

Package/script checks:

```bash
cd apps/api && npm run
cd apps/api && npm test
git diff --check
```

## Endpoints Smoked

Positive owner/member reads:

```json
{
  "GET /api/v1/locations?provider=google": {
    "status": 200,
    "count": 1,
    "selected_location_seen": true
  },
  "GET /api/v1/posts?locationId=<location>": {
    "status": 200,
    "count": 8
  },
  "GET /api/v1/recurrence?locationId=<location>": {
    "status": 200,
    "has_rule": true
  },
  "GET /api/v1/reviews?locationId=<location>": {
    "status": 200,
    "count": 10,
    "has_sync_state": true
  }
}
```

Report dashboard snapshot with location scope:

```json
{
  "POST /api/v1/reports/dashboard-snapshot": {
    "status": 200,
    "report_run_id": "07cab576...4d31",
    "report_status": "succeeded",
    "output_formats": ["pdf", "xlsx"],
    "file_formats": ["pdf", "xlsx"],
    "base64_printed": false
  }
}
```

The report route persisted normal report run metadata and returned response files. Generated base64 was not printed.

## Denied And Stale Results

Scope mismatch denial, using the real owned location with an intentionally mismatched request organization id:

```json
{
  "POST /api/v1/reports/dashboard-snapshot": {
    "status": 409,
    "error_code": "scope_mismatch",
    "message": "request scope does not match location scope"
  }
}
```

Stale location denial with the owner token:

```json
{
  "GET /api/v1/posts?locationId=s2-10-2-stale-location": {
    "status": 404,
    "error_code": "not_found",
    "app_auth_after_stale_status": 200,
    "app_auth_preserved": true
  }
}
```

Non-owner/different user token against the selected location:

```json
{
  "GET /api/v1/posts?locationId=<selected-location>": {
    "attempted": true,
    "other_user_id": "f3d4abd1...024b",
    "status": 404,
    "error_code": "not_found",
    "note": "expected ownership gate before membership gate"
  }
}
```

No membership document was disabled, copied, or mutated. The different-user smoke confirms the existing user-owned location guard still fails closed before membership access is considered.

## Provider Reauth Observation

Provider status endpoint:

```json
{
  "GET /api/v1/integrations/google/status": {
    "status": 200,
    "connected": true,
    "needs_reauth": false,
    "error_code": null,
    "email_printed": false,
    "app_auth_after_provider_status": 200,
    "app_auth_preserved": true,
    "forced_provider_failure": false
  }
}
```

No forced provider failure was attempted because that would require altering or invalidating real Google provider state. The smoke confirms the provider status path remained provider-specific and did not clear app authentication.

## Test Results

Focused backend tests passed:

```text
1..12
# tests 12
# suites 0
# pass 12
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

## No Frontend Diff

No frontend files were changed for S2-10.2.

## No Secret Or Destructive Action Confirmation

- No full JWTs were printed.
- No OAuth access tokens, refresh tokens, ID tokens, encrypted secrets, passwords, raw provider payloads, or emails were printed.
- No destructive scripts were run.
- No workers or scheduler processes were started.
- No membership documents were modified.
- The only live write performed by the smoke was normal report snapshot generation metadata/audit persistence through the existing authenticated report route.

## Remaining Risks

- The smoke used the configured live local API/Mongo environment only.
- It did not force a real Google provider reauth failure, to avoid damaging provider state.
- It did not verify browser UI behavior or frontend stale-state handling.
- Shared cross-user workspace access is still limited by the existing user-owned location guard until a later task intentionally changes that ownership model.

## Result

Pass. S2-10.1 location-bound GBP membership authorization is ready for GPT verification based on live local API/Mongo smoke results and focused backend tests.
