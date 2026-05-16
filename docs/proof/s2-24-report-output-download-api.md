# S2-24 Report Output Download API Proof Pack

Date: 2026-05-13

## 1. Scope And Decision

S2-24 implements the read-only `GET /api/v1/reports/runs/:runId/outputs/:format` endpoint designed in S2-20 Section 3.3. The route reads the requested PDF/XLSX bytes through the existing `ReportStorageAdapter`, verifies integrity against the persisted output metadata, and streams the bytes back to the requester as a raw response body. The synchronous `POST /api/v1/reports/dashboard-snapshot` route, the durable local storage adapter, PDF/XLSX generation, and the S2-23 listing endpoint are unchanged. The optional regenerate endpoint (S2-20 Section 3.4) remains design-only and the `/reports/history` frontend page (S2-25) remains future work.

Phase 2 integrations remain blocked. No new dependencies were added; `package-lock.json` is unchanged.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pass.

## 2. Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/s2-22-durable-local-report-storage.md`
- `docs/proof/s2-22-1-durable-report-storage-live-smoke.md`
- `docs/proof/s2-23-report-runs-listing-api.md`
- `docs/proof/s2-23-1-report-runs-listing-live-smoke.md`
- `docs/architecture/report-history-and-storage.md`
- `docs/architecture/report-service.md`
- `docs/runtime/processes.md`

## 3. Files Changed

- `apps/api/src/routes/reports.js` — added `GET /api/v1/reports/runs/:runId/outputs/:format` route, exported `downloadReportOutputForUser` helper, private `assertManagerOrViewerDownloadScope` / `downloadFilenameFor` / `contentTypeFor` / `sha256HexBuffer` helpers, and new constants `REPORT_DOWNLOAD_BROAD_ROLES`, `REPORT_DOWNLOAD_SCOPED_ROLES`, `REPORT_DOWNLOAD_FORMATS`, `SAFE_FILENAME_PATTERN`. Imported `findReportRunOutput` and `getReportRunById` from `reportStore.js` and `crypto` for the integrity check.
- `apps/api/src/routes/reports.test.js` — added 16 focused tests for the download route covering invalid format, missing runId, missing run, missing membership, denied roles, manager/viewer org-level deny, manager/viewer scope-mismatch deny, owner/admin allow, manager-with-client-scope allow, viewer-with-location-scope allow, missing format on the run (`404 report_output_not_found`), non-succeeded output (`409 report_output_not_ready`), missing storage metadata (`409 report_output_not_ready`), storage read failure (`500 report_output_read_failed`), size mismatch (`500 report_output_integrity_failed`), checksum mismatch (`500 report_output_integrity_failed`), and the raw-buffer/no-base64/no-absolute-path payload shape.
- `apps/api/src/services/reportStore.js` — added `getReportRunById(runId, options)` (projects `_id: 0, input_snapshot: 0` at the Mongo layer and additionally strips both fields after load) and `findReportRunOutput(run, format)` (case-insensitive). No change to the existing `listReportRuns`/`buildReportRunListQuery`/`sanitizeReportRunRow`/`buildReportRunDoc`/`savePendingReportRun`/`markReportRunRunning`/`markReportRunSucceeded`/`markReportRunFailed`/`normalizeOutputs` behavior.
- `apps/api/src/services/reportStore.test.js` — added 2 focused tests for `getReportRunById` (returns null for empty/missing id, drops `_id` and `input_snapshot` even when the in-memory adapter ignores projection) and `findReportRunOutput` (matches case-insensitively, returns null for empty/missing inputs).
- `docs/architecture/report-history-and-storage.md` — added a "S2-24 Implementation Note" section.
- `docs/architecture/report-service.md` — added a "S2-24 Report Output Download API" section.
- `docs/codex/sprint-2-phase-1-guardrails.md` — added S2-24 bullet to the completed task list and a detailed completion paragraph; Phase 2 remains blocked.
- `docs/proof/s2-24-report-output-download-api.md` — this proof doc (new).

No frontend files changed. `apps/api/package.json` was not changed (the existing focused `npm test` matrix already runs both updated test files). `package-lock.json` is unchanged. `apps/api/src/services/reportStorage.js` was not changed; the existing `readOutput({ storage_provider, storage_key })` was sufficient for the download path.

## 4. Endpoint Contract

`GET /api/v1/reports/runs/:runId/outputs/:format` (authenticated; mounted under the existing `/api/v1/reports` router).

Path parameters:

| Param | Required | Notes |
| --- | --- | --- |
| `runId` | yes | The `report_runs.id` of the run that owns the output. |
| `format` | yes | One of `pdf` or `xlsx`. Any other value ⇒ `400 bad_request`. |

Success response (HTTP `200`):

- `Content-Type`: from the persisted output `content_type` (falls back to the canonical MIME per format).
- `Content-Disposition: attachment; filename="<sanitized>"`. The filename is the persisted `output.filename` when it matches `^[A-Za-z0-9._-]+$`; otherwise a server-derived fallback of `<sanitized-report_key-or-name-or-id>-<run_id>.<format>` (also matching the same character set).
- `Content-Length`: read buffer length.
- `Cache-Control: no-store`.
- `X-Content-Type-Options: nosniff`.
- Body: raw `Buffer` returned via `res.end(buffer)`. Never JSON. Never base64.

Safe error codes:

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | Empty/whitespace `runId`, or `format` not in `pdf|xlsx`. |
| 401 | `unauthorized` | Missing/invalid JWT (existing `authenticate` middleware). |
| 403 | `organization_membership_required` | No active membership in the run's `organization_id`. |
| 403 | `organization_role_required` | Active membership but role not in `owner|admin|manager|viewer`. |
| 403 | `organization_scope_required` | `manager`/`viewer` without a matching `client_id`/`location_id` assignment, or attempting to download an org-level run. |
| 404 | `report_run_not_found` | `getReportRunById` returned `null` (or the loaded run has no `organization_id`). |
| 404 | `report_output_not_found` | The run has no output for the requested `format`. |
| 409 | `report_output_not_ready` | Output exists but `status !== "succeeded"`, or `storage_provider`/`storage_key` is missing. |
| 500 | `report_output_read_failed` | The storage adapter threw, returned a non-Buffer, or is unavailable. |
| 500 | `report_output_integrity_failed` | Read buffer length does not match `output.size`, or the recomputed sha256 does not match `output.checksum.value`. |

## 5. Auth Behavior

- Requires app authentication via the existing `authenticate` middleware.
- The route loads the `report_runs` document by id via `getReportRunById` (which projects `_id` and `input_snapshot` out at the Mongo layer and also defensively strips them after load). The run's `organization_id` is used for authorization; the client-provided URL never carries an `organization_id` query so there is no client-supplied scope hint to validate against.
- Membership is resolved via `requireOrganizationMembership({ organizationId, userId })`. JWT `role` and `location_org_map` are not used.
- Role rules mirror the S2-20 Section 6 contract:
  - `owner` and `admin`: may download any output for runs in the organization, including org-level runs (`client_id: null`, `location_id: null`).
  - `manager` and `viewer`: may download only when the run has a `client_id` or `location_id` and that value is in their `assigned_client_ids` / `assigned_location_ids`. Org-level runs are denied with `403 organization_scope_required` under the current "deny by default until an org-level scope model exists" rule. Mismatched scope is also denied with `403 organization_scope_required`.
  - `member`, any other role, missing membership, `invited`, and `disabled`: denied (the latter two via `requireOrganizationMembership` rejecting non-active memberships).
- All identifiers are trimmed and length-capped before use. The route never echoes user-controlled strings in headers or in the filename.

## 6. Storage Read And Integrity Behavior

- Bytes are read through `storage.readOutput({ storage_provider, storage_key })`. The default adapter (`getDefaultReportStorage()`) is used at runtime; tests inject a fake adapter through `deps.reportStorage`. The route never opens files directly.
- The storage adapter continues to enforce its existing path-safety rules: rejected provider, traversal/absolute keys, empty/`.`/`..` segments, backslashes, null bytes, and out-of-root resolution all bubble up. The route maps any adapter error (and any non-Buffer return) to `500 report_output_read_failed` with a compact message derived from the underlying error.
- After reading, the route validates integrity:
  - If `output.size` is a finite non-negative number, it must equal `buffer.length`. Mismatch ⇒ `500 report_output_integrity_failed`.
  - If `output.checksum.algorithm === "sha256"` and `output.checksum.value` is non-empty, the route recomputes `sha256(buffer)` (lowercase hex) and compares. Mismatch ⇒ `500 report_output_integrity_failed`.
  - If either field is missing, the route does not block the download (so legacy outputs written before checksum/size were persisted remain downloadable). In practice S2-22 always sets both fields on `succeeded` outputs, so the relaxed branch never fires in normal operation.
- The route never decodes, transforms, or re-encodes the bytes. It does not buffer through base64. It does not write back to MongoDB or to storage. The persisted run document is read-only on this path.

## 7. Response / Header Behavior

- Response body on success is the raw `Buffer` sent via `res.end(buffer)`. The response is never JSON, never base64.
- `Content-Type` is taken from the persisted `output.content_type` when present, with a canonical fallback (`application/pdf` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`). The content type is never read from query parameters or from user-controlled body input.
- `Content-Disposition: attachment; filename="<sanitized>"`. The filename is the persisted `output.filename` when it matches `^[A-Za-z0-9._-]+$` (the storage adapter's `validateFilename` rule). Otherwise a fallback of `<safeFilenamePart(report_key||report_name||id)>-<run_id>.<format>` is used. Both paths produce strictly alphanumeric/`._-` filenames; the route never echoes user-controlled report names directly.
- `Content-Length` is set from `buffer.length`.
- `Cache-Control: no-store` is set on every successful response so the downloaded bytes are not cached by intermediaries.
- `X-Content-Type-Options: nosniff` is set on every successful response.
- Error responses go through `toApiError(res, mapValidationError(error))` and remain JSON envelopes with `error.code` and `error.message`, matching the existing report routes.

## 8. Tests Run

```bash
cd apps/api && node --check src/routes/reports.js
cd apps/api && node --check src/routes/reports.test.js
cd apps/api && node --check src/services/reportStore.js
cd apps/api && node --check src/services/reportStore.test.js
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --name-only -- apps/web/src apps/web/package.json package-lock.json
git diff --check
```

Outcomes:

- `node --check` of each changed file: OK.
- `cd apps/api && npm test`: `1..176 # tests 176 # pass 176 # fail 0 # skipped 0`. New coverage:
  - 16 download-route tests in `apps/api/src/routes/reports.test.js` (invalid format, missing runId, missing run, missing membership, denied roles via membership rejection, manager/viewer org-level deny, manager/viewer scope-mismatch deny, owner/admin allow, manager-with-client allow, viewer-with-location allow, missing format on the run, non-succeeded output, missing storage metadata, storage read failure, size mismatch, checksum mismatch).
  - 2 store-helper tests in `apps/api/src/services/reportStore.test.js` (`getReportRunById` empty/missing/found shape and `_id`/`input_snapshot` defensive strip; `findReportRunOutput` case-insensitive match).
  - All previously verified tests still pass (S2-23 listing tests, S2-22 storage tests, S2-05 generation tests, etc.).
- `cd apps/web && npm test -- --run`: `Test Files 4 passed (4) / Tests 21 passed (21)`.
- `cd apps/web && npm run build`: `286 modules transformed. ✓ built in ~31s`. Pre-existing Browserslist warning unchanged.
- `git diff --name-only -- apps/web/src apps/web/package.json package-lock.json`: empty.
- `git diff --check`: no whitespace conflicts.

Working-tree files for this task (`git status --short`):

- `M apps/api/src/routes/reports.js`
- `M apps/api/src/routes/reports.test.js`
- `M apps/api/src/services/reportStore.js`
- `M apps/api/src/services/reportStore.test.js`
- `M docs/architecture/report-history-and-storage.md`
- `M docs/architecture/report-service.md`
- `M docs/codex/sprint-2-phase-1-guardrails.md`
- `?? docs/proof/s2-24-report-output-download-api.md`

No backend, frontend, or storage adapter behavior changed outside the download route, its helpers, and the new store-side lookup helpers. No new dependency installed.

## 9. Frontend Changes

No. No file under `apps/web/src` or `apps/web/package.json` was modified.

## 10. Package-Lock Changed

No.

## 11. Explicit Non-Goals

S2-24 intentionally does **not**:

- Add a frontend report history UI (`/reports/history`) — still S2-25.
- Add the optional `POST /api/v1/reports/runs/:runId/regenerate` route — still design-only.
- Add a dedicated detail endpoint `GET /api/v1/reports/runs/:runId`; the download path resolves the run internally and never returns the run body, so the detail route remains a separate future addition if the frontend needs it.
- Add a dedicated `report.output.download` audit event or a dedicated `report_download` rate-limit bucket. Both are reserved in the S2-20 contract and remain optional hardening.
- Add signed URLs or short-lived download links. `expires_at` continues to be `null` until a future task lands them.
- Add cloud storage adapters (S3/GCS/Azure). The download path uses the same local adapter and the same `readOutput` contract, so a future cloud adapter can drop in without touching the route.
- Add a queue, dedicated report worker, or scheduler change. The download path runs synchronously on the API runtime.
- Change PDF/XLSX generation, the synchronous `POST /api/v1/reports/dashboard-snapshot` route, the S2-23 listing route, the `report_runs` write path, `report_runs` indexes, `package.json`, or `package-lock.json`.
- Mutate any `report_runs` document on the download path. The route is read-only.
- Print storage roots, absolute paths, or storage credentials. The route returns only the response headers and the raw bytes.
- Loosen the `organization_members`-based authorization, the `location_org_map` legacy-only status, or any owned-location guard.

## 12. Remaining Risks

- No live local API smoke yet. Unit tests cover the route, the service helpers, role/scope rules, output readiness, storage read failure, and size/checksum integrity. A focused live smoke against the existing `s2-15-fixture-org` scope (re-using the S2-22.1 / S2-23.1 methodology) is a recommended follow-up before relying on download data in any deployed environment.
- The route denies `manager` and `viewer` from downloading org-level outputs by default. S2-20 Section 6 carves out a future org-level-scope membership refinement; the current cut keeps the deny-by-default convention until an explicit org-level-scope model exists. Owner/admin can always download org-level runs.
- No dedicated `report.output.download` audit event and no dedicated `report_download` rate-limit bucket in this first cut. Downloads are higher-sensitivity than listings, but the contract lets both remain optional hardening; both are documented as future work.
- The route enforces sha256 integrity only when the persisted output already carries `checksum.algorithm === "sha256"` with a value. Legacy outputs predating durable storage may not have a checksum and will skip the recompute step; the size check still applies when `size` is present.
- `Content-Disposition` uses ASCII-safe filenames (the persisted `output.filename` is validated by the storage adapter against `^[A-Za-z0-9._-]+$`). The route does not emit `filename*=UTF-8''…` because there is no need for non-ASCII filenames in the current report set.
- The route does not stream — it reads the full buffer into memory and sends it via `res.end`. The storage adapter caps individual outputs at 25 MB (`MAX_BUFFER_BYTES`), so memory usage per request is bounded. Switching to a true `ReadableStream` is reserved for a future task and matches the S2-20 contract's `readOutputStream` direction.
- Pre-existing Browserslist build warning is unchanged.

## 13. Ready For GPT Verification

Yes. Working tree contains only the S2-24 backend download route, the new store helpers, focused tests for both layers, three architecture/guardrails doc updates, and this proof doc. No frontend source, web package, or lockfile diff. No API/worker/scheduler service was started. No destructive scripts ran. All API tests, web tests, and the web build pass. `git diff --check` is clean and `git diff --name-only -- apps/web/src apps/web/package.json package-lock.json` is empty.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-24 report output download API was verified after route/store tests, storage read and integrity checks, API npm test, web tests, web build, no-frontend-diff checks, no-lockfile-diff checks, and diff checks.
