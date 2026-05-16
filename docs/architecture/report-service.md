# Report Service

ParaMetrics Phase 1 / Sprint 2 starts the reports foundation while the product remains Google Business Profile first.

## Current State

The frontend dashboard currently supports client-side exports from the GBP dashboard, including CSV, SVG, PNG, and PDF snapshot behavior in `apps/web/src/pages/Dashboard.jsx`.

The backend now has report metadata, PDF, XLSX, persistence, and synchronous authenticated dashboard snapshot route foundations. The frontend dashboard has S2-06 wiring in progress for a backend-generated PDF/XLSX action that downloads returned base64 files in the browser without persisting generated file content. ParaMetrics still has no report queue, worker, scheduler, durable file storage, email delivery, or report history UI. Phase 0 backend stabilization is complete: API/worker/scheduler runtime separation, auth hardening, CORS, rate limiting, audit logging, and canonical location binding are in place.

## S2-01 Scope

S2-01 is complete. It added a pure backend report service abstraction in `apps/api/src/services/reportService.js`.

The service can:

- Accept dashboard snapshot input.
- Normalize report type/name/key.
- Normalize optional `organization_id`, `client_id`, and `location_id`.
- Normalize and validate a date range.
- Normalize requested future output formats: `pdf` and `xlsx`.
- Sanitize dashboard snapshot sections, cards, tables, charts, metrics, and metadata.
- Create report run metadata with pending output placeholders.
- Transition output metadata through success/failure helper functions.

The S2-01 metadata service is intentionally pure. It does not import MongoDB, Redis, BullMQ, Express, Google APIs, or frontend code.

## S2-02 PDF Output Generation

S2-02 is complete. It added backend PDF output generation in `apps/api/src/services/reportPdf.js`.

The PDF service accepts a report run produced by `buildDashboardSnapshotReportRun(...)` and produces a minimal text-only PDF buffer for the `pdf` output format. It also returns output metadata compatible with the S2-01 contract.

S2-02 PDF output includes:

- report name
- report key and type
- generated timestamp
- date range
- organization, client, and location identifiers when present
- requested-by user id when present
- dashboard snapshot summary counts
- capped card and metric summaries
- capped table row summaries
- capped chart summaries

The renderer uses the sanitized S2-01 `input_snapshot` and does not read raw request bodies. Text is capped, secret-like keys are skipped or redacted before output, and large dashboard snapshots are not dumped into the PDF.

S2-02 intentionally keeps PDF layout simple. It does not add images, chart rendering, branding templates, a report API route, Mongo persistence, queues, workers, scheduling, emails, XLSX generation, or frontend changes.

## S2-03 XLSX Output Generation

S2-03 is complete. It added backend XLSX output generation in `apps/api/src/services/reportXlsx.js`.

The XLSX service accepts a report run produced by `buildDashboardSnapshotReportRun(...)` and produces a minimal workbook buffer for the `xlsx` output format. It also returns output metadata compatible with the S2-01 contract.

S2-03 workbook sheets are:

- `Summary`: report name, report key/type, generated timestamp, date range, organization/client/location identifiers, requested-by user id, and dashboard snapshot summary counts.
- `Cards`: capped card titles, values, and compact details.
- `Metrics`: capped metric names, values, and compact details.
- `Tables`: capped table row summaries.
- `Charts`: capped chart titles, point counts, and compact point summaries.

The XLSX renderer uses the sanitized S2-01 `input_snapshot` and does not read raw request bodies. Text and row counts are capped, secret-like keys are skipped or redacted before output, and large dashboard snapshots are not dumped into the workbook.

S2-03 intentionally keeps workbook output simple. It does not add styling, formulas, charts, images, templates, a report API route, Mongo persistence, queues, workers, scheduling, emails, frontend wiring, or PDF changes.

## S2-04 Report Persistence

S2-04 is complete. It added Mongo persistence for report definitions and report run lifecycle metadata in `apps/api/src/services/reportStore.js`.

The persistence service is repository-style and accepts injected Mongo collections or a database adapter for tests. Runtime callers can use the default Mongo collections through the existing backend Mongo helper. No public report route is added in S2-04.

S2-04 persists metadata only. Generated PDF/XLSX buffers are not stored in MongoDB. Report run persistence intentionally stores `input_snapshot_summary`, `filters`, output metadata, and compact errors, but does not store the full sanitized dashboard snapshot by default.

### `reports` Collection Contract

`reports` stores report definitions/templates, not generated files.

Minimum fields:

- `id`
- `report_key`
- `name`
- `type`
- `scope`
- `organization_id`
- `client_id`
- `location_id`
- `default_formats`
- `status`: `active` or `archived`
- `created_by_user_id`
- `metadata`
- `created_at`
- `updated_at`

Report definition persistence requires explicit `organization_id`. `client_id` is optional for organization-level definitions. `location_id` is optional, but when it is set, `client_id` must also be set.

### `report_runs` Collection Contract

`report_runs` stores each generation attempt and lifecycle state.

Minimum fields:

- `id`
- `report_id`
- `report_key`
- `report_type`
- `report_name`
- `status`: `pending`, `running`, `succeeded`, or `failed`
- `requested_formats`
- `outputs`
- `input_snapshot_summary`
- `filters`
- `organization_id`
- `client_id`
- `location_id`
- `requested_by_user_id`
- `created_at`
- `updated_at`
- `started_at`
- `completed_at`
- `error`

Run persistence requires explicit `organization_id` and does not infer org/client/location scope from request state or active user state.

### Persistence Lifecycle Helpers

`reportStore.js` provides:

- `buildReportDefinitionDoc(...)`
- `createReportDefinition(...)`
- `buildReportRunDoc(...)`
- `savePendingReportRun(...)`
- `markReportRunRunning(...)`
- `markReportRunSucceeded(...)`
- `markReportRunFailed(...)`

The run transition helpers update lifecycle metadata only. They store output metadata such as format, status, path, size, compact error, and timestamps, but they do not store generated PDF/XLSX buffers.

### Index Strategy

S2-04 adds indexes in `apps/api/src/startup/ensureIndexes.js`.

`reports` indexes:

- unique `id`
- unique `report_key` at location scope: `organization_id + client_id + location_id + report_key`
- unique `report_key` at client scope: `organization_id + client_id + report_key` when `location_id` is null
- unique `report_key` at organization scope: `organization_id + report_key` when `client_id` and `location_id` are null
- `organization_id + updated_at`
- `client_id + updated_at`
- `location_id + updated_at`
- `status + updated_at`

The unique report-key indexes are split by scope level instead of using one nullable compound unique index. This avoids MongoDB treating nullable scope fields as a single shared unique value and accidentally blocking valid definitions at a different scope level.

`report_runs` indexes:

- unique `id`
- `report_id + created_at`
- `report_key + created_at`
- `organization_id + created_at`
- `client_id + created_at`
- `location_id + created_at`
- `status + created_at`

## S2-04.1 Index Verification

S2-04.1 is complete. It verified configured MongoDB index creation for `reports` and `report_runs` before report routes were added.

The proof pack is recorded in `docs/proof/s2-04-1-report-index-verification.md`.

## S2-05 Dashboard Snapshot Route

S2-05 is complete. It added an authenticated synchronous backend MVP route:

```text
POST /api/v1/reports/dashboard-snapshot
```

Request shape:

```js
{
  organization_id: "org_123",
  client_id: "client_123",
  location_id: "loc_123",
  report_name: "Monthly GBP dashboard",
  report_key: "gbp_dashboard_monthly",
  requested_formats: ["pdf", "xlsx"],
  date_range: { start: "2026-04-01", end: "2026-04-30" },
  dashboard_snapshot: {}
}
```

The route:

- requires app authentication
- applies generation rate limiting
- requires explicit `organization_id`
- does not infer scope from active user or session state
- verifies owned Google location scope when `location_id` is provided
- requires request `organization_id`, `client_id`, and `location_id` to match the owned location canonical scope
- builds S2-01 report run metadata
- saves a pending `report_runs` record
- marks the run running
- generates requested PDF/XLSX outputs synchronously
- stores output metadata only in `report_runs`
- marks the run succeeded only when all requested outputs succeed
- marks the run failed if any output fails
- writes audit records for queued/success/failure outcomes

S2-05 does not auto-bind Google locations and does not change GBP dashboard behavior.

Response shape on success:

```js
{
  report_run: {},
  outputs: [
    {
      format: "pdf",
      status: "succeeded",
      path: null,
      size: 12345,
      error: null,
      completed_at: Date
    }
  ],
  files: [
    {
      format: "pdf",
      filename: "gbp-dashboard-monthly-run_id.pdf",
      content_type: "application/pdf",
      base64: "...",
      size: 12345
    }
  ]
}
```

Generated files are returned as base64 only for this MVP because no durable file storage exists yet. The route caps total raw generated file bytes before returning the response. Generated PDF/XLSX buffers are never stored in MongoDB.

## S2-05.1 Route Smoke Verification

S2-05.1 is complete. It smoke tested the authenticated route against the configured API/Mongo environment and verified:

- HTTP `200` success from `POST /api/v1/reports/dashboard-snapshot`.
- PDF and XLSX entries in the returned `files` array with base64 payloads.
- Metadata-only `report_runs` persistence, with no generated buffers or base64 stored in MongoDB.
- Audit success logging for report generation.

The proof pack is recorded in `docs/proof/s2-05-1-report-route-smoke.md`.

## S2-06 Frontend Dashboard Action

S2-06 is in progress. It adds a visible dashboard action that calls the authenticated report route from the existing GBP dashboard after the user has:

- app authentication
- an active location
- loaded dashboard data
- canonical `organization_id` and `client_id` on the selected location

The frontend request body is built from current dashboard state only:

```js
{
  organization_id,
  client_id,
  location_id,
  report_name,
  report_key: "gbp_dashboard_snapshot",
  requested_formats: ["pdf", "xlsx"],
  date_range,
  dashboard_snapshot: {
    title,
    provider,
    cards,
    metrics,
    tables,
    charts,
    metadata: {
      location_label,
      range_label
    }
  }
}
```

The dashboard snapshot is intentionally compact. It includes KPI cards, metric totals, the visible raw totals table, sparkline chart points already loaded for the dashboard range, and metadata limited to selected range/location labels. It does not send raw tokens, browser storage contents, provider secrets, or unrelated app state.

On success, the frontend converts each returned `files[]` base64 payload into a `Blob`, preserves backend filenames when present, triggers browser downloads for PDF/XLSX, and revokes object URLs after use. Generated base64 is not written to `localStorage`, `sessionStorage`, or any frontend cache.

The existing client-side CSV/SVG/PNG/PDF dashboard exports remain in place. S2-06 does not add backend routes, queues, workers, scheduler behavior, email delivery, durable file/cloud storage, report history UI, billing/entitlements, Phase 2 providers, or multi-channel metrics.

## Intentionally Not Implemented

S2-01/S2-02/S2-03/S2-04/S2-05/S2-06 do not:

- Add report queues or workers.
- Send emails.
- Schedule recurring reports.
- Add report history UI.
- Add dashboard builder behavior.
- Add multi-channel metrics.
- Add billing or entitlement checks.

S2-02 generates an in-memory PDF buffer only. S2-03 generates an in-memory XLSX buffer only. Neither service writes files unless a future caller chooses to do so.

S2-04 persists report/report run metadata only. It does not wire persistence into routes, queues, schedulers, workers, emails, or frontend UI.

S2-05 wires a synchronous authenticated route only. It does not add file storage, queues, workers, scheduler behavior, emails, report history UI, frontend wiring, or unauthenticated/public report access.

S2-06 wires the existing frontend dashboard to the authenticated route only. Queue-backed generation, durable storage, report history UI, scheduled reports, and email delivery remain follow-ups.

## Dashboard Snapshot Input Contract

The service expects a dashboard snapshot request shaped like:

```js
{
  report_type: "dashboard_snapshot",
  report_name: "Monthly GBP dashboard",
  report_key: "gbp_dashboard_monthly",
  organization_id: "org_123",
  client_id: "client_123",
  location_id: "loc_123",
  requested_formats: ["pdf", "xlsx"],
  date_range: { start: "2026-04-01", end: "2026-04-30" },
  requested_by_user_id: "user_123",
  dashboard_snapshot: {
    title: "April dashboard",
    provider: "google",
    sections: [],
    cards: [],
    tables: [],
    charts: [],
    metrics: [],
    metadata: {}
  }
}
```

Accepted aliases include camelCase forms such as `reportName`, `reportKey`, `requestedFormats`, `dateRange`, `organizationId`, `clientId`, and `locationId`.

Date ranges must use valid `YYYY-MM-DD` dates, must be ordered, and may not exceed 366 days.

## Report Run Metadata Contract

`buildDashboardSnapshotReportRun(...)` returns metadata shaped like:

```js
{
  id: "run_uuid",
  report_id: null,
  report_key: "gbp_dashboard_monthly",
  report_type: "dashboard_snapshot",
  report_name: "Monthly GBP dashboard",
  status: "pending",
  requested_formats: ["pdf", "xlsx"],
  outputs: [],
  input_snapshot: {},
  input_snapshot_summary: {
    title: "April dashboard",
    provider: "google",
    section_count: 0,
    card_count: 0,
    table_count: 0,
    chart_count: 0,
    metric_count: 0
  },
  filters: {
    date_range: { start: "2026-04-01", end: "2026-04-30", days: 30 },
    metadata: {}
  },
  organization_id: "org_123",
  client_id: "client_123",
  location_id: "loc_123",
  requested_by_user_id: "user_123",
  created_at: Date,
  updated_at: Date,
  started_at: null,
  completed_at: null
}
```

The `input_snapshot` is JSON-safe and sanitized. Secret-like keys are redacted, nested objects/arrays are capped, strings are truncated, and oversized snapshot metadata is replaced with a compact truncation marker.

## Output Metadata Contract

`createPendingOutput(format)` returns:

```js
{
  format: "pdf",
  status: "pending",
  path: null,
  size: null,
  error: null,
  created_at: Date,
  updated_at: Date,
  completed_at: null
}
```

`markOutputSucceeded(output, { path, size })` returns a copy with:

- `status: "succeeded"`
- normalized `path`
- normalized byte `size`
- `error: null`
- `completed_at` set

`markOutputFailed(output, { error })` returns a copy with:

- `status: "failed"`
- compact `error.code`
- compact `error.message`
- `completed_at` set

S2-02 `buildPdfOutputResult(reportRun, options)` returns:

```js
{
  buffer: Buffer,
  output: {
    format: "pdf",
    status: "succeeded",
    path: null,
    size: 12345,
    error: null,
    completed_at: Date
  }
}
```

If PDF generation fails or PDF was not requested, `buffer` is `null` and `output.status` is `"failed"` with a compact error object.

S2-03 `buildXlsxOutputResult(reportRun, options)` returns:

```js
{
  buffer: Buffer,
  output: {
    format: "xlsx",
    status: "succeeded",
    path: null,
    size: 12345,
    error: null,
    completed_at: Date
  }
}
```

If XLSX generation fails or XLSX was not requested, `buffer` is `null` and `output.status` is `"failed"` with a compact error object.

## Status Lifecycle

The shared status vocabulary is:

- `pending`
- `running`
- `succeeded`
- `failed`

S2-01 creates pending report run metadata only. Later generation tasks can move a run to `running`, then `succeeded` or `failed`.

## S2 Handoff

S2-02 PDF export consumes this report run metadata and fills PDF output metadata in memory.

S2-03 XLSX export consumes the same report run metadata and fills XLSX output metadata in memory.

S2-04 report/report_runs persistence defines the Mongo collection shapes and indexes for durable report definitions and report run history.

S2-05 uses the report metadata, PDF, XLSX, and persistence services from S2-01 through S2-04 to provide a synchronous authenticated dashboard snapshot generation endpoint.

S2-06 uses that endpoint from the existing dashboard and downloads returned files in-browser without persisting generated file content.

Future queue direction may include a `report-generate` queue and dedicated report worker, but S2-01/S2-02/S2-03/S2-04/S2-05/S2-06 only document that direction. They do not create a queue or worker.

## Sprint 2 / Phase 1 Closeout (S2-18)

S2-18 produced the Sprint 2 / Phase 1 closeout proof pack (`docs/proof/sprint-2-closeout-proof-pack.md`). The report foundation is recorded as complete from S2-01 through S2-06.1 within the documented scope. Limitations explicitly carried forward to future tasks:

- generation remains synchronous and returns base64 files only because no durable file storage exists yet
- there is no report queue, dedicated report worker, scheduler hook, email delivery, recurring schedule, or report history UI
- report definition CRUD is not exposed as a route; the `reports` collection contract exists but is wired only through the synchronous `POST /api/v1/reports/dashboard-snapshot` flow
- Phase 2 integrations remain blocked until the closeout is explicitly accepted

Recommended next report-direction task per the closeout is S2-20: design report history / listing UI or durable report storage as a contract-only task before implementation, while keeping generation synchronous in the interim.

## S2-22 Durable Local Report Output Storage

S2-22 is complete. It implements the first cut of the storage adapter designed in S2-20.

Current state additions:

- `apps/api/src/services/reportStorage.js` provides a `local` `ReportStorageAdapter` implementation with `writeOutput`/`readOutput`/`statOutput`/`deleteOutput`. Path safety rejects traversal, absolute keys, backslashes, empty segments, `.`/`..` segments, and unsupported formats/ids/filenames. Resolved on-disk paths are confirmed to stay inside the configured root.
- Storage root resolution: `REPORT_STORAGE_LOCAL_DIR` when set; otherwise `<os.tmpdir()>/parametrics/report-outputs`. The adapter never writes inside the git working tree by default.
- `POST /api/v1/reports/dashboard-snapshot` continues to generate PDF/XLSX buffers synchronously and now also writes each successful output through the adapter before persisting `report_runs.outputs[]` metadata. Persisted output metadata gains `storage_provider`, `storage_key`, `content_type`, `filename`, `checksum: { algorithm: "sha256", value }`, `generated_at`, and `expires_at: null` in addition to the existing fields. The legacy `path` field stays `null`. Generated raw buffers and base64 are still never stored in MongoDB.
- The route response shape is unchanged: `files[]` still returns `{ format, filename, content_type, base64, size }` so existing frontend wiring keeps working. The base64 response remains for compatibility while durable storage now also exists on disk.
- Storage write failure marks the affected output `failed` with `error.code = "report_storage_failed"` and the run `failed` (consistent with prior partial-failure behavior). Successfully written outputs from the same run remain on disk and are recorded in the failed run document for forensic clarity.

Out of scope for S2-22 and still future:

- `GET /api/v1/reports/runs` listing, `GET /api/v1/reports/runs/:runId` detail, `GET /api/v1/reports/runs/:runId/outputs/:format` download, and optional `POST .../regenerate`. These remain designed in `docs/architecture/report-history-and-storage.md` and are not implemented.
- Cloud storage adapters (S3/GCS/Azure), signed URLs, retention/expiry enforcement, scheduled cleanup, and any frontend history UI.
- Queue/worker-based report generation. The route continues to run synchronously on the API runtime.

### S2-22.1 Live Smoke

S2-22.1 verified the durable local storage adapter and its route wiring end-to-end against a live local API + MongoDB under the controlled `s2-15-fixture-org` scope. Proof is recorded in `docs/proof/s2-22-1-durable-report-storage-live-smoke.md`. The smoke confirmed real files on disk under `REPORT_STORAGE_LOCAL_DIR` with sizes and sha256 hashes matching the persisted metadata, `report_runs.outputs[]` carrying the full durable metadata set with `path: null`, no `input_snapshot` and no raw buffer/base64 in Mongo, the unchanged base64 `files[]` response, and `location_org_map` untouched.

## S2-23 Report Run Listing API

S2-23 adds the read-only `GET /api/v1/reports/runs` endpoint. The synchronous `POST /api/v1/reports/dashboard-snapshot` route is unchanged; the listing endpoint returns sanitized rows for existing `report_runs` documents, including the durable storage metadata persisted in S2-22.

Current state additions:

- New backend endpoint `GET /api/v1/reports/runs` (authenticated, mounted under `/api/v1/reports`). Returns `{ report_runs, pagination: { limit, has_more, next_cursor } }`.
- Supported filters: `organization_id` (required), `client_id`, `location_id`, `report_type`, `report_key`, `status`, `date_from`/`date_to` (`YYYY-MM-DD`), `limit` (default `25`, max `100`).
- Sort is server-controlled (`created_at` descending with `id` tiebreaker). `next_cursor` is reserved for a future cursor implementation and is always `null`.
- Authorization uses `organization_members` only. `owner`/`admin` see all runs in the organization; `manager`/`viewer` must supply a `client_id` or `location_id` matching their `assigned_client_ids`/`assigned_location_ids`. `member`/`invited`/`disabled`/missing memberships are denied. JWT `role` and `location_org_map` are not used.
- Sanitization: omits Mongo `_id`, raw `input_snapshot`, generated buffers/base64, and absolute server paths. `storage_key` is exposed as durable metadata per the S2-20 contract; no download route exists yet.
- New backend service helpers: `listReportRuns`, `buildReportRunListQuery`, `sanitizeReportRunRow`, `REPORT_LIST_DEFAULT_LIMIT`, `REPORT_LIST_MAX_LIMIT` in `apps/api/src/services/reportStore.js`.
- No new dependency. No `package-lock.json` change. The `apps/api` `npm test` script already covers the updated tests.

Out of scope for S2-23 and still future:

- `GET /api/v1/reports/runs/:runId` detail (S2-24).
- `GET /api/v1/reports/runs/:runId/outputs/:format` download (S2-24).
- Optional `POST /api/v1/reports/runs/:runId/regenerate` (still design-only).
- Frontend report history UI (S2-25).
- Queue/worker-based report generation, dedicated `report.run.list` audit event, dedicated `report_list` rate-limit bucket, cloud storage adapters, signed URLs, retention enforcement.

### S2-23.1 Live Smoke

S2-23.1 verified the read-only listing endpoint end-to-end against a live local API + MongoDB under the controlled `s2-15-fixture-org` scope. Proof is recorded in `docs/proof/s2-23-1-report-runs-listing-live-smoke.md`. The smoke confirmed HTTP 200, the documented response shape, server-controlled newest-first sort, visibility of the S2-22.1 smoke row, filter narrowing to a single row under `status`/`report_type`/`report_key`/`date_from`/`date_to`/`limit=1`, the durable output metadata exposed per row with `path: null`, no `_id`/`input_snapshot`/`buffer`/`base64`/absolute path in the response, denial codes for missing scope and denied/non-active roles, and matching Mongo counts. Only the API runtime was started; workers and scheduler were not.

## S2-24 Report Output Download API

S2-24 adds the read-only `GET /api/v1/reports/runs/:runId/outputs/:format` endpoint. The synchronous `POST /api/v1/reports/dashboard-snapshot` route, the durable local storage adapter, PDF/XLSX generation, the persisted output shape, and the S2-23 listing endpoint are unchanged.

Current state additions:

- New backend endpoint `GET /api/v1/reports/runs/:runId/outputs/:format` (authenticated, mounted under `/api/v1/reports`). Returns raw bytes (not JSON, not base64) for the requested output format.
- Supported path params: `runId` (required), `format` (required; one of `pdf`/`xlsx`). Any other format ⇒ `400 bad_request`.
- Authorization uses `organization_members` only. `owner`/`admin` can download any output for runs in their organization. `manager`/`viewer` can download only when the run's `client_id` or `location_id` matches their `assigned_client_ids`/`assigned_location_ids`; org-level runs (no `client_id`/`location_id`) are denied for `manager`/`viewer` with `403 organization_scope_required`. `member`/`invited`/`disabled`/missing are denied. JWT `role` and `location_org_map` are not used.
- Output readiness: the requested output must exist on the run, have `status: succeeded`, and carry both `storage_provider` and `storage_key`. Otherwise the route returns `404 report_output_not_found` (format absent on the run) or `409 report_output_not_ready` (output not yet stored, failed, or pending).
- Storage read & integrity: bytes are read through the `ReportStorageAdapter.readOutput({ storage_provider, storage_key })`. Read failures surface as `500 report_output_read_failed`. The route verifies the read buffer's length matches the persisted `size` when present and recomputes `sha256` and compares against `checksum.value` when the persisted checksum is `sha256`. Mismatches surface as `500 report_output_integrity_failed`.
- Response headers on success: `Content-Type` from persisted `content_type` (falling back to the canonical MIME per format), `Content-Disposition: attachment; filename="<sanitized>"` using `output.filename` when it matches `^[A-Za-z0-9._-]+$`, `Content-Length` from the buffer length, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.
- Sanitization: the route never returns absolute server paths, storage keys, base64 bodies, or the report run document; it only returns the response headers above and the raw bytes. Storage roots and adapter credentials are never exposed.
- New backend service helpers `getReportRunById` and `findReportRunOutput` in `apps/api/src/services/reportStore.js`. `getReportRunById` defensively strips `_id` and `input_snapshot` even if the underlying collection ignores Mongo projection.
- No new dependency. No `package-lock.json` change. The `apps/api` `npm test` script already covers the updated tests.

Out of scope for S2-24 and still future:

- Frontend report history UI (S2-25).
- Optional `POST /api/v1/reports/runs/:runId/regenerate` (still design-only).
- Optional `GET /api/v1/reports/runs/:runId` detail endpoint (the download path resolves the run by id internally; a dedicated detail route remains a future addition if the frontend needs it).
- Queue/worker-based report generation, dedicated `report.output.download` audit event, dedicated `report_download` rate-limit bucket, cloud storage adapters, signed URLs, retention enforcement.

### S2-24.1 Live Smoke

S2-24.1 verified the read-only download endpoint end-to-end against a live local API + MongoDB under the controlled `s2-15-fixture-org` scope.

## S2-25 Report History UI

S2-25 adds the minimal authenticated `/reports/history` frontend page. The synchronous `POST /api/v1/reports/dashboard-snapshot` route, the durable local storage adapter, the S2-23 listing route, and the S2-24 download route are unchanged. No backend, tests, dependencies, or `package-lock.json` changed.

Current state additions:

- New SPA route `GET /reports/history` (React Router) gated by the existing `authed` guard.
- New `AppShell` nav entry `Reports` → `/reports/history`.
- New page `apps/web/src/pages/ReportHistory.jsx`: organization picker (reuses `GET /api/v1/orgs`), filter form (`status`, `report_type`, `report_key`, `date_from`, `date_to`, `limit`), runs list, and per-output `Download <FORMAT>` buttons. Status/error regions use ARIA `role="status"`/`role="alert"`. The page surfaces backend `error.code`/`error.message` envelopes verbatim and does not clear app auth on `403`/`404`/`409`/`500`. Emails, `storage_key`, absolute paths, and base64 bodies are never displayed.
- New pure helper module `apps/web/src/lib/reportHistory.js`: `REPORT_RUN_STATUSES`, `REPORT_RUN_FORMATS`, `REPORT_LIST_LIMIT_*`, `clampReportListLimit`, `buildReportRunsQuery`, `parseContentDispositionFilename`, `safeDownloadFilename` (mirrors the backend `^[A-Za-z0-9._-]+$` allow-list), `formatBytes`, `normalizeReportRunRow` (drops `storage_key` defensively), `describeReportHistoryError`, `listOrganizationsForReports`, `listReportRunsForUser`, and `downloadReportOutput`. The download helper uses `fetch` directly because the shared JSON-aware `api()` client cannot return raw binary bodies; it sends the existing `Authorization: Bearer …` token from `getToken()` and never invents new auth state.
- Download flow: per-output button → `downloadReportOutput` → existing `downloadBlob` helper in `apps/web/src/reportDownloads.js`. The filename comes from the server's `Content-Disposition` (sanitized through `safeDownloadFilename`); user-controlled state never influences filenames or storage URLs.
- 28 new Vitest tests in `apps/web/src/lib/reportHistory.test.js` cover constants, limit clamping, query building, `Content-Disposition` parsing, filename sanitization, byte formatting, error formatting, row normalization (with a `JSON.stringify` scan that confirms `storage_key` is never exposed), and `downloadReportOutput` URL/header construction (with an injected fake fetch).

Out of scope for S2-25 and still future:

- Frontend report detail page; the listing carries all metadata the download path needs.
- Frontend regenerate button (the optional `POST /api/v1/reports/runs/:runId/regenerate` route remains design-only).
- Cursor pagination UI (`next_cursor` is reserved in the backend response shape but not yet wired).
- Cloud storage adapters, signed URLs, retention enforcement, scheduled/recurring reports, email delivery, dedicated `report.run.read` / `report.output.download` audit events, dedicated `report_list` / `report_download` rate-limit buckets.
- Queue/worker-based report generation.
- Component-render testing (no `@testing-library/react` installed); helper coverage is the testing surface today.
- Phase 2 providers, multi-channel metrics, billing/entitlements, or GBP behavior changes.

## S2-29 Report Audit / Rate-Limit Hardening

S2-29 wires the read-only report listing and download routes onto dedicated audit events and dedicated rate-limit buckets.

Current state additions:

- `GET /api/v1/reports/runs` runs the `report_list` rate-limit bucket (default `120` requests per `RATE_LIMIT_WINDOW_SECONDS` window per `req.user.user_id`; env override `RATE_LIMIT_REPORT_LIST_MAX`). Successful responses emit a `report.run.list` audit event with compact metadata `{ report_type?, report_key?, status?, date_from?, date_to?, limit, result_count, has_more, membership_role }`. Failures after auth/membership emit `report.run.list_failed` with `{ ...filters, limit, reason: { code, message }, status }`.
- `GET /api/v1/reports/runs/:runId/outputs/:format` runs the `report_download` rate-limit bucket (default `60` requests per window per `req.user.user_id`; env override `RATE_LIMIT_REPORT_DOWNLOAD_MAX`). Successful responses emit a `report.output.download` audit event with `{ report_run_id, format, size, content_type, storage_provider, checksum_algorithm, membership_role }`. Failures emit `report.output.download_failed` with `{ report_run_id, format?, reason, status }`.
- `POST /api/v1/reports/dashboard-snapshot` continues to use the existing `generation` rate-limit bucket and `report.dashboard_snapshot.generate` audit events. No change to its body, headers, or response shape.
- The audit payload builders `compactListAuditFilters`, `buildListAuditDetails`, `buildListFailureAuditDetails`, `buildDownloadAuditDetails`, and `buildDownloadFailureAuditDetails` are exported from `apps/api/src/routes/reports.js` for direct unit testing. The route handlers stay thin and call `auditSuccess` / `auditFailure` with the produced payload.
- Sanitization: storage keys, absolute paths, filenames, generated buffers, base64 payloads, and the run document body are never logged in the new audit events; secret-bearing fields stay redacted by the existing `sanitizeAuditMetadata` pipeline. Audit failures are swallowed by `writeAuditLog`'s try/catch so they cannot fail listing/download requests.
- Rate-limit middleware exposes new helpers `reportListRateLimit` and `reportDownloadRateLimit` from `apps/api/src/middleware/rateLimit.js`, with the new defaults added to `resolveRateLimitConfig`. The 429 response shape, `Retry-After`, and `X-RateLimit-*` headers are unchanged.

Out of scope for S2-29 and still future:

- Redis-backed distributed rate limiting (the in-process limiter remains).
- Per-bucket configuration UI or admin overrides beyond the `RATE_LIMIT_*` env keys.
- Report detail / regenerate routes and their audit/rate-limit definitions.
- Frontend code changes, dependency installs, or `package-lock.json` updates.

## S2-28 Report Storage Env Hardening

S2-28 adds startup-time validation of `REPORT_STORAGE_LOCAL_DIR` so production-like environments cannot silently use `<os.tmpdir()>/parametrics/report-outputs`. The exported helper `validateReportStorageConfig({ env, cwd, fsImpl })` lives in `apps/api/src/services/reportStorage.js` and is called by `apps/api/src/server.js` before `ensureIndexes()` and `app.listen()`. On failure, the API logs `[report_storage] startup validation failed: <code>: <message>` and exits non-zero. On success, it logs only `[report_storage] provider=local configured=<bool> production=<bool> root=<redacted-label>` (e.g. `<persistent-root>/<basename>` or `<os-tmpdir>/parametrics/report-outputs`). Absolute paths, env values, and storage credentials are never logged or returned to clients. The synchronous `POST /api/v1/reports/dashboard-snapshot` route, the listing API (S2-23), the download API (S2-24), and the report history UI (S2-25) are unchanged; `report_runs.outputs[]` metadata shape is unchanged; storage key safety rules and adapter read/write/stat/delete behavior are unchanged.

Documented production env requirement: `REPORT_STORAGE_LOCAL_DIR=/var/lib/parametrics/report-outputs` (or any equivalent deployment-owned persistent path outside `/tmp`). Local development may leave it unset; the `<os.tmpdir()>/parametrics/report-outputs` fallback is preserved for ergonomics but explicitly non-durable. Proof: `docs/proof/s2-28-report-storage-env-hardening.md`. Worker and scheduler processes do not consume report storage and are not affected by this validator. No new dependency. `package-lock.json` unchanged.

### S2-26 Closeout

S2-26 records the Sprint 2 report foundation closeout decision (Pass) and the conservative next-task recommendations (`S2-27` optional manual visual browser click smoke, `S2-28` persistent storage env/deployment hardening, `S2-29` report audit/rate-limit hardening, `S2-30` optional report detail/regenerate contract). Phase 2 provider adapters remain blocked until this closeout is explicitly accepted. Test/build at closeout: `apps/api npm test` = `tests 176 / pass 176 / fail 0`; `apps/web npm test --run` = `Test Files 5 passed (5) / Tests 49 passed (49)`; `apps/web npm run build` = `288 modules transformed`; pre-existing Browserslist warning unchanged. Proof: `docs/proof/sprint-2-report-foundation-proof-pack.md`. No backend, frontend, API tests, web `package.json`, or `package-lock.json` change.

### S2-25.1 Browser Smoke

S2-25.1 verified the `/reports/history` page end-to-end against a local API + web dev-server pair under the controlled `s2-15-fixture-org` scope. Proof is recorded in `docs/proof/s2-25-1-report-history-ui-browser-smoke.md`. The smoke confirmed the SPA shell + dev-served route/nav/page module wiring, the live listing flow (broad listing returns S2-22.1 + S2-24.1 fixture rows; the documented filter combo narrows to the S2-24.1 row), the live download flow (PDF/XLSX raw bytes match S2-24.1 persisted size and sha256, with `Content-Type` matching persisted `output.content_type`, ASCII-safe `Content-Disposition`, `Content-Length` matching the buffer, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`), the dev-served page module containing zero `storage_key` references and the dev-served helper module exposing only a presence-only check, and the documented `400 bad_request` / `401 unauthorized` / `403 organization_role_required` / `403 organization_scope_required` envelopes for inline error paths. Interactive in-browser DOM mount and `<a download>` click were skipped because no headless-browser tool is available in this environment; the same fetch URL/header contract the page builds was reproduced and validated. Only the API and the Vite dev server were started; workers and scheduler were not. Proof is recorded in `docs/proof/s2-24-1-report-output-download-live-smoke.md`. The smoke confirmed HTTP 200 for owner/admin downloads with raw PDF/XLSX bytes (`%PDF` and `PK\x03\x04` magic prefixes), `Content-Type` matching persisted `output.content_type`, ASCII-safe `Content-Disposition: attachment` filename, `Content-Length` matching the read buffer length, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, downloaded byte size matching persisted `output.size`, downloaded sha256 matching persisted `output.checksum.value`, and the denial codes `organization_scope_required` (manager/viewer on org-level run), `organization_role_required` (`member`), and `organization_membership_required` (`invited`, `disabled`). Error coverage: `400 bad_request` for invalid/unknown format, `404 report_run_not_found` for unknown run id, and `401 unauthorized` for missing auth. The `404 report_output_not_found`, `409 report_output_not_ready`, `500 report_output_read_failed`, and `500 report_output_integrity_failed` branches were skipped live because reproducing them safely requires data mutation; they remain covered by the S2-24 unit tests. Because the original S2-22.1 storage directory under `/tmp` was wiped between 2026-05-12 and 2026-05-16, one fresh fixture run was generated (new `report_key: s2-24-1-smoke-dashboard`) before downloading. Only the API runtime was started; workers and scheduler were not.

## S2-20 Report History And Storage Contract

S2-20 is complete as documentation/design only. The report history listing, run detail, output download, and durable output storage contract is recorded in `docs/architecture/report-history-and-storage.md`.

The S2-20 contract intentionally keeps **current state vs target state** separate from this document:

- Current state remains the synchronous `POST /api/v1/reports/dashboard-snapshot` route with base64 inline response, metadata-only `report_runs` persistence, and no durable storage. Nothing about that current state changes in S2-20.
- Target state in `docs/architecture/report-history-and-storage.md` proposes `GET /api/v1/reports/runs`, `GET /api/v1/reports/runs/:runId`, `GET /api/v1/reports/runs/:runId/outputs/:format`, an optional future `POST /api/v1/reports/runs/:runId/regenerate`, a `ReportStorageAdapter` abstraction (local-first, cloud-later), additive `report_runs.outputs[]` fields (`storage_provider`, `storage_key`, `content_type`, `filename`, `checksum`, `generated_at`, `expires_at`), authorization aligned with `organization_members` (owner/admin/manager/viewer can read scoped history; `member`/`invited`/`disabled` denied), a `/reports/history` frontend page recommendation, listing/download indexes, and a conservative implementation sequence (S2-22 storage adapter → S2-23 listing API → S2-24 download API → S2-25 frontend history page; S2-26 queue/worker only after acceptance).

S2-20 did not add backend code, frontend code, routes, services, queues, workers, scheduler changes, dependencies, email delivery, report history UI, file/cloud storage implementation, or Phase 2 integrations. Phase 2 work remains blocked.
