# S2-25 Report History UI Proof Pack

Date: 2026-05-16

## 1. Scope And Decision

S2-25 adds a minimal authenticated `/reports/history` frontend page that wires the existing read-only listing and download endpoints designed in S2-20 Section 3 and implemented in S2-23 and S2-24. It uses the existing authenticated `api()` client for the JSON listing call and a small purpose-built fetch helper for the raw-bytes download call (the shared `api()` client only parses JSON envelopes). The synchronous `POST /api/v1/reports/dashboard-snapshot` route, the durable local storage adapter, the S2-23 listing route, and the S2-24 download route are unchanged.

No backend or test code was changed. No dependencies were installed. `package-lock.json` is unchanged. Phase 2 integrations remain blocked.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pass.

## 2. Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/s2-23-report-runs-listing-api.md`
- `docs/proof/s2-23-1-report-runs-listing-live-smoke.md`
- `docs/proof/s2-24-report-output-download-api.md`
- `docs/proof/s2-24-1-report-output-download-live-smoke.md`
- `docs/architecture/report-history-and-storage.md`
- `docs/architecture/report-service.md`
- `docs/runtime/processes.md`

## 3. Files Changed

- `apps/web/src/App.jsx` — imported `ReportHistory` page and added the authenticated `/reports/history` route. Unauthenticated visits redirect to `/login` like every other authenticated route.
- `apps/web/src/components/AppShell.jsx` — added a `Reports` nav entry pointing at `/reports/history` (placed between `Reviews` and `Members` so it sits with the read-only navigation set).
- `apps/web/src/pages/ReportHistory.jsx` — new minimal report history page (Section 4).
- `apps/web/src/lib/reportHistory.js` — new pure helpers (Section 5).
- `apps/web/src/lib/reportHistory.test.js` — new Vitest helper tests (Section 5).
- `docs/architecture/report-history-and-storage.md` — added an "S2-25 Implementation Note" section.
- `docs/architecture/report-service.md` — added an "S2-25 Report History UI" section.
- `docs/codex/sprint-2-phase-1-guardrails.md` — added S2-25 to the completed task list and a detailed completion paragraph; Phase 2 remains blocked.
- `docs/proof/s2-25-report-history-ui.md` — this proof doc (new).

No `apps/api/src` files, `apps/api/package.json`, `apps/web/package.json`, or `package-lock.json` were changed. No backend route, service, test, or dependency changed.

## 4. Route And Nav

- New SPA route: `GET /reports/history` (React Router) gated by `authed` like the existing authenticated routes. Unauthenticated visits redirect to `/login`.
- New `AppShell` nav item:
  - `label: "Reports"` → `to: "/reports/history"`. Placed between `Reviews` and `Members`. The existing `isActive(to)` highlights it for any path starting with `/reports/history`.
  - The label is `Reports` (not `Report History`) because the existing nav has no other `Reports` item and the page handles report history exclusively for now; the navigation can be split later when a separate "report definitions" page lands.
- The page renders inside the existing `AppShell` with `title: "Report history"`, a one-line subtitle, and the existing `onLogout` wiring. No new layout primitives.

## 5. Helpers (`apps/web/src/lib/reportHistory.js`)

Pure helpers (no DOM dependency) live in `apps/web/src/lib/reportHistory.js` and are unit-tested in `apps/web/src/lib/reportHistory.test.js`:

| Helper | Purpose |
| --- | --- |
| `REPORT_RUN_STATUSES` | Frozen array `["pending","running","succeeded","failed"]` for the status filter dropdown. Matches the backend lifecycle vocabulary from S2-04. |
| `REPORT_RUN_FORMATS` | Frozen array `["pdf","xlsx"]` mirroring the S2-24 `REPORT_DOWNLOAD_FORMATS`. |
| `REPORT_LIST_LIMIT_DEFAULT` / `_MIN` / `_MAX` | `25`, `1`, `100` — mirror the backend `REPORT_LIST_DEFAULT_LIMIT` / `REPORT_LIST_MAX_LIMIT`. |
| `clampReportListLimit(value)` | Floors, bounds to `[1,100]`, returns the default for non-numeric input. |
| `buildReportRunsQuery(params)` | Builds a `?key=value` query string for `GET /api/v1/reports/runs`. Omits empty filters, drops malformed `status` / `date_from` / `date_to`, and clamps `limit`. |
| `parseContentDispositionFilename(header)` | Extracts a filename from a `Content-Disposition` header. Handles quoted, bare, and RFC 5987 `filename*=UTF-8''…` forms. |
| `safeDownloadFilename(name, fallback)` | Returns the candidate only when it matches `^[A-Za-z0-9._-]+$`; otherwise the (similarly validated) fallback; otherwise the generic literal `report.bin`. Mirrors the backend filename allow-list from S2-24. |
| `formatBytes(value)` | Formats byte counts as `B` / `KB` / `MB` / `GB`. Returns `"-"` for invalid input. |
| `normalizeReportRunRow(row)` | Normalizes a backend run row into a UI-safe shape. Always strips `storage_key` from each output (and the row itself), normalizes case for `status` and per-output `format`, exposes `downloadable = status === "succeeded" && storage_provider && storage_key (presence only)`. |
| `describeReportHistoryError(err)` | Formats `code: message` envelopes; tolerates flat or `{error: {...}}` shapes. |
| `listOrganizationsForReports(apiImpl?)` | Thin wrapper for `GET /orgs` (same as the members page). |
| `listReportRunsForUser(params, apiImpl?)` | Builds the query, calls `GET /api/v1/reports/runs`, normalizes rows, returns `{ report_runs, pagination }`. Throws when `organization_id` is missing. |
| `downloadReportOutput({ runId, format, apiBase?, token?, fetchImpl? })` | Resolves the API base from `import.meta.env.VITE_API_BASE_URL` (or accepts an injected value for tests), pulls the bearer token from `getToken()` (or accepts an injected token), `GET`s the raw bytes, validates the response, returns `{ blob, filename, contentType, size }`. The filename comes from the server's `Content-Disposition` through `safeDownloadFilename`; never from user-controlled state. Throws the parsed JSON error envelope on non-2xx responses. |

`downloadReportOutput` intentionally does **not** touch the DOM. The page combines it with the existing `downloadBlob(filename, blob)` helper in `apps/web/src/reportDownloads.js` (which already creates an object URL and triggers a click) to produce the final browser download. That keeps the helper module pure and unit-testable in the existing Vitest (Node) environment without `jsdom`.

Test coverage (`apps/web/src/lib/reportHistory.test.js`, 28 tests):

- Constants are exported with the documented vocabularies.
- `clampReportListLimit` returns the default for non-numeric input, floors, and bounds to `[1,100]`.
- `buildReportRunsQuery` omits empty filters, drops malformed status/date values, and clamps the limit.
- `parseContentDispositionFilename` handles empty input, quoted, bare, and RFC 5987 `filename*=UTF-8''…` forms.
- `safeDownloadFilename` returns the candidate when safe, falls back when the candidate contains unsafe characters (path traversal, spaces, empty), and falls back to `report.bin` when both inputs are unsafe.
- `formatBytes` handles invalid/zero/byte/KB/MB/GB ranges.
- `describeReportHistoryError` formats code+message, falls back to message, handles nested envelopes, and returns `"Unknown error."` for empty input.
- `normalizeReportRunRow` normalizes case (`status`, `format`), drops `storage_key`, exposes `downloadable`, and returns an empty shell for non-object input. A `JSON.stringify` scan confirms the normalized row never contains the literal `"storage_key"`.
- `downloadReportOutput` rejects missing/invalid input, builds the expected URL with the bearer token, parses `Content-Disposition`, returns the blob, uses a safe fallback filename when the server response has no `Content-Disposition`, and throws the parsed JSON error envelope on non-2xx responses (using `vi.fn()` to inject a fake fetch).

## 6. UI Behavior

The `ReportHistory` page renders three stacked panels inside the existing `AppShell`:

1. **Organization panel.** A standard `<select>` for the org the requester belongs to. Source: `listOrganizationsForReports()` → `GET /api/v1/orgs`. The first org is selected by default. Two action buttons: `Refresh orgs` and `Refresh runs`. An `aria-live` error region surfaces `describeReportHistoryError(...)` on failure. A small caption explains that downloads require durable local files and that older `/tmp`-backed smoke files may have been wiped on host reboot (matching the S2-22.1 / S2-24.1 risks).
2. **Filters form.** Six labeled controls in a responsive 3-column grid:
   - `Status` (select, populated from `REPORT_RUN_STATUSES`).
   - `Report type` (free-text input; defaults to empty).
   - `Report key` (free-text input).
   - `Created from` (`<input type="date">`, UTC `YYYY-MM-DD`).
   - `Created to` (`<input type="date">`, UTC `YYYY-MM-DD`).
   - `Limit` (`<input type="number" min="1" max="100">`).
   The form submits with `Apply filters`; a `Reset` button restores the default filters and re-loads. The submit button is disabled until an org is selected. The active-filter chip surfaces only when at least one non-limit filter is set.
3. **Runs panel.** Lists the returned `report_runs`. Each card shows:
   - `report_name` (falling back to `report_key` or `id`), a status badge, and a report-type badge.
   - Short `id` (`abc12345…`) to keep run UUIDs unobtrusive.
   - `report_key`, requested formats, scope summary (`org … · client … · location …`, using short ids), `requested_by_user_id`, `created_at` / `completed_at`.
   - Per-output rows (one per `outputs[]` entry): format badge, output status, `formatBytes(size)`, storage provider, optional output error. Each row carries a `Download <FORMAT>` button when `downloadable` is true, else a disabled `Unavailable` button.
   - Compact inline error region per run when the run carries an `error` envelope.

When the organization has no runs the page shows `No runs to show for this organization.` or `No runs match the current filters.` depending on whether the request returned zero rows or the user has not yet selected an org. A loading indicator (`Loading runs…`) and an `aria-live` status region for the most recent download (success or error message) sit above the list.

Filter loading is single-shot per `Apply filters` click; the page does not auto-refresh on filter input to avoid generating large filter-thrash traffic. Reloading is explicit via `Refresh runs` or by changing the organization selection (which auto-loads the default filter set).

The page intentionally does **not**:

- Show emails or any raw user record.
- Show the persisted `storage_key`, absolute server paths, or any storage credential.
- Render `input_snapshot` body content (the backend listing strips it; the helper additionally drops any field named `storage_key` defensively).
- Expose a clickable URL to a storage object — downloads only flow through the authenticated `GET /api/v1/reports/runs/:runId/outputs/:format` endpoint.

## 7. Download Behavior

Per-output `Download <FORMAT>` button → `downloadReportOutput({ runId, format })` → `downloadBlob(filename, blob)`:

- `downloadReportOutput` reads the bearer token via the existing `getToken()` helper and the API base via `import.meta.env.VITE_API_BASE_URL` (the same source the shared `api()` client uses).
- It calls `GET /api/v1/reports/runs/:runId/outputs/:format` with `Authorization: Bearer <token>`. Path parameters are URL-encoded via `encodeURIComponent`.
- On `2xx`, it reads `Content-Disposition` and `Content-Type`, derives the filename through `safeDownloadFilename(parsedName, "report-<runId>.<format>")`, and resolves the response body into a `Blob`. The page then triggers a browser download via `downloadBlob(filename, blob)` (already imported from `apps/web/src/reportDownloads.js`; this helper creates an object URL, simulates a click, and revokes the URL).
- On non-`2xx`, it attempts to parse the JSON error envelope and throws `{ code, message, status }`. The page surfaces `describeReportHistoryError(err)` in the per-list status region; `403`/`404`/`409`/`500` envelopes display inline without clearing app auth.

The page never:

- Constructs storage URLs from `storage_key`.
- Reads base64 from the listing response (the listing API never returns base64).
- Reads or displays absolute server paths (the listing API never returns them).
- Allows user-controlled filenames; the filename is either the server-provided sanitized `Content-Disposition` value or the safe fallback above.

## 8. Auth And Error Behavior

- The shared `api()` client handles `401 unauthorized` by clearing the session and redirecting to `/login` (existing behavior).
- The download helper preserves this contract: it sends the same bearer token the listing call uses, so a real auth failure during a download surfaces as a `401`/`unauthorized` envelope. The page displays it inline (in the download status region) — it does **not** call `clearAuthSession` itself. If the next interaction with the shared `api()` client also returns `401`, the existing redirect-to-login path runs as usual.
- `403 organization_membership_required`, `403 organization_role_required`, `403 organization_scope_required`, `404 report_run_not_found`, `404 report_output_not_found`, `409 report_output_not_ready`, and `500 report_output_read_failed` / `500 report_output_integrity_failed` all surface inline through `describeReportHistoryError` and do **not** clear app auth, redirect, or interact with the Google reauth flow.
- The Google provider reauth banner in `AppShell` is unchanged. The new download path does not invoke `triggerGoogleReauth`.
- Form labels are explicit (`<label htmlFor="…">` for every control). Status/error regions use `role="status"` and `role="alert"` respectively. Download buttons carry `aria-label="Download <FORMAT> for <report_key|id>"`.

## 9. Tests / Build / Checks

```bash
cd apps/web && npm test -- --run
cd apps/web && npm run build
cd apps/api && npm test
git diff --name-only -- apps/api/src apps/api/package.json package-lock.json
git diff --check
```

Outcomes:

- `cd apps/web && npm test -- --run`: `Test Files 5 passed (5) / Tests 49 passed (49)` (28 new + 21 existing). All 28 new tests live in `apps/web/src/lib/reportHistory.test.js`.
- `cd apps/web && npm run build`: `288 modules transformed. ✓ built in ~26s` (286 → 288 reflects the two new modules). Pre-existing Browserslist data-age warning unchanged.
- `cd apps/api && npm test`: `1..176 # tests 176 # pass 176 # fail 0 # skipped 0` (unchanged matrix).
- `git diff --name-only -- apps/api/src apps/api/package.json package-lock.json`: empty.
- `git diff --check`: no whitespace conflicts.

Working-tree files for this task (`git status --short`):

- `M apps/web/src/App.jsx`
- `M apps/web/src/components/AppShell.jsx`
- `?? apps/web/src/lib/reportHistory.js`
- `?? apps/web/src/lib/reportHistory.test.js`
- `?? apps/web/src/pages/ReportHistory.jsx`
- `M docs/architecture/report-history-and-storage.md`
- `M docs/architecture/report-service.md`
- `M docs/codex/sprint-2-phase-1-guardrails.md`
- `?? docs/proof/s2-25-report-history-ui.md`

No backend, test, dependency, or lockfile change.

## 10. Backend Changes Needed

No. The page consumes the unchanged S2-23 listing and S2-24 download endpoints. No backend bug was found that required a backend code change.

## 11. Package-Lock Changed

No.

## 12. Explicit Non-Goals

S2-25 intentionally does **not**:

- Add backend routes, services, queues, workers, scheduler changes, email delivery, durable storage adapters, signed URLs, retention enforcement, or `report.run.read` / `report.output.download` audit events / `report_list` / `report_download` rate-limit buckets.
- Add a frontend report **detail** page (the listing carries all the metadata the download path needs; a dedicated detail page is reserved for a later UX iteration if needed).
- Add a frontend **regenerate** button (the optional `POST .../regenerate` route remains design-only per S2-20 Section 3.4).
- Add server-driven pagination beyond `limit` (`next_cursor` is reserved in the backend response shape; no cursor UI is wired today).
- Add a member email column, a `requested_by_user_id` lookup that exposes emails, or any other user-record column beyond the sanitized ids the listing already returns.
- Install dependencies (no testing-library, no DOM-render tests; the existing Vitest + manual-mock pattern is used).
- Change PDF/XLSX generation, the synchronous `POST /api/v1/reports/dashboard-snapshot` route, the dashboard's existing client-side exports, or any GBP behavior.
- Add Phase 2 providers, multi-channel metrics, billing, or entitlements.
- Loosen the `organization_members`-based authorization, the `location_org_map` legacy-only status, or any owned-location guard.

## 13. Remaining Risks

- The download path uses `fetch` directly (the shared `api()` client only parses JSON). The fetch is constructed in a small, focused helper with the same bearer-token contract; on `401` the page surfaces the envelope inline rather than calling `clearAuthSession`. If a deeply expired token persists across both the listing and download paths, the listing call (via `api()`) will hit the existing redirect-to-login flow on the next interaction.
- The page does **not** render real component-render tests. The existing test suite is Vitest-on-Node without `jsdom` or `@testing-library/react`. Installing those is out of scope. Helper coverage is at 28 tests (Section 5); the page itself is exercised through the helpers and through the production `npm run build`.
- The filter UI submits as one batch on `Apply filters`; rapid filter changes therefore do not auto-fetch. This avoids per-keystroke listing requests but means very large result sets still need narrower filters or smaller `limit` to be discoverable. The `Limit` input is `1..100`; the backend rejects values above `100`.
- `next_cursor` is reserved in the backend response shape but not wired in the UI. When the backend implements cursor pagination, the page will need a small `Load more` button; today the only signal is the `more results available; narrow filters to see older runs.` caption.
- The page surfaces backend error codes verbatim through `describeReportHistoryError`. Users may see codes like `organization_scope_required` or `report_output_not_ready` in the UI. This matches the existing members page convention; a future polish task could map common codes to friendlier copy.
- The download buttons use the persisted output `size` for the visible label but verify integrity server-side; if the persisted size is missing or stale, the backend will still reject the download with `500 report_output_integrity_failed` and the UI surfaces the envelope inline.
- The Google provider reauth flow is untouched; no banner state is read or written by the new helpers or page.
- Pre-existing Browserslist build warning is unchanged.

## 14. Ready For GPT Verification

Yes. Working tree contains only the S2-25 frontend page, helpers, helper tests, the route/nav wiring, and the three architecture/guardrails doc updates plus this proof doc. No backend source, API tests, web `package.json`, or lockfile diff. All web tests (49), API tests (176), and the web build pass. `git diff --check` is clean and `git diff --name-only -- apps/api/src apps/api/package.json package-lock.json` is empty.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-25 report history UI was verified after frontend helper tests, web build, API npm test, no-backend-diff checks, no-lockfile-diff checks, and diff checks.
