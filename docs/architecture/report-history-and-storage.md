# Report History And Storage Contract

ParaMetrics remains a Google Business Profile first operations app. This document is the S2-20 design contract for future report history listing, run detail, and durable output storage work, and the S2-22 implementation note for the first durable local report storage adapter. The listing and download routes remain design-only; only the storage adapter and its route wiring are implemented today. Sprint 2 / Phase 1 closeout (S2-18) and the S2-19 API `npm test` script consolidation are accepted preconditions for this design.

Phase 2 integrations remain blocked. This contract intentionally does not assume new providers, dashboard builder, billing/entitlements, or multi-channel metrics.

## S2-22 Implementation Note

S2-22 introduces the first cut of the storage adapter described in Section 4 below.

- Implemented module: `apps/api/src/services/reportStorage.js`.
- Provider: `local` only. Cloud adapters (S3/GCS/Azure) are still future.
- Adapter surface today: `provider`, `root`, `writeOutput`, `readOutput`, `statOutput`, `deleteOutput`. The Section 4 contract calls the read method `readOutputStream` and types it `Promise<ReadableStream>`. The first cut returns a `Promise<Buffer>` instead because the S2-22 scope writes durable bytes synchronously inside the existing `POST /api/v1/reports/dashboard-snapshot` route and does not expose a public download route yet. The future download API task (S2-24) may rename or extend this method to return a `ReadableStream` without changing on-disk layout or the persisted output metadata.
- Storage root resolution:
  - When `REPORT_STORAGE_LOCAL_DIR` is set in `process.env`, the adapter uses that path verbatim. The startup helper does not create the directory until the first write.
  - When `REPORT_STORAGE_LOCAL_DIR` is unset, the adapter falls back to `<os.tmpdir()>/parametrics/report-outputs` so writes never land inside the git working tree.
  - Tests must always pass an explicit `root` (typically via `fs.mkdtemp(...)`) so unit tests stay deterministic and self-cleaning.
- Path safety: traversal, absolute keys, backslashes, empty segments, `.`/`..` segments, and disallowed formats/ids/filenames are rejected with codes `report_storage_invalid_id`, `report_storage_invalid_filename`, `report_storage_unsupported_format`, `report_storage_invalid_key`, `report_storage_empty_buffer`, `report_storage_invalid_content_type`, `report_storage_buffer_too_large`, or `report_storage_unsupported_provider`. Resolved absolute paths are confirmed to stay inside the resolved root with `path.relative`.
- Output metadata returned by `writeOutput`: `storage_provider`, `storage_key`, `content_type`, `filename`, `size`, `checksum: { algorithm: "sha256", value }`, `generated_at`, `expires_at: null`. Absolute paths and adapter credentials are never returned to callers.
- Route wiring: `POST /api/v1/reports/dashboard-snapshot` continues to generate PDF/XLSX buffers in memory, returns the existing base64 `files[]` response unchanged, and now also writes each successful output through the adapter. The persisted `report_runs.outputs[]` entries gain `storage_provider`, `storage_key`, `content_type`, `filename`, `checksum`, `generated_at`, and `expires_at` (additive on the existing `format`/`status`/`path`/`size`/`error`/timestamps shape). The legacy `path` field stays `null`. If storage write fails, the affected output is marked `failed` with `error.code = "report_storage_failed"` and the run is marked `failed` consistent with prior partial-failure behavior. Successfully written outputs from the same run remain on disk.
- Listing/download routes remain future. `GET /api/v1/reports/runs`, `GET /api/v1/reports/runs/:runId`, `GET /api/v1/reports/runs/:runId/outputs/:format`, and the optional `POST .../regenerate` are still designed in Sections 3 and 11 and are not implemented in S2-22.
- Audit log content unchanged: storage keys are not written to audit metadata. Existing `report.dashboard_snapshot.generate` audit events continue to record summarized identifiers, counts, role, and outcome only.

### S2-22.1 Live Smoke

S2-22.1 ran a live local API + MongoDB smoke against the controlled `s2-15-fixture-org` scope to verify the S2-22 implementation end-to-end. Proof is recorded in `docs/proof/s2-22-1-durable-report-storage-live-smoke.md`. The smoke confirmed: HTTP 200 from `POST /api/v1/reports/dashboard-snapshot`, `report_run.status: succeeded`, the unchanged base64 `files[]` response, the full durable metadata set on `report_runs.outputs[]` (`storage_provider`, `storage_key`, `content_type`, `filename`, `size`, `checksum: sha256`, `generated_at`, `expires_at: null`, `path: null`), files under `REPORT_STORAGE_LOCAL_DIR` whose byte sizes and sha256 hashes match the persisted metadata, no `input_snapshot` and no raw buffer/base64 fields in Mongo, and `location_org_map` untouched. Org-level coverage only; the GBP location-bound code path is still covered by the existing S2-10.2 GBP membership smoke and the S2-22 unit tests.

## S2-24 Implementation Note

S2-24 implements the read-only `GET /api/v1/reports/runs/:runId/outputs/:format` endpoint described in Section 3.3. The optional regenerate route remains design-only; the frontend `/reports/history` page (S2-25) remains future work.

- Implemented route: `GET /api/v1/reports/runs/:runId/outputs/:format` mounted under the existing `/api/v1/reports` router. Read-only. Streams persisted bytes back to the requester as a raw response body (not JSON, not base64).
- Implemented service helpers: `getReportRunById(runId, options)` and `findReportRunOutput(run, format)` in `apps/api/src/services/reportStore.js`. `getReportRunById` projects `_id: 0, input_snapshot: 0` at the Mongo layer and additionally strips both fields defensively after load.
- Path parameters: `runId` required; `format` required and limited to `pdf` or `xlsx`. Any other format value is rejected with `400 bad_request` at the route layer; the storage adapter's `report_storage_unsupported_format` is never surfaced because the route validates first.
- Authorization (matches Section 6):
  - Requires app authentication via the existing `authenticate` middleware.
  - Resolves an `active` `organization_members` record for the requester using the run's `organization_id` via `requireOrganizationMembership`. JWT `role` and `location_org_map` are not used.
  - `owner` and `admin` can download any output for runs in their organization.
  - `manager` and `viewer` can download only when the run has a `client_id` or `location_id` that is present in their `assigned_client_ids` / `assigned_location_ids`. Org-level runs (`client_id` and `location_id` both null) are denied for `manager`/`viewer` with `403 organization_scope_required` — consistent with the listing endpoint's "deny-by-default until an org-level scope model exists" convention.
  - `member`, any other role, and missing memberships are denied. Non-`active` memberships (`invited`, `disabled`) are denied by `requireOrganizationMembership` itself.
- Output selection and readiness:
  - `findReportRunOutput(run, format)` returns the case-insensitive match in `report_runs.outputs[]`. Missing format ⇒ `404 report_output_not_found`.
  - Output `status` must equal `succeeded`. Output must also carry a non-empty `storage_provider` and `storage_key`. Otherwise the route returns `409 report_output_not_ready`. This covers both freshly-pending/running outputs and legacy outputs from before durable storage existed.
- Storage read and integrity:
  - Bytes are read via the storage adapter's `readOutput({ storage_provider, storage_key })`. The default storage adapter resolution path mirrors the synchronous report route (`getDefaultReportStorage()`); tests inject a fake adapter through `deps.reportStorage`.
  - The adapter's path-safety rules continue to apply: `report_storage_invalid_key`, `report_storage_unsupported_provider`, traversal/absolute-path checks. All storage errors are surfaced to the route as `500 report_output_read_failed` with a compact message.
  - If the persisted output carries a `size`, the route verifies the read buffer's length matches before sending. Mismatch ⇒ `500 report_output_integrity_failed`.
  - If the persisted output carries `checksum.algorithm === "sha256"` with a value, the route recomputes `sha256(buffer)` and compares. Mismatch ⇒ `500 report_output_integrity_failed`.
- Response headers and body:
  - `Content-Type` is read from the persisted output `content_type` (falling back to the canonical MIME for the format).
  - `Content-Disposition: attachment; filename="<sanitized-filename>"`. The filename comes from `output.filename` if it matches `^[A-Za-z0-9._-]+$`; otherwise it falls back to `<sanitized-report_key>-<run_id>.<format>`. Never echoes user-controlled strings.
  - `Content-Length` is set from the read buffer length.
  - `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` are set on every successful response.
  - Body is the raw `Buffer` (`res.end(buffer)`); the response is never JSON and never base64.
- Non-mutating: the route never updates `report_runs`, never writes new storage, never logs the storage root, and never returns the run document body. Absolute paths and storage credentials never appear in the response.
- Error codes used: `400 bad_request`, `401 unauthorized`, `403 organization_membership_required`, `403 organization_role_required`, `403 organization_scope_required`, `404 report_run_not_found`, `404 report_output_not_found`, `409 report_output_not_ready`, `500 report_output_read_failed`, `500 report_output_integrity_failed`.
- Audit/rate-limit: matches the existing S2-23 read-only convention — no dedicated `report.output.download` audit event and no dedicated `report_download` rate-limit bucket in this first cut. The S2-20 contract reserves both; they remain optional hardening for a future task.

## S2-23 Implementation Note

S2-23 implements the read-only `GET /api/v1/reports/runs` listing endpoint described in Section 3.1. Detail (`GET /api/v1/reports/runs/:runId`) and output download (`GET /api/v1/reports/runs/:runId/outputs/:format`) remain future work (S2-24+); the optional regenerate route remains design-only.

- Implemented route: `GET /api/v1/reports/runs` mounted under the existing `/api/v1/reports` router. Read-only.
- Implemented service helper: `listReportRuns(filter, options)` in `apps/api/src/services/reportStore.js`. Supporting exports: `buildReportRunListQuery`, `sanitizeReportRunRow`, `REPORT_LIST_DEFAULT_LIMIT`, `REPORT_LIST_MAX_LIMIT`.
- Query parameters honored: `organization_id` (required), `client_id`, `location_id`, `report_type`, `report_key`, `status` (one of `pending`/`running`/`succeeded`/`failed`), `date_from` / `date_to` (`YYYY-MM-DD`; filter `created_at >= date_from` and `<= end of date_to`), `limit` (default 25, max 100). `sort` is server-controlled (`created_at desc` with `id` tiebreaker); no client-supplied sort is accepted.
- Pagination: `{ limit, has_more, next_cursor: null }`. The first cut uses limit-only behavior with `has_more` derived from a `limit + 1` fetch. `next_cursor` is reserved for a future cursor implementation (see Section 3.5) and is always `null` today.
- Authorization: requires app authentication; resolves an `active` `organization_members` record for the requester via `requireOrganizationMembership` and applies the role rules in Section 6:
  - `owner` and `admin`: see all runs in the requested organization regardless of optional `client_id`/`location_id` filters.
  - `manager` and `viewer`: must supply at least one of `client_id` / `location_id`; the value is validated against the requester's `assigned_client_ids` / `assigned_location_ids`. Missing or mismatched scope returns `403 organization_scope_required`.
  - `member`, `invited`, `disabled`, and missing memberships are denied with `403 organization_role_required` or `403 organization_membership_required` (matching the S2-12 read-only listing convention).
  - JWT `role` claim and `location_org_map` are not used for authorization.
- Sanitization: rows never include Mongo `_id`, the raw `input_snapshot` body, raw buffers, base64 payloads, or absolute server paths. `storage_key` is exposed because S2-20 explicitly classifies it as durable metadata; no download route exists yet, so possession of a `storage_key` cannot be used to fetch bytes. The persistence layer already excludes `input_snapshot` from saved documents (S2-04), and the list helper additionally projects `_id: 0, input_snapshot: 0` defensively.
- Error codes:
  - `400 bad_request` — missing `organization_id`, malformed `limit`.
  - `400 invalid_date_range` — malformed `date_from`/`date_to`, inverted range.
  - `400 invalid_report_run_status` — `status` not in the run status vocabulary.
  - `400 invalid_report_run_limit` — non-positive limit at the service layer.
  - `401 unauthorized` — missing/invalid JWT.
  - `403 organization_membership_required` — no active membership in the organization.
  - `403 organization_role_required` — active membership but unsupported role.
  - `403 organization_scope_required` — manager/viewer without a matching `client_id`/`location_id` filter.
- Audit/rate-limit: matches the existing `GET /orgs/:orgId/members` read-only convention — no audit event and no dedicated rate-limit bucket in this first cut. The S2-20 contract reserves `report.run.list` and a dedicated `report_list` bucket; both remain optional hardening to be added in a future task if needed.

### S2-23.1 Live Smoke

S2-23.1 ran a live local API + MongoDB smoke against the controlled `s2-15-fixture-org` scope to verify the S2-23 listing endpoint end-to-end. Proof is recorded in `docs/proof/s2-23-1-report-runs-listing-live-smoke.md`. The smoke confirmed HTTP 200 from `GET /api/v1/reports/runs?organization_id=s2-15-fixture-org`, the documented `{ report_runs[], pagination: { limit, has_more, next_cursor: null } }` shape, server-controlled newest-first sort, visibility of the S2-22.1 smoke row (`s2-22-1-smoke-dashboard`) under broad roles, filter narrowing under `status=succeeded&report_type=dashboard_snapshot&report_key=s2-22-1-smoke-dashboard&date_from=2026-05-11&date_to=2026-05-13&limit=1`, the durable per-output metadata exposed (`storage_provider`, `storage_key` relative-only, `content_type`, `filename`, `size`, `checksum: sha256`, `generated_at`, `expires_at: null`, `path: null`), no `_id`/`input_snapshot`/`buffer`/`base64`/absolute-path leakage, and the denial codes `organization_scope_required` (manager/viewer without scope), `organization_role_required` (`member`), and `organization_membership_required` (`invited`, `disabled`). JWT `role` was the default `"individual"` and authorization came from `organization_members` only.

## 1. Current State

The current report foundation, recorded as complete by S2-18, is:

- Synchronous authenticated report route at `POST /api/v1/reports/dashboard-snapshot` (mounted via `apps/api/src/server.js` at `/api/v1/reports`).
- The route generates PDF and XLSX outputs in memory by `apps/api/src/services/reportPdf.js` and `apps/api/src/services/reportXlsx.js`.
- Generated buffers are returned to the caller as base64 strings in the response `files[]` array only.
- `report_runs` persistence (`apps/api/src/services/reportStore.js`) stores **metadata only**: lifecycle status, requested formats, output metadata (`format`, `status`, `path: null`, `size`, compact `error`, timestamps), `input_snapshot_summary`, `filters`, `organization_id`, `client_id`, `location_id`, `requested_by_user_id`, and timestamps.
- `reports` and `report_runs` indexes are configured in `apps/api/src/startup/ensureIndexes.js` and were verified in S2-04.1.
- No durable file storage exists. Generated PDF/XLSX bytes are not written to disk, S3, or any cloud bucket. They are returned base64-inline and then dropped from memory.
- No report history UI exists. The frontend GBP dashboard wiring (S2-06) downloads returned base64 files in the browser and does not persist them.
- No report queue, dedicated report worker, scheduler hook, email delivery, recurring schedule, or report-definition CRUD route exists.
- Membership-aware authorization for report routes is already in place via `organization_members` and `apps/api/src/services/organizationAccess.js` (see S2-09/S2-10). The JWT `role` claim is never trusted for workspace authorization.

This contract treats every item above as a documented baseline that future implementation tasks must not regress.

## 2. Target State For Report History

The target state for report history adds:

- A read-only authenticated **report run listing endpoint** for members of an organization.
- A read-only authenticated **report run detail endpoint** keyed by run id.
- A read-only authenticated **output download endpoint** keyed by run id and output format.
- An optional future **regenerate endpoint** keyed by run id (only after durable storage exists, intentionally deferred).
- A minimal authenticated **frontend report history page** that wires the read-only endpoints.
- Filters by `organization_id`, optional `client_id`, optional `location_id`, optional `report_type`, optional date range, and optional `status`.
- No Phase 2 provider assumptions. The contract only describes the existing `dashboard_snapshot` report type from S2-01..S2-06. Additional report types may exist in `reports` but are surfaced verbatim without provider-specific logic.

Target-state items explicitly **not** in scope of S2-20 or any direct follow-up before storage/listing accept:

- Email delivery, scheduled/recurring reports, public report sharing.
- Dashboard builder, AI/premium layer, multi-channel metrics.
- Phase 2 provider adapters.
- Billing/entitlement gates.
- Cross-organization report search.

## 3. Proposed API Contract

All endpoints below are designed; **none are implemented in S2-20**. They share the existing API base path `/api/v1` and the existing reports router mount `/api/v1/reports`. They share the existing app authentication middleware, the existing audit logging helpers, and the existing rate limit middleware.

### 3.1 `GET /api/v1/reports/runs`

List sanitized report runs in a single organization, with filters and pagination.

Auth and membership:

- Requires app authentication (existing JWT middleware).
- Requires an `active` membership in the requested `organization_id` resolved via `organization_members`.
- Visibility rules:
  - `owner` and `admin`: see all runs for the organization.
  - `manager`: see runs whose `client_id` or `location_id` are in the requester's `assigned_client_ids` or `assigned_location_ids`. Runs without `client_id`/`location_id` (organization-level runs) are visible to manager only when the requester has at least one matching organization-level membership entry (treated as broad organization-level access).
  - `viewer`: see-only access scoped the same as `manager` (read-only by definition).
  - `member`: deny by default. Justified below in Section 6.
  - `invited`, `disabled`, or missing: deny.
- JWT `role` claim and `location_org_map` are never consulted for authorization.

Query parameters (all optional unless noted):

- `organization_id` (required): canonical organization id. Treated as a request hint and re-verified against membership.
- `client_id`: scope to a single client; must belong to the organization.
- `location_id`: scope to a single location; canonical scope is loaded from the location document and must match `organization_id` (and `client_id` if both are sent).
- `report_type`: e.g. `dashboard_snapshot`; matched case-sensitively against `report_runs.report_type`.
- `report_key`: matched case-sensitively against `report_runs.report_key`.
- `status`: one of `pending`, `running`, `succeeded`, `failed`.
- `date_from`, `date_to`: `YYYY-MM-DD` window applied to `created_at`. Inclusive at both ends; bounded to 366 days.
- `limit`: integer, default `25`, max `100`.
- `cursor`: opaque pagination cursor (see Section 3.5). Mutually exclusive with `offset`; preferred over `offset`.
- `offset`: integer, max `1000`. Fallback only; cursor-based pagination is the canonical form once implemented.
- `sort`: one of `created_at_desc` (default), `created_at_asc`. No free-form sort fields.

Response shape (HTTP `200`):

```json
{
  "runs": [
    {
      "id": "run_uuid",
      "report_id": null,
      "report_key": "gbp_dashboard_monthly",
      "report_type": "dashboard_snapshot",
      "report_name": "Monthly GBP dashboard",
      "status": "succeeded",
      "requested_formats": ["pdf", "xlsx"],
      "outputs": [
        {
          "format": "pdf",
          "status": "succeeded",
          "size": 12345,
          "content_type": "application/pdf",
          "filename": "gbp-dashboard-monthly-run_uuid.pdf",
          "storage_provider": "local",
          "available": true,
          "generated_at": "2026-05-11T00:00:00.000Z",
          "expires_at": null,
          "error": null
        }
      ],
      "filters": {
        "date_range": { "start": "2026-04-01", "end": "2026-04-30", "days": 30 },
        "metadata": {}
      },
      "input_snapshot_summary": {
        "title": "April dashboard",
        "provider": "google",
        "section_count": 0,
        "card_count": 0,
        "table_count": 0,
        "chart_count": 0,
        "metric_count": 0
      },
      "organization_id": "org_id",
      "client_id": "client_id",
      "location_id": "location_id",
      "requested_by_user_id": "user_id",
      "created_at": "2026-05-11T00:00:00.000Z",
      "updated_at": "2026-05-11T00:00:00.000Z",
      "started_at": "2026-05-11T00:00:00.000Z",
      "completed_at": "2026-05-11T00:00:00.000Z",
      "error": null
    }
  ],
  "page": {
    "limit": 25,
    "next_cursor": "opaque_cursor_or_null",
    "has_more": true
  }
}
```

Sanitization rules (apply to every row):

- Omit Mongo `_id`.
- Omit raw `input_snapshot` body. Only `input_snapshot_summary` is exposed.
- Omit `storage_key`, raw absolute server paths, signed URLs (when introduced), bucket names, or any storage credential.
- Omit JWTs, OAuth access/refresh/ID tokens, auth codes, encrypted secrets, password fields, raw user records, raw provider payloads, and emails.

Safe errors:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Missing/invalid `organization_id`, malformed dates, invalid `status`, `limit > 100`, or both `cursor` and `offset` supplied. |
| 401 | `unauthorized` | App authentication failed. |
| 403 | `organization_membership_required` | Requester has no active membership in the organization. |
| 403 | `organization_role_required` | Requester has active membership but the role/scope does not permit reading runs in the requested filter. |
| 404 | `organization_not_found` | Organization does not exist. |
| 429 | `rate_limited` | Listing bucket exceeded; see Section 3.6. |

Audit event: `report.run.list`. Compact metadata: `organization_id`, optional filter ids/types/statuses, `limit`, outcome, result count. No raw filter bodies, no run ids enumerated.

Rate-limit bucket: shared `report_list` bucket keyed by `req.user.user_id` + `organization_id` (see Section 3.6).

### 3.2 `GET /api/v1/reports/runs/:runId`

Return the sanitized record for a single run.

Auth and membership:

- Requires app authentication.
- Resolves the run document, then enforces:
  - run `organization_id` matches an organization the requester has an `active` membership in
  - role/scope checks from Section 3.1 against the run's `organization_id` / `client_id` / `location_id`
- If the run is not visible to the requester, the response is `404 report_run_not_found` (not `403`), to avoid leaking run existence.

Path parameter:

- `runId`: required.

Response shape (HTTP `200`): a single `run` object using the same sanitized shape as a list row plus a `links` object describing safe download links for currently `available` outputs.

```json
{
  "run": { /* same as list row */ },
  "links": {
    "outputs": [
      {
        "format": "pdf",
        "download_url": "/api/v1/reports/runs/run_uuid/outputs/pdf",
        "available": true,
        "expires_at": null
      },
      {
        "format": "xlsx",
        "download_url": "/api/v1/reports/runs/run_uuid/outputs/xlsx",
        "available": false,
        "expires_at": null
      }
    ]
  }
}
```

`download_url` is always the relative API path. The frontend resolves it against the API base. Signed/short-lived URLs are deferred; see Section 10.

Safe errors:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Missing/invalid `runId`. |
| 401 | `unauthorized` | App authentication failed. |
| 404 | `report_run_not_found` | Run does not exist OR is not visible to the requester. Identical body for both cases. |
| 429 | `rate_limited` | Detail bucket exceeded. |

Audit event: `report.run.read`. Metadata: `run_id`, `organization_id`, optional `client_id`/`location_id`, outcome.

Rate-limit bucket: shared `report_list` bucket.

### 3.3 `GET /api/v1/reports/runs/:runId/outputs/:format`

Stream the durable output bytes for a specific output format.

Auth and membership:

- Same visibility as Section 3.2. Requester must be able to see the parent run.
- The run's output must have `status: succeeded` AND `storage_provider != null` AND `storage_key != null` AND not be expired.
- If the output is not yet stored (legacy runs from the current synchronous route that returned base64 only and never wrote to storage), respond `409 output_not_available`.

Path parameters:

- `runId`: required.
- `format`: one of `pdf`, `xlsx`. No other formats are accepted in S2-20 scope.

Response on success:

- HTTP `200`.
- `Content-Type` set from output `content_type` (`application/pdf` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
- `Content-Disposition: attachment; filename="<sanitized filename>"` where filename comes from output metadata, never from user-controllable strings. Filename must match `^[A-Za-z0-9._-]+$` after sanitization.
- `Content-Length` set from output `size`.
- Optional `X-Content-Type-Options: nosniff`.
- Body: streamed bytes from the storage adapter.

Streaming policy:

- Bytes never round-trip through MongoDB.
- Bytes never round-trip through base64 for the wire response of this endpoint. The base64 inline behavior of `POST /api/v1/reports/dashboard-snapshot` is preserved for that route only.
- Storage adapter abstraction (Section 4) returns a readable stream and the route pipes it directly to the response.

Safe errors:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Missing/invalid `runId` or `format`. |
| 401 | `unauthorized` | App authentication failed. |
| 404 | `report_run_not_found` | Run does not exist or is not visible to the requester. |
| 404 | `report_output_not_found` | Run is visible but it never requested `format`. |
| 409 | `output_not_available` | Format was requested but storage is not durable yet, or output failed, or it has expired. |
| 415 | `unsupported_format` | Reserved code for future formats; not used until new formats are added. |
| 429 | `rate_limited` | Download bucket exceeded. |

Audit event: `report.output.download`. Metadata: `run_id`, `organization_id`, optional `client_id`/`location_id`, `format`, `size`, `storage_provider`, outcome. Bytes are not logged.

Rate-limit bucket: dedicated `report_download` bucket, separate from listing, keyed by `req.user.user_id` + `organization_id`. Defaults at design time: `RATE_LIMIT_REPORT_DOWNLOAD_MAX` (suggested ~60 per window).

### 3.4 Optional Future `POST /api/v1/reports/runs/:runId/regenerate`

Re-run a known report run definition. **Not in S2-20 implementation scope** and not implementable until durable storage and a queue boundary exist.

Sketched contract for forward consistency only:

- Auth: `owner` or `admin` for the run's organization; manager only when the run's `client_id` and `location_id` are in the requester's assignment lists.
- Body: optional `requested_formats` override; optional new `date_range` override within the original report definition policy.
- Behavior: create a **new** `report_runs` record sharing `report_id` / `report_key` / scope with the source run. Source run is never mutated. Response returns the new run id.
- Synchronous fallback: while the queue does not exist, regenerate may either be unavailable (`501 not_implemented`) or run synchronously bounded by the same caps as the current snapshot route, never replacing the original run.
- Audit event: `report.run.regenerate.queued` / `report.run.regenerate.succeeded` / `report.run.regenerate.failed`.

Documentation only. No work begins on regenerate before durable storage and a queue boundary are accepted in a later task.

### 3.5 Pagination

- Default: cursor-based, `next_cursor` opaque to the client. Implementation may use `created_at + id` as the underlying key. `next_cursor` is `null` when there are no more rows.
- Offset is a fallback only and capped at `1000` to avoid expensive deep scans.
- `limit` default `25`, max `100`. Servers must reject `limit > 100` with `bad_request`.
- Sort order is server-controlled. Default `created_at_desc` because history UIs are most recent first.

### 3.6 Rate-Limit Buckets

Existing rate-limit middleware (`apps/api/src/middleware/rateLimit.js`) buckets generation, OAuth, upload, sync, mutation, etc. Report history endpoints introduce:

- `report_list`: applied to `GET /reports/runs` and `GET /reports/runs/:runId`. Keyed by `req.user.user_id` + `organization_id`. Default suggested cap: `RATE_LIMIT_REPORT_LIST_MAX = 120`.
- `report_download`: applied to `GET /reports/runs/:runId/outputs/:format`. Keyed by `req.user.user_id` + `organization_id`. Default suggested cap: `RATE_LIMIT_REPORT_DOWNLOAD_MAX = 60`.

The existing in-memory per-process limiter (Phase 0 baseline) is acceptable for the initial implementation. Redis-backed distributed rate limiting is still a separate hardening follow-up; it must precede multi-API-instance deployment but is not required by S2-20 design.

## 4. Storage Contract

### 4.1 Storage Provider Abstraction

A new pure backend module (future task) at `apps/api/src/services/reportStorage.js` will expose a small adapter interface:

```js
interface ReportStorageAdapter {
  provider: "local" | "s3" | "gcs" | string;
  writeOutput({ run_id, format, content_type, filename, buffer }): Promise<{
    storage_provider, storage_key, size, checksum
  }>;
  readOutputStream({ storage_provider, storage_key }): Promise<ReadableStream>;
  statOutput({ storage_provider, storage_key }): Promise<{ exists, size }>;
  deleteOutput({ storage_provider, storage_key }): Promise<{ deleted: boolean }>;
}
```

The local development adapter writes to a configurable directory outside the repository working tree (for example `${APP_DATA_DIR}/report-outputs/` or platform-equivalent). The path is read from an environment variable (e.g. `REPORT_STORAGE_LOCAL_DIR`) and never returned to clients.

Cloud adapters (S3, GCS, Azure Blob) implement the same interface and store credentials separately from the storage key. Storage credentials must never appear in `report_runs` documents or API responses.

### 4.2 Storage Key Naming Convention

Storage keys are server-controlled and opaque to clients. Recommended canonical form:

```
report-outputs/<organization_id>/<YYYY>/<MM>/<run_id>.<format>
```

Rules:

- `organization_id` and `run_id` are URL-safe identifier strings. Mongo `_id` is never used.
- Date partition uses the run's `created_at` UTC year/month for predictable bucket sizing.
- `format` is the lowercase extension (`pdf`, `xlsx`). The extension is informational only; the canonical MIME type lives in `content_type`.
- Storage keys are not exposed to clients in API responses, in audit logs, or in proof docs.
- Storage keys must not embed user-controllable strings (no `report_name`/`report_key` segments) to avoid path traversal or filesystem injection.

### 4.3 Output Metadata Fields

`report_runs.outputs[]` documents the existing minimum from S2-04 and adds the following durable-storage fields:

| Field | Type | Notes |
| --- | --- | --- |
| `format` | string | `pdf` or `xlsx`. |
| `status` | string | `pending`, `running`, `succeeded`, `failed`. |
| `size` | integer or null | Bytes. |
| `content_type` | string or null | Canonical MIME type; never read from user input. |
| `filename` | string or null | Sanitized download filename. |
| `storage_provider` | string or null | Adapter id; `null` until written. |
| `storage_key` | string or null | Opaque adapter key; never exposed to clients. |
| `checksum` | object or null | `{ algorithm: "sha256", value: "..." }`. Computed at write time. Optional for the first implementation but encouraged because it makes integrity checks and cross-environment de-duplication cheap. |
| `generated_at` | date or null | Set when bytes were written successfully. |
| `expires_at` | date or null | Reserved for future signed/short-lived links; always `null` until that feature lands. |
| `error` | object or null | Compact `{ code, message }`. |
| `path` | always `null` | Existing legacy field, **kept null** so we never expose raw absolute server paths to clients. |

Forbidden fields anywhere on `report_runs.outputs[]`:

- raw absolute server paths
- signed URLs persisted in Mongo (signed URLs, when introduced, are computed per request and not stored)
- adapter credentials
- raw PDF/XLSX buffers
- base64-encoded buffers
- raw `input_snapshot` body (already excluded by S2-04)

### 4.4 Storage Decisions, Plain English

- **Bytes do not live in Mongo.** S2-04 already forbids storing buffers; durable storage uses files on the local filesystem or a cloud bucket.
- **Clients never see absolute server paths or storage keys.** The download endpoint resolves the storage key server-side from the run document and streams bytes.
- **Provider identity is recorded with each output**, so a cluster that migrates from local disk to cloud storage can serve historical local outputs until they are migrated or retired.
- **The synchronous `POST /reports/dashboard-snapshot` route is allowed to write durable bytes** as part of the future implementation. Doing so does not require a queue. The base64 inline response can remain in place so existing frontend wiring keeps working.

## 5. Report Run Lifecycle

The run status vocabulary stays as in S2-01/S2-04:

- `pending`: row created, not yet generating.
- `running`: generation has started.
- `succeeded`: every requested output has output-level `status: succeeded`.
- `failed`: any requested output has output-level `status: failed`.

Output-level lifecycle additions:

- `succeeded` requires both `status: succeeded` and `storage_provider != null` once durable storage is implemented. Until storage is implemented, output-level `succeeded` may exist with `storage_provider: null`; such outputs are visible in history but are not downloadable and the download endpoint returns `409 output_not_available`.
- `failed` carries a compact `error.code` / `error.message`.

Partial output failure behavior:

- The run-level status remains `failed` if **any** requested output fails. This preserves the S2-05 contract.
- Successful outputs are still recorded in the run document with their durable metadata so they can be downloaded individually if storage is in place.
- The download endpoint serves only outputs whose own status is `succeeded` and whose storage is available.

Regenerate strategy (future):

- Regenerate creates a new run document; the source run is read-only.
- The original storage objects are not deleted by regenerate.

Retention policy (future, not implemented in S2-20):

- `report_runs.retention_policy` may be added as a future field with values such as `keep_forever`, `keep_days_30`, `keep_days_90`. Defaults to `keep_forever` for the initial implementation so retention does not silently delete historical runs.
- Output bytes follow the run's retention policy. A future scheduler task could delete expired storage objects and set `available: false` on outputs.
- No retention enforcement runs as part of S2-20.

## 6. Authorization And Tenancy

Authorization sources:

- `organization_members` is the only source of workspace authorization. JWT `role` is treated as informational and is never trusted for workspace authorization.
- `location_org_map` and `locations.org_id` remain legacy compatibility only. They are not authorization sources.

Scope rules:

- Every `report_runs` row already has `organization_id`. The list and detail endpoints filter by `organization_id` and reject requests without explicit `organization_id`.
- `client_id` and `location_id` filters are optional. When supplied, canonical ownership is loaded server-side:
  - `client_id` must belong to the requested `organization_id`.
  - `location_id` must have canonical scope matching `organization_id` and, if `client_id` is supplied, `client_id` too.
- Client-sent identifiers are treated as request hints; canonical scope is loaded from the location/client documents.

Role visibility for read-only history endpoints:

| Role | List / Detail | Download |
| --- | --- | --- |
| `owner` | All runs in the organization. | All outputs in the organization. |
| `admin` | All runs in the organization. | All outputs in the organization. |
| `manager` | Runs whose `client_id`/`location_id` are in the manager's assignments; organization-level runs (no `client_id`/`location_id`) only when the manager has organization-level scope. | Same filter as list/detail. |
| `viewer` | Same filter as `manager`, read-only. | Same filter as `manager`. |
| `member` | Deny by default. | Deny. |
| `invited` / `disabled` / missing | Deny. | Deny. |

**Justification for denying `member` from history**:

- Sprint 2 implemented `member` as a generic non-management seat and the existing read-only member listing already denies `member` from reading the sanitized member list (see S2-12 contract). Mirroring the same denial here keeps the role surface coherent. `member` can still consume the live GBP dashboard subject to the existing owned-location guard.
- Granting `member` access to historical runs would expose dashboard snapshots beyond the live UI scope without first defining a per-member assignment story. A future task may introduce a `viewer`-like permission for read-only history if product demand is verified.
- The denial mirrors `last_owner_required` and `organization_role_required` codes already used elsewhere and avoids creating new role semantics inside S2-20.

Imported Google location and shared-access rules (unchanged):

- Imported Google locations are not auto-bound to organizations or clients in any history operation.
- The existing owned-location guard still runs before any membership check for GBP location-bound paths. History endpoints do not loosen that guard; they only authorize against `report_runs` rows that already passed those checks at run-creation time.

## 7. Frontend UX Contract

A minimal authenticated page is the target deliverable on the frontend side.

Recommended page route: `/reports/history`.

Navigation entry: a new `Reports` (or `Report history`) nav item in the existing `AppShell`, visible to roles allowed by Section 6. The current GBP dashboard remains the entry point for generating new reports.

Table columns (read-only):

| Column | Source | Notes |
| --- | --- | --- |
| Created | `created_at` | ISO formatted for the user's locale; relative ("3 days ago") tooltip optional. |
| Report name | `report_name` | Truncated with hover. |
| Type | `report_type` | Plain text. |
| Scope | `organization_id` / `client_id` / `location_id` | Show resolved labels via existing client/location lookups; **never** show emails or raw user records. |
| Date range | `filters.date_range.start..end` | UTC dates. |
| Formats | `outputs[].format` | Badge per format. |
| Status | run-level `status` | Status badges, see below. |
| Requested by | `requested_by_user_id` | Show display name from existing org membership lookups when available; otherwise show `User <short-id>`. Never show email. |
| Actions | per-output `download` buttons | Disabled when `available: false`. |

Filters (above the table):

- Organization picker (uses the existing org selector).
- Optional client picker (scoped to the selected org).
- Optional location picker (scoped to the selected org/client).
- Optional report type dropdown.
- Optional status dropdown.
- Optional date range picker bounded to 366 days, defaulting to "last 30 days".

Status badges:

- `pending`: neutral.
- `running`: neutral.
- `succeeded`: success.
- `failed`: danger.
- Output-level `available: false`: shown as a small "Unavailable" badge on the per-format download button.

Download buttons:

- Trigger a direct fetch against `GET /api/v1/reports/runs/:runId/outputs/:format` through the existing `api()` client.
- The frontend never reconstructs storage URLs and never reads `storage_key`.
- The browser downloads the streamed bytes using the response `Content-Disposition` filename. The frontend must not override the filename from user-controlled state.
- On `409 output_not_available`, the button surfaces a tooltip ("Output not yet available") without retrying.

Empty / error / loading states:

- Loading: existing spinner pattern.
- Empty: friendly empty state explaining filters and pointing back to the GBP dashboard.
- Error: render backend `error.code` / `error.message` verbatim through the existing `formatErrorEnvelope` helper used by the member UI. Network/timeout errors render a generic copy.
- Reauth behavior: a `401 unauthorized` clears app auth and redirects to login. A provider reauth banner (Google) must not clear app auth unless app auth itself is invalid. This preserves the S1 stale-state and Phase 0 reauth rules.

Display safety:

- Emails are not displayed in any column or detail panel.
- Raw `input_snapshot` is not displayed; only `input_snapshot_summary` counts are surfaced.
- Storage keys, absolute paths, bucket names, and tokens are never displayed.

Tests:

- Pure-helper unit tests for filter parsing, status-badge classification, and error formatting. The existing test framework (Vitest) is used. Component-render tests remain out of scope until a React testing-library is installed in a separate task.

## 8. Migration And Index Impact

S2-20 is documentation only; no migration runs. The implementation tasks should:

- Confirm/extend `report_runs` indexes for listing performance. Existing indexes (S2-04) already include:
  - unique `id`
  - `report_id + created_at`
  - `report_key + created_at`
  - `organization_id + created_at`
  - `client_id + created_at`
  - `location_id + created_at`
  - `status + created_at`
- Add (in an implementation task) a `organization_id + status + created_at` compound to make filtered listings deterministic and avoid relying on the secondary `status + created_at` for organization-scoped filters.
- Add (in an implementation task) `organization_id + client_id + created_at` and `organization_id + location_id + created_at` compound indexes to back the scoped filters used by listing.
- Keep `id` unique on `report_runs` so the detail and download routes can resolve a run by id without scanning.

No migration is required to introduce the new output metadata fields. They are additive on documents created after the implementation lands. Pre-existing `report_runs` rows produced by the current synchronous route remain valid; their outputs simply report `storage_provider: null`, `available: false`, and download attempts return `409 output_not_available`.

## 9. Queue / Worker Boundary

S2-20 design does not implement a queue. The synchronous report route (S2-05) and any future durable-storage write should remain on the API runtime initially. The API, worker, and scheduler runtimes remain three separate process roles per `docs/runtime/processes.md`.

Future work order:

1. **Storage adapter** (suggested task `S2-22`) introduces a durable local-filesystem adapter behind `ReportStorageAdapter` and writes outputs synchronously inside the existing report route. No queue. No frontend change.
2. **Listing API** (suggested task `S2-23`) implements `GET /reports/runs` and `GET /reports/runs/:runId`.
3. **Download API** (suggested task `S2-24`) implements `GET /reports/runs/:runId/outputs/:format`.
4. **Frontend history page** (suggested task `S2-25`) wires the above into a minimal `/reports/history` page through the existing API client.
5. **`report-generate` queue + dedicated report worker** (later, only after storage and listing accept and only when there is a real long-running need). When added, the queue lives in `apps/api/src/queues/`, the worker registers in `apps/api/src/workers/index.js`, and the scheduler does not change. The queue must not bypass any of the authorization rules above.

The S2-20 contract explicitly forbids implementing the queue before storage and listing are accepted. This keeps Phase 0 runtime separation safe and avoids building a worker around a still-undefined storage contract.

## 10. Security

- **No raw snapshots in responses.** `input_snapshot` is never returned over the wire; only `input_snapshot_summary` is.
- **No absolute paths in responses.** `storage_key` and any raw filesystem path stay server-side.
- **Signed / short-lived download links are optional future work.** The first cut uses the authenticated API endpoint directly. A signed-URL adapter can later return time-bounded `download_url` strings with `expires_at` set. Until then, `expires_at` is `null`.
- **Audit report downloads.** `report.output.download` is logged best-effort with compact metadata only.
- **Size caps.** The download endpoint enforces the existing per-output byte cap. The list endpoint caps `limit` at `100`. Total list response size is naturally bounded by the cap on row content.
- **Content-type enforcement.** `Content-Type` is read from the run's `outputs[].content_type`, not from query parameters and not from the storage object. Filenames are sanitized server-side.
- **No `_id` leakage.** Sanitized output uses only `id`.
- **No emails.** Member emails are not surfaced in run rows, detail panels, audit events, or proof docs.
- **No tokens or provider payloads.** OAuth/JWT/encrypted secret payloads are never written into run rows, output rows, or audit metadata.
- **Path traversal protection.** Storage keys are derived from sanitized `organization_id` and `run_id` only. The local adapter rejects keys that resolve outside `REPORT_STORAGE_LOCAL_DIR`.
- **CORS / auth headers.** No change to existing CORS or app JWT middleware. Cross-origin storage hosts (when cloud adapters land) must not be added to `CORS_ORIGINS`.

## 11. Recommended Implementation Sequence

Conservative, phase-aware sequencing. Phase 2 work remains blocked.

- **S2-20.1 (optional)**: Index design proof if the implementation team wants to lock the compound `organization_id + status + created_at`, `organization_id + client_id + created_at`, and `organization_id + location_id + created_at` indexes before any route work. Docs/proof only.
- **S2-22**: Durable local storage adapter. Pure backend module + `ensureIndexes` confirmation + tests. Wires the synchronous route to write durable bytes alongside the existing base64 inline response. No new route, no frontend change, no queue.
- **S2-23**: Read-only `GET /api/v1/reports/runs` listing API. Auth/membership rules per Section 6. Includes filters, pagination, sanitized rows, audit logging, and rate limiting. No mutations.
- **S2-24**: Read-only `GET /api/v1/reports/runs/:runId` detail + `GET /api/v1/reports/runs/:runId/outputs/:format` download. Streams bytes from the storage adapter; never serves base64; never leaks storage keys.
- **S2-25**: Minimal authenticated `/reports/history` frontend page wired through the existing `api()` client; pure-helper unit tests only. No React component-render tests until a testing-library is installed in a separate task.
- **S2-26 (optional)**: `report-generate` queue and dedicated report worker — only after storage/listing/download/UI are accepted and only when long-running generation actually exists. Must keep API, worker, scheduler separate.
- **Phase 2 provider adapter layer**: still blocked. Any future Phase 2 work begins with a provider adapter contract task that does not change current GBP behavior.

## 12. Explicit Non-Goals

S2-20 design and the immediate implementation follow-ups do **not** include:

- Phase 2 integrations or any new provider channel.
- Dashboard builder behavior.
- AI / premium feature layer.
- Multi-channel metrics.
- Billing or entitlements.
- Email delivery, scheduled/recurring reports, public sharing, signed-URL adapters.
- Cross-organization report search.
- Provider auth or JWT/auth middleware changes.
- Frontend code edits (S2-20 is docs only; the implementation comes in S2-25).
- Backend code edits, new routes, new services, new dependencies (S2-20 is docs only; implementation comes in S2-22/S2-23/S2-24).
- Worker, scheduler, or destructive script execution.
- Removing or modifying current GBP dashboard exports, the synchronous report route, or its base64 response shape.
- Loosening of `organization_members`-based authorization, `location_org_map` canonicality, or owned-location guards.
- Printing or recording JWTs, OAuth tokens, refresh tokens, ID tokens, auth codes, authorization headers, encrypted secrets, raw provider payloads, raw user records, passwords, or emails.
