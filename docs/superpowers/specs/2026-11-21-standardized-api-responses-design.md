# ParaMetrics Standardized API Responses Design

## Intent

ParaMetrics will adopt one JSON response contract across `apps/api`, `apps/client`, and `apps/web`. The migration is intentionally coordinated and breaking: the backend and both frontend bundles must move together so neither UI depends on legacy response shapes. The legacy UI remains a supported reference application and must continue to work.

The work starts from `main` at `ea0788bce1c0c3c4a08b54142a3b73f75e75f8d8` on a new `refactor/standardize-api-responses` branch. The existing uncommitted edits in `apps/client/src/hooks/useApi.js` and `apps/client/src/pages/private/Reviews.jsx` are included and preserved. `feat/automatic-google-post-sync` at `c3c5de1321e396e2bda8e98619637f7b802f3262` is out of scope and must not be checked out, rebased, merged, reset, or modified.

## Goals

- Give every applicable JSON endpoint an exact, predictable success or error envelope.
- Preserve existing HTTP status semantics and stable application error codes.
- Migrate all Axios and Fetch consumers to the same body contract.
- Preserve application-auth expiry, Google reconnect handling, cancellation, stale-response protection, cache behavior, downloads, uploads, cookies, and redirects.
- Add HTTP-level contract coverage in addition to utility and consumer tests.
- Document the endpoint migration inventory, exclusions, deployment coupling, and rollback procedure.

## Non-goals and anti-goals

- No Phase 3 automatic post synchronization.
- No endpoint path/version change from `/api/v1`.
- No business-logic, schema, UI-design, OAuth-permission, or authorization redesign.
- No global `res.json` monkey patch and no hidden permanent legacy payload adapter.
- No wrapping of redirects, binary/streaming bodies, static files, CORS preflight, 204/304 responses, or third-party acknowledgements whose protocol requires another shape.
- No success-with-HTTP-200 conversion for failures.
- No nested standard envelopes or leakage of provider bodies, credentials, stack traces, MongoDB details, or internal exceptions.

## Approaches considered

### 1. Coordinated atomic migration — selected

Migrate backend JSON responses and both frontend consumer graphs together on one branch. Explicitly classify non-JSON exceptions. Deploy the backend and both frontend assets as one release unit.

This produces one real contract without compatibility debt, matches the product requirement, and keeps the legacy UI usable.

### 2. Temporary frontend compatibility adapters — rejected

Clients could translate the new envelope back into old raw payloads. This would reduce immediate page edits but conceal incomplete migration, maintain two contracts, and make later removal risky.

### 3. New `/api/v2` routes — rejected

Parallel versioning would reduce deployment coupling but duplicate a large route surface and conflict with the instruction to preserve `/api/v1` absent a separate approval.

## Canonical contracts

### Success

Applicable JSON success responses have exactly four top-level fields:

```json
{
  "statusCode": 200,
  "data": {},
  "message": "Operation completed successfully",
  "success": true
}
```

- `statusCode` is an integer and equals the HTTP status.
- `data` is the business payload as an object, array, primitive, or `null`.
- `message` is a safe human-readable string.
- `success` is always `true`.
- Payload-free JSON operations use `data: null`.
- HTTP 204 remains bodyless and is not converted to JSON.

### Error

Applicable JSON errors have exactly four top-level fields:

```json
{
  "statusCode": 422,
  "message": "Validation failed",
  "success": false,
  "errors": [
    {
      "code": "VALIDATION_ERROR",
      "field": "locationId",
      "message": "Location is required"
    }
  ]
}
```

- `statusCode` equals the HTTP status.
- `errors` is always an array with at least one safe entry.
- Each entry has a stable `code` and safe `message`; `field` is included for field validation.
- Every existing application-authored error code is preserved verbatim, not only codes currently consumed by a frontend. Existing codes such as `unauthorized`, `invalid`, `reauth_required`, `post_sync_in_progress`, and `post_delete_reconciliation_required` retain their semantic values. Only a missing or unexpected internal code normalizes to `server_error`.
- `details` has a strict closed allowlist. Google reconnect errors may expose `{ "provider": "google", "reason": "..." }`, where `reason` is one of `missing_refresh_token`, `invalid_grant`, `access_revoked`, or `permission_denied`. Rate-limit errors may expose `{ "retryAfterSeconds": <positive integer> }`. All other provider bodies and arbitrary `error.data` are dropped from the response and remain server-side only.
- Reconciliation and scope failures continue through their stable code and safe message; they do not expose raw expected/got identifiers or arbitrary data unless a later separately reviewed contract adds an explicit field.
- Unexpected errors map to a safe `server_error` entry while the real exception is logged server-side through existing logging/audit paths.
- A message is safe to expose only when it is authored by ParaMetrics in a recognized validation or business-error path. Raw Google, MongoDB, HTTP-library, filesystem, and unexpected exception messages are replaced by a route/status-specific safe message and logged server-side. Application-authored field validation messages remain available.

## Backend architecture

### Response utility

Add `apps/api/src/utils/apiResponse.js` with:

- `sendSuccess(res, { statusCode = 200, data = null, message = "Operation completed successfully" })`
- `sendError(res, { statusCode = 500, message = "An unexpected error occurred", errors })`
- pure builders/validators used by tests to enforce exact keys, status agreement, error-array normalization, safe strings, and no nested envelope.
- error normalization that accepts existing application errors (`status`, `statusCode`, `code`, application-authored `message`, and `field`) and only the closed Google-reason/rate-limit detail mappings above. It never copies arbitrary provider, database, or `error.data` payloads.

`sendSuccess` and `sendError` own HTTP status selection and body construction. Callers pass business payload only. They do not modify Express globally.

### Existing error utilities

`toApiError()` in `services/ownership.js` will delegate to `sendError`. Organization access, authentication, rate limiting, request-origin validation, report errors, upload errors, and other middleware will use the same utility. Stable codes remain unchanged.

Introduce a final API-only unknown-route handler and centralized unexpected-error handler after all `/api/v1` routes. Route handlers that already translate known business errors may continue doing so through `sendError`/`toApiError`; the final handler is a safety net rather than a replacement for audit or authorization logic.

### Testable application boundary

Refactor server construction so HTTP tests can create/import the Express app without opening a port or exiting the process. Startup validation, index creation, and `listen()` remain in the executable entry point. This is infrastructure separation only and must not change production middleware/route order.

### Inventory and migration procedure

Create `docs/proof/standardized-api-response-inventory.md`. For every route branch that writes a response, record:

- method and endpoint,
- current HTTP status and shape,
- target `data` payload and message,
- frontend consumers,
- tests,
- classification: JSON migrated, bodyless, redirect, binary/download, static, streaming, preflight, or third-party acknowledgement.

The inventory starts from searches for `res.json`, `res.status(...).json`, `res.send`, `res.end`, `res.redirect`, `res.download`, and `res.sendFile`, then is reconciled against router registrations. Current reconnaissance found about 184 response-write sites across 20 API/server/middleware files; the implementation plan must enumerate them rather than relying on that count.

Migrate route families in dependency order: shared middleware/errors, auth/session, Google OAuth/integrations, organizations/members/clients/locations, posts/sync/deletion/publishing, reviews, recurrence, reports, uploads, health/debug/demo, then unknown/error handlers.

### Special responses

- OAuth redirects remain redirects with their existing status, location, cookie, and query behavior.
- Logout and other current 204 endpoints remain bodyless.
- PDF/XLSX and other file downloads preserve bytes, content type, disposition, filename, range/status behavior, and headers. Only their JSON error branches use the error envelope.
- Upload endpoints standardize their JSON metadata/error branches while preserving multipart parsing and files.
- `/uploads` static serving is unchanged.
- CORS preflight and 304 responses remain bodyless.
- Third-party callback acknowledgements remain protocol-compatible; any exception is listed in the inventory.

## New frontend (`apps/client`)

### Axios boundary

The response interceptor runs authentication-expiry detection against the original Axios error before transformation.

For ordinary JSON success, return `response.data`, which is the standard envelope. For explicit `blob` or `arraybuffer` requests, preserve the Axios response object so consumers retain headers, status, filename, and binary data. Do not guess based only on content type when a consumer explicitly requests binary behavior.

On HTTP errors, reject the standardized backend body. Cancellation (`axios.isCancel`, `CanceledError`, or cancellation code) remains the original cancellation error. A network failure with no HTTP response becomes a predictable client-only error envelope:

```json
{
  "statusCode": 0,
  "success": false,
  "message": "Unable to reach the server",
  "errors": [{ "code": "network_error", "message": "Unable to reach the server" }]
}
```

This local status `0` is never represented as a server response. Safe request metadata may remain non-enumerable or separate when needed for diagnostics; it is not part of the server contract.

### Consumers and hooks

- Endpoint services return the envelope for JSON calls.
- Consumers read business data from `result.data`, not Axios `response.data`.
- `useApi()` keeps its current deliberate behavior: it invokes callbacks, returns the envelope on success, and returns `undefined` after an handled error. Its included user edit that logs the response is preserved unless removed by the user during review.
- Auth restoration reads `result.data.user`; login helpers read standardized `errors[]`.
- Posts, pagination, create/edit/delete/retry, manual synchronization, image uploads, integrations, location/org selection, reviews, and report metadata are migrated in context.
- Download consumers explicitly preserve the binary Axios response path.
- Auth expiry dispatches only for HTTP 401 with structured code `unauthorized` or `invalid`, excluding login and session-probe requests. A 403, missing code, code without HTTP 401, or message match never expires the application session. Google provider failures remain reconnect signals and do not log the user out.
- Existing stale-response and location-switch protections remain intact.

The included `Reviews.jsx` button-label edit is preserved and is unrelated to the contract.

## Legacy frontend (`apps/web`)

### Fetch boundary

`api()` returns the standard body envelope for successful JSON. For a non-OK response it throws the standardized body after normalizing only true non-contract/network cases. Consumers inspect `statusCode`, `message`, and `errors[]`.

Application-auth expiry uses exactly HTTP 401 plus `unauthorized`/`invalid` error codes, and only when the request opted into application-auth handling. Login and session restoration probes do not dispatch the global expiry event. A 403, missing code, code without HTTP 401, or message match never expires the application session. Google reconnect detection searches `errors[]` for `reauth_required` or the allowlisted Google `details.reason`. Google 401/403 provider errors must not dispatch application logout.

Abort errors remain native `AbortError`. Network failures become the same client-only `statusCode: 0` envelope used conceptually by the Axios client. Empty 204 success returns `null` because there is no envelope body. Any temporary `error.status` compatibility alias must be documented, tested, and removed within this migration if all consumers can be updated; it is not a second server contract.

### Cache and consumers

`useCachedApi()` stores the full standardized success envelope because that is the public Fetch-client result. Cache keys/entries move from version 1 to version 2, and v1 entries are ignored/removed so old raw payloads cannot reach migrated consumers. Stale-while-revalidate, request deduplication, abort behavior, background refresh, transient-error fallback, and relevant 404 invalidation remain unchanged.

All pages, components, context, and helper modules migrate explicitly. Auth/session restoration reads `result.data.user`. Posts, reviews, locations, integrations, organizations/member management, recurrence, reports, and active-location behavior read their business payload from `result.data`. Direct binary report download helpers remain direct Fetch consumers and preserve response headers/body semantics.

## Error and security compatibility

- Both clients use structured codes rather than message text for auth and provider decisions. Application session expiry is strictly HTTP 401 plus `unauthorized`/`invalid` with the login/session-probe exclusions described above.
- All existing application-authored codes are retained verbatim. Only missing/unexpected internal codes normalize to `server_error`.
- Provider authorization metadata is limited to `details.provider = "google"` and an allowlisted `details.reason`; tokens, raw responses, upstream bodies, and arbitrary `error.data` are excluded.
- Only ParaMetrics-authored validation/business messages are public. Provider, database, filesystem, library, and unexpected exception text is replaced with a safe message and logged server-side.
- Field validation keeps field identifiers and individual messages.
- Rate-limit errors retain `Retry-After` plus safe retry timing in an error entry.
- Audit logging remains best-effort and cannot change route success/failure.
- Unknown API routes return standardized 404 JSON; non-API/static fallback behavior is unchanged.

## Testing strategy

### Backend

- Unit tests for success/error builders, exact top-level keys, normalization, status agreement, no nesting, safe metadata, and secret/stack redaction.
- HTTP-level tests against the importable Express app for 200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, and 500 paths.
- Representative provider authorization, OAuth redirect, cookie/session, upload, download/PDF/XLSX, unknown route, and binary-byte/header tests.
- Route-family regression tests updated to assert envelopes without weakening business assertions.

### New frontend

- Axios interceptor tests for JSON unwrapping, standardized rejection, network failure, cancellation, auth expiry, Google reauth distinction, and binary preservation.
- Consumer tests for auth/session, posts/pagination/actions/manual sync/image upload, location switching, reports/downloads, and notifications.

### Legacy frontend

- Fetch wrapper tests for success/error envelopes, 204, network/abort, auth expiry, provider reauth, and location 404 behavior.
- Cache v1 invalidation/v2 persistence plus stale fallback/deduplication tests.
- Actual consumer tests covering login/session/logout, posts, reviews, locations, integrations, organizations, recurrence, and reports.

### Verification

Run:

```text
npm test -w @parametrics/api
npm test -w client
npm test -w @parametrics/web
npm run lint -w client
npm run lint -w @parametrics/web
npm run build -w client
npm run build -w @parametrics/web
git diff --check
```

Also run backend syntax checks and a focused HTTP integration smoke suite. Browser verification is reported only if actually executed against the updated backend.

## Deployment and rollback

This is a coordinated breaking change. Do not deploy the backend while either environment can serve an older frontend bundle.

Preferred rollout:

1. Build immutable backend, new-client, and legacy-web artifacts from the same reviewed commit.
2. Deploy them to a blue/green or equivalent staging slot.
3. Run representative auth, Google reconnect, posts, reviews, locations, organization, upload, and report-download smoke checks.
4. Switch backend and both frontend origins/CDN manifests as one release event.
5. Purge or version CDN/browser entry assets so cached HTML cannot reference incompatible JavaScript.
6. Monitor standardized error codes, 401s, provider reconnects, and frontend error rates.

If the platform cannot coordinate all three artifacts, stop and introduce a separately approved temporary versioned/compatibility strategy with an explicit removal date; do not accept a broken window.

Rollback is atomic: restore the previous backend image and both previous frontend artifact manifests together, restore the previous CDN/HTML pointers, purge incompatible entry assets, and rerun the same smoke checks. No MongoDB rollback is expected because this design changes response contracts rather than schemas or business data.

## Documentation deliverables

- This approved design and a separate implementation plan.
- `docs/proof/standardized-api-response-inventory.md` with migration/exclusion coverage and test evidence.
- Update the canonical ParaMetrics Google Drive PRD only after implementation evidence is available.
- Final handoff includes starting/ending SHA, changed-file inventory, exact test counts, lint/build results, smoke/browser status, deployment risks, and rollback instructions.

## Builder decisions left open

- Exact success message wording per endpoint, provided it is human-readable and tested where consumers display it.
- Internal helper names beyond the public `sendSuccess`/`sendError` interface.
- Test fixture organization and migration batching, provided every inventory row is reconciled.
- Whether the temporary legacy `error.status` alias is unnecessary after consumer migration; default is to remove it if tests prove all consumers use `statusCode`.
