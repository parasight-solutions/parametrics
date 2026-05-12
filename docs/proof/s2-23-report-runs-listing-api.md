# S2-23 Report Run Listing API Proof Pack

Date: 2026-05-12

## 1. Scope And Decision

S2-23 implements the read-only `GET /api/v1/reports/runs` endpoint designed in S2-20 Section 3.1. It returns sanitized `report_runs` rows (including the durable storage metadata persisted in S2-22) for an organization, with filter, sort, and pagination support. The synchronous `POST /api/v1/reports/dashboard-snapshot` route, the durable local storage adapter, PDF/XLSX generation, and the persisted output shape are unchanged. Detail (`GET /api/v1/reports/runs/:runId`), output download (`GET /api/v1/reports/runs/:runId/outputs/:format`), and optional regenerate routes remain future work. There is no frontend change.

Phase 2 integrations remain blocked. No new dependencies were added; `package-lock.json` is unchanged.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pass.

## 2. Files Changed

- `apps/api/src/routes/reports.js` — added `GET /api/v1/reports/runs` route, the exported `listReportRunsForUser` helper, and `parseListLimit` / `listFilterFromQuery` / `assertManagerOrViewerListScope` utilities. Imported `listReportRuns`, `REPORT_LIST_DEFAULT_LIMIT`, `REPORT_LIST_MAX_LIMIT` from `reportStore.js` and `requireOrganizationMembership` / `isMembershipAssignedToLocation` from `organizationAccess.js`. Added `invalid_report_run_status` and `invalid_report_run_limit` to `mapValidationError`.
- `apps/api/src/routes/reports.test.js` — added 11 focused tests for the listing route: missing org, missing membership, role denial for `member`/`invited`/`disabled`, owner/admin allow, manager/viewer allow with assigned scope, manager deny without scope, manager deny with mismatched scope, query-pass-through, non-positive limit, store-side error surfacing as 400, response shape sanitization.
- `apps/api/src/services/reportStore.js` — added `listReportRuns`, `buildReportRunListQuery`, `sanitizeReportRunRow`, `REPORT_LIST_DEFAULT_LIMIT`, `REPORT_LIST_MAX_LIMIT`. Added local-only helpers `parseYmdStart` / `parseYmdEnd` / `clampLimit` / `sanitizeOutputForList` / `fetchReportRunListDocs` / `normalizeListStatus` / `normalizeListFormat`. No change to the existing `buildReportRunDoc`, `savePendingReportRun`, `markReportRunRunning`, `markReportRunSucceeded`, `markReportRunFailed`, or `normalizeOutputs` behavior.
- `apps/api/src/services/reportStore.test.js` — added 11 focused tests for `listReportRuns`, `buildReportRunListQuery`, and `sanitizeReportRunRow`; extended the in-memory test collection with `find(query, options).toArray()` support that honors `sort`, `limit`, and `projection`.
- `docs/architecture/report-history-and-storage.md` — added a "S2-23 Implementation Note" section.
- `docs/architecture/report-service.md` — added a "S2-23 Report Run Listing API" section.
- `docs/codex/sprint-2-phase-1-guardrails.md` — added S2-23 to the completed Sprint 2 task list and a detailed completion paragraph; Phase 2 remains blocked.
- `docs/proof/s2-23-report-runs-listing-api.md` — this proof doc (new).

No frontend files changed. No `apps/api/package.json` change required; the new test files are already part of the focused `npm test` matrix. `package-lock.json` is unchanged.

## 3. Endpoint Contract

`GET /api/v1/reports/runs` (authenticated; mounted under the existing `/api/v1/reports` router).

Query parameters (all optional except `organization_id`):

| Param | Default | Notes |
| --- | --- | --- |
| `organization_id` | — | Required. Treated as a request hint and re-verified against `organization_members`. |
| `client_id` | — | Optional. Filters `report_runs.client_id` exactly. |
| `location_id` | — | Optional. Filters `report_runs.location_id` exactly. |
| `report_type` | — | Optional. Filters `report_runs.report_type` exactly. |
| `report_key` | — | Optional. Filters `report_runs.report_key` exactly. |
| `status` | — | Optional. One of `pending`, `running`, `succeeded`, `failed`. |
| `date_from` | — | Optional. `YYYY-MM-DD`. Filters `created_at >= start-of-day(date_from)` UTC. |
| `date_to` | — | Optional. `YYYY-MM-DD`. Filters `created_at <= end-of-day(date_to)` UTC. |
| `limit` | `25` | Bounded to `[1, 100]`. |

Sort is server-controlled (`created_at` descending with `id` tiebreaker). Client-supplied sort is not accepted in S2-23.

Pagination is `{ limit, has_more, next_cursor }`. `next_cursor` is reserved for a future cursor implementation (S2-20 Section 3.5) and is always `null` today. `has_more` is computed by fetching `limit + 1` documents server-side and reporting whether the extra row was present.

Success response:

```json
{
  "report_runs": [
    {
      "id": "...",
      "report_id": null,
      "report_key": "...",
      "report_type": "dashboard_snapshot",
      "report_name": "...",
      "status": "succeeded",
      "requested_formats": ["pdf", "xlsx"],
      "outputs": [
        {
          "format": "pdf",
          "status": "succeeded",
          "size": 123,
          "path": null,
          "storage_provider": "local",
          "storage_key": "report-outputs/<org>/<YYYY>/<MM>/<run_id>.pdf",
          "content_type": "application/pdf",
          "filename": "<sanitized>.pdf",
          "checksum": { "algorithm": "sha256", "value": "..." },
          "generated_at": "2026-05-11T00:00:00.000Z",
          "expires_at": null,
          "error": null,
          "created_at": "...",
          "updated_at": "...",
          "completed_at": "..."
        }
      ],
      "organization_id": "...",
      "client_id": null,
      "location_id": null,
      "requested_by_user_id": "...",
      "input_snapshot_summary": {},
      "filters": {},
      "created_at": "...",
      "updated_at": "...",
      "started_at": "...",
      "completed_at": "...",
      "error": null
    }
  ],
  "pagination": { "limit": 25, "has_more": false, "next_cursor": null }
}
```

Safe error codes:

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | Missing `organization_id`; non-positive or malformed `limit`. |
| 400 | `invalid_date_range` | Malformed `date_from` / `date_to` or inverted range. |
| 400 | `invalid_report_run_status` | `status` not in `pending|running|succeeded|failed`. |
| 400 | `invalid_report_run_limit` | Service-layer limit guard tripped after the route accepted the value. |
| 401 | `unauthorized` | Missing/invalid JWT (existing middleware). |
| 403 | `organization_membership_required` | No active membership in the requested organization. |
| 403 | `organization_role_required` | Active membership but role not in `owner|admin|manager|viewer`. |
| 403 | `organization_scope_required` | `manager`/`viewer` without a `client_id`/`location_id` filter that matches their assignment lists. |

## 4. Authorization Behavior

- Requires app authentication (existing `authenticate` middleware).
- Resolves an active membership via `requireOrganizationMembership({ organizationId, userId })`. JWT `role` claim is not used. `location_org_map` is not used.
- `owner` and `admin`: allowed to list all `report_runs` in the requested organization regardless of whether `client_id`/`location_id` filters are supplied. Optional filters are passed through to the store.
- `manager` and `viewer`: must supply at least one of `client_id` or `location_id`. The supplied value(s) must be in the requester's `assigned_client_ids` / `assigned_location_ids`. Missing scope ⇒ `403 organization_scope_required`. Mismatched scope ⇒ `403 organization_scope_required`. This matches the S2-20 contract Section 6 ("manager: see runs whose `client_id`/`location_id` are in the manager's assignments"). Viewer is allowed read-only access on the same rules.
- `member`, `invited`, `disabled`, and any other role ⇒ `403 organization_role_required` (or `403 organization_membership_required` when `requireOrganizationMembership` rejects up front because the membership status is not `active`).
- No Google provider auth, OAuth refresh, or `location_org_map` lookup happens on this path.
- The route enforces canonical organization scope by requiring `organization_id` in the query and re-resolving membership against that organization. Canonical client/location scope is enforced via the manager/viewer assignment check; `report_runs` rows are already keyed by canonical `organization_id`/`client_id`/`location_id` from the existing synchronous write path.

## 5. Query / Filter Behavior

Implemented in `buildReportRunListQuery(filter)`:

- `organization_id`: trimmed and required (`missing_report_scope` thrown otherwise).
- `client_id` / `location_id`: trimmed; empty strings drop the filter.
- `status`: lowercased and validated against `REPORT_STATUSES`; `invalid_report_run_status` thrown for unknown values.
- `report_type` / `report_key`: trimmed string filters; case-sensitive exact match (matching the persisted document's existing case).
- `date_from`: must match `YYYY-MM-DD`; parsed as `T00:00:00.000Z`. `invalid_date_range` thrown for malformed input.
- `date_to`: must match `YYYY-MM-DD`; parsed as `T23:59:59.999Z` so the entire day is included.
- `date_from > date_to` is rejected with `invalid_date_range`.

`listReportRuns(filter, options)` then runs the Mongo `find(query, { sort, limit: limit + 1, projection: { _id: 0, input_snapshot: 0 } })` cursor, computes `has_more`, slices to `limit`, sanitizes each row through `sanitizeReportRunRow`, and returns `{ runs, pagination }`. The `find`/`toArray` shape is compatible with the production `mongodb` driver and with the focused in-memory collection used by the test suite (the test collection now supports `find(query, options).toArray()` with `sort`, `limit`, and `projection`).

Sort is hardcoded to `{ created_at: -1, id: -1 }` so two runs with the same timestamp are still ordered deterministically.

`limit` is clamped at the route layer (`parseListLimit`) and again at the service layer (`clampLimit`). The default is `25`; max is `100`. Non-positive or non-numeric values fail with `bad_request` (route) or `invalid_report_run_limit` (service); values exceeding `100` are clamped to `100`.

## 6. Sanitization Behavior

`sanitizeReportRunRow(doc)` returns an explicit shape:

- Top-level row fields: `id`, `report_id`, `report_key`, `report_type`, `report_name`, `status`, `requested_formats`, `outputs`, `input_snapshot_summary`, `filters`, `organization_id`, `client_id`, `location_id`, `requested_by_user_id`, `created_at`, `updated_at`, `started_at`, `completed_at`, `error`.
- Per-output fields: `format`, `status`, `size`, `path`, `storage_provider`, `storage_key`, `content_type`, `filename`, `checksum`, `generated_at`, `expires_at`, `error`, `created_at`, `updated_at`, `completed_at`.
- `requested_formats` is filtered to known formats (`pdf`, `xlsx`); unknown formats are dropped.
- `input_snapshot_summary` and `filters` are passed through `sanitizeReportMetadata` (the same helper used by persistence) to cap depth and redact secret-like keys.
- `error` and per-output `error` use the existing `compactError` helper (`{ code, message }`).

Defensive omissions verified by tests:

- Mongo `_id` is not present in any returned row (also dropped at the Mongo `find` projection layer).
- Raw `input_snapshot` body is not present (also dropped at the projection layer; persistence already excludes it from saved documents per S2-04).
- Per-output `buffer` and `base64` fields are not present.
- No absolute server path is exposed; `path` remains `null` (the existing legacy field), and `storage_key` is the relative key set by the storage adapter, which never embeds absolute paths.

`storage_key` is intentionally included because the S2-20 contract Section 4.3 classifies it as durable metadata. No download endpoint exists yet, so possession of a `storage_key` cannot be used to fetch bytes.

## 7. Tests / Build / Checks

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

Results:

- `node --check` of each changed file: OK.
- `cd apps/api && npm test`: `1..157 # tests 157 # pass 157 # fail 0 # skipped 0`. Coverage includes:
  - 11 new tests in `apps/api/src/services/reportStore.test.js` (organization_id required; bad status; inverted date range; non-positive limit; org scoping + sort newest first; status/client/location/key/type/date filters; limit + has_more + clamp; sanitization of `_id`/`input_snapshot`/per-output absolute paths; `buildReportRunListQuery` direct guards; `sanitizeReportRunRow` defensive shape).
  - 11 new tests in `apps/api/src/routes/reports.test.js` (missing org; missing membership; member/invited/disabled denial; owner/admin allow; manager allow with assigned scope; viewer allow with assigned scope; manager deny without scope; manager deny outside assignments; query-pass-through; non-positive limit; store error surfacing as 400; response shape).
  - All previously verified tests still pass.
- `cd apps/web && npm test -- --run`: `Test Files 4 passed (4) / Tests 21 passed (21)`.
- `cd apps/web && npm run build`: `286 modules transformed. ✓ built in ~30s`. Pre-existing Browserslist data-age warning unchanged.
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
- `?? docs/proof/s2-23-report-runs-listing-api.md`

No backend, frontend, or storage adapter behavior changed outside the listing route and its helpers. No new dependency installed.

## 8. Frontend Changes

No. No file under `apps/web/src` or `apps/web/package.json` was modified.

## 9. Package-Lock Changed

No.

## 10. Remaining Risks

- Cursor pagination is reserved (`next_cursor: null`) but not implemented yet. Clients that walk past `limit` rows must rely on filters (e.g., narrowing `date_to`) until S2-23.1 / S2-24 introduces opaque cursors. A 100-row hard cap keeps response size bounded in the meantime.
- No live local API smoke yet. Unit tests cover the route, service, sanitization, role/scope rules, and pagination. A focused live smoke against the existing `s2-15-fixture-org` / `s2-15-user-owner` scope (re-using the S2-22.1 storage smoke methodology) is a recommended follow-up before relying on listing data in any deployed environment.
- The role/scope check denies `manager` and `viewer` from listing org-level runs (no `client_id`/`location_id`) because they must supply a matching scope. S2-20 Section 6 carves out "organization-level runs visible to manager only when the manager has organization-level scope" as a future refinement; the current cut keeps the deny-by-default convention until an explicit org-level-scope membership concept exists. Owner/admin can always list org-level runs.
- No dedicated `report.run.list` audit event and no dedicated `report_list` rate-limit bucket in this first cut. The route reuses the existing app authentication middleware and the existing `GET /orgs/:orgId/members` convention (no audit, no rate-limit). Both items remain documented as optional hardening in the S2-20 contract.
- `storage_key` is exposed in list rows because S2-20 Section 4.3 classifies it as durable metadata. Until the download route exists, the key is non-actionable; once the download route lands, it must continue to enforce `organization_members`-based authorization (the listing route already filters rows by the requester's allowed scope, so a `storage_key` returned by the list is one that the caller has reading rights for).
- `date_from`/`date_to` use UTC day boundaries because `report_runs.created_at` is stored in UTC by `buildReportRunDoc`. Clients sending local-time semantics may see off-by-one-day surprises; this matches existing date-range behavior in the report service and is documented in the S2-20 contract.
- Pre-existing Browserslist build warning is unchanged.

## 11. Ready For GPT Verification

Yes. Working tree contains only the S2-23 backend listing route, the new service helpers, focused tests for both layers, three architecture/guardrails doc updates, and this proof doc. No frontend source, web package, or lockfile diff. No API/worker/scheduler service was started. No destructive scripts ran. All API tests, web tests, and the web build pass. `git diff --check` is clean and `git diff --name-only -- apps/web/src apps/web/package.json package-lock.json` is empty.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-23 report runs listing API was verified after route/store tests, API npm test, web tests, web build, no-frontend-diff checks, no-lockfile-diff checks, sanitization review, and diff checks.
