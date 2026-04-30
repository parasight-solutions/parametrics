# Report Service

ParaMetrics Phase 1 / Sprint 2 starts the reports foundation while the product remains Google Business Profile first.

## Current State

The frontend dashboard currently supports client-side exports from the GBP dashboard, including CSV, SVG, PNG, and PDF snapshot behavior in `apps/web/src/pages/Dashboard.jsx`.

The backend has no report generation route, no report queue, and no report/report run persistence yet. Phase 0 backend stabilization is complete: API/worker/scheduler runtime separation, auth hardening, CORS, rate limiting, audit logging, and canonical location binding are in place.

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

S2-03 adds backend XLSX output generation in `apps/api/src/services/reportXlsx.js`.

The XLSX service accepts a report run produced by `buildDashboardSnapshotReportRun(...)` and produces a minimal workbook buffer for the `xlsx` output format. It also returns output metadata compatible with the S2-01 contract.

S2-03 workbook sheets are:

- `Summary`: report name, report key/type, generated timestamp, date range, organization/client/location identifiers, requested-by user id, and dashboard snapshot summary counts.
- `Cards`: capped card titles, values, and compact details.
- `Metrics`: capped metric names, values, and compact details.
- `Tables`: capped table row summaries.
- `Charts`: capped chart titles, point counts, and compact point summaries.

The XLSX renderer uses the sanitized S2-01 `input_snapshot` and does not read raw request bodies. Text and row counts are capped, secret-like keys are skipped or redacted before output, and large dashboard snapshots are not dumped into the workbook.

S2-03 intentionally keeps workbook output simple. It does not add styling, formulas, charts, images, templates, a report API route, Mongo persistence, queues, workers, scheduling, emails, frontend wiring, or PDF changes.

## Intentionally Not Implemented

S2-01/S2-02/S2-03 do not:

- Persist `reports` or `report_runs` collections.
- Add Mongo indexes for reports.
- Add a public reports API route.
- Add report queues or workers.
- Send emails.
- Schedule recurring reports.
- Add report history UI.
- Add dashboard builder behavior.
- Add multi-channel metrics.
- Add billing or entitlement checks.

S2-02 generates an in-memory PDF buffer only. S2-03 generates an in-memory XLSX buffer only. Neither service writes files unless a future caller chooses to do so.

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

S2-04 report/report_runs persistence should decide the Mongo collection shapes and indexes for durable report definitions and report run history.

Future queue direction may include a `report-generate` queue and dedicated report worker, but S2-01/S2-02/S2-03 only document that direction. They do not create a queue or worker.
