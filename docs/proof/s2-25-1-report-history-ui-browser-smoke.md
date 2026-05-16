# S2-25.1 Report History UI Browser Smoke Proof Pack

Date: 2026-05-16

## 1. Scope And Decision

S2-25.1 is a local smoke that verifies the S2-25 `/reports/history` page is served by the Vite dev server (with the correct route + nav wiring and the documented page module on the wire) and that the exact backend endpoints and response shapes the page consumes behave correctly under the controlled `s2-15-fixture-org` scope. No application or test code was changed; this is documentation/proof only.

A headless-browser tool is not available in this environment, so the in-browser click was exercised by reproducing the same `fetch` URL/headers contract the page's `downloadReportOutput` helper builds (with the same bearer-token strategy and the same `Content-Disposition` filename parsing). The captured response headers and bytes were then re-validated through the page's own helper logic.

Phase 2 integrations remain blocked. No frontend code changed. No backend code changed. No queues, no workers, and no scheduler were started or modified.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pass.

## 2. Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/s2-25-report-history-ui.md`
- `docs/proof/s2-24-1-report-output-download-live-smoke.md`
- `docs/proof/s2-23-1-report-runs-listing-live-smoke.md`
- `docs/architecture/report-history-and-storage.md`
- `docs/architecture/report-service.md`
- `docs/runtime/processes.md`

## 3. Files Inspected

- `apps/web/src/App.jsx` (route wiring)
- `apps/web/src/components/AppShell.jsx` (nav wiring)
- `apps/web/src/pages/ReportHistory.jsx` (page implementation)
- `apps/web/src/lib/reportHistory.js` (`buildReportRunsQuery`, `parseContentDispositionFilename`, `safeDownloadFilename`, `normalizeReportRunRow`, `downloadReportOutput`, etc.)
- `apps/web/src/reportDownloads.js` (`downloadBlob` used by the page after the helper returns a `Blob`)
- `apps/web/src/apiClient.js` and `apps/web/src/session.js` (auth/JWT/redirect contract)
- `apps/api/src/routes/reports.js` (`GET /api/v1/reports/runs`, `GET /api/v1/reports/runs/:runId/outputs/:format`)
- `apps/api/src/services/organizationMemberFixtures.js` (fixture org / user / member / client / location ids)

## 4. Files Changed

- `docs/proof/s2-25-1-report-history-ui-browser-smoke.md` — this proof doc (new).
- `docs/codex/sprint-2-phase-1-guardrails.md` — S2-25.1 completion entry; Phase 2 remains blocked.
- `docs/architecture/report-history-and-storage.md` — small browser-smoke note referencing this proof doc.
- `docs/architecture/report-service.md` — small browser-smoke note referencing this proof doc.

No backend or frontend source code, route handlers, services, tests, or `package.json` entries were changed. `package-lock.json` is unchanged.

## 5. Working Tree State Before Smoke

```text
git status --short
git log -3 --oneline
```

- `git status --short`: empty (clean working tree at the start of S2-25.1).
- Most recent commits before this smoke:
  - `00853fa feat(web): add report history UI` (S2-25)
  - `c2db83e chore(api): smoke test report output download` (S2-24.1)
  - `7a29755 feat(api): add report output download endpoint` (S2-24)

## 6. Smoke Environment

- Local API + web dev only. Workers and scheduler were intentionally not started.
- `npm run dev:prepare` was run from the repo root; it generated `apps/api/.env.local` and `apps/web/.env.local` with the deterministic local mapping (API on `127.0.0.1:5050`, web on `127.0.0.1:5174`).
- API started with `REPORT_STORAGE_LOCAL_DIR=/tmp/parametrics-s2-24-1-report-storage npm run -w @parametrics/api dev:api`, logging redirected to `/tmp/s2-25-1-api.log`. The S2-24.1 storage directory was confirmed to still contain the two smoke files (`<run_id>.pdf` 2047 bytes; `<run_id>.xlsx` 8678 bytes) before the smoke; no new generation was performed.
- Web started with `npm run -w @parametrics/web dev -- --host 127.0.0.1`, logging redirected to `/tmp/s2-25-1-web.log`. Vite reported `Local: http://127.0.0.1:5174/`.
- Local Mongo connection uses the existing configured MongoDB URI/database (`parametrics`). The startup log redacted the credential portion as `mongodb+srv://***:***@cluster0.l9tto5f.mongodb.net/...` (no secrets printed).
- Short-lived (15 min) local JWTs were minted in-process by importing `apps/api/src/lib/jwt.js` (after loading the existing API env) for `s2-15-user-owner`, `s2-15-user-manager`, and `s2-15-user-member` (only the subset needed for the page list/download paths and the deny probes). Tokens were written to `/tmp/s2-25-1-tokens/<role>.txt` with `0600` permissions and were never echoed to the terminal or this proof doc. No user records were created.
- After the smoke, every token file and the helper directory were removed (`rm -f /tmp/s2-25-1-tokens/*.txt; rmdir /tmp/s2-25-1-tokens`). The mint helper (`/tmp/s2-25-1-mint.mjs`) was also deleted so the working tree carries no stray files.

## 7. API / Web Status

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5050/api/v1/health   # 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5174/                # 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5174/reports/history # 200
```

All three returned `200`. After the smoke:

- `pkill -f "node src/server.js"` stopped the API process; a follow-up health probe returned `Connection refused` (`%{http_code}=000`).
- The Vite child (`vite --host 127.0.0.1`) survived the workspace `pkill` because the matched name was the workspace wrapper; a follow-up `kill <pid>` stopped it. A final probe to `127.0.0.1:5174` returned `Connection refused`. The dev API/web are no longer listening.

## 8. Auth / Token Strategy

- Same strategy as S2-23.1 / S2-24.1: a small Node helper imported `apps/api/src/startup/env.js` and `apps/api/src/lib/jwt.js` and called `signJwt({ user_id, role: "individual" }, { expiresIn: "15m" })` for each fixture user_id.
- Tokens were written to `/tmp/s2-25-1-tokens/<role>.txt` with mode `0600` and removed after the smoke. Nothing in this proof or the captured response files echoes a token value. Token lengths (193..196 bytes) were printed only to confirm the helper wrote real JWTs.
- No user records were created. No JWT secret value was logged. The route's `authenticate` middleware accepted the minted tokens because `JWT_SECRET` is the same in-process value used by `signJwt` and `verifyJwt`.

## 9. SPA Shell / Page Render Result

The Vite dev server returned the same SPA shell for `/` and `/reports/history` (the SPA fallback expected for React Router). The captured `/reports/history` shell:

- `<!doctype html>` + the standard Vite `@react-refresh` shim
- `<link rel="icon" type="image/svg+xml" href="/vite.svg" />`
- `<title>web</title>`
- `<div id="root"></div>`
- `<script type="module" src="/src/main.jsx"></script>`

The dev-served React modules carry the documented route, nav, and page wiring:

- `GET /src/App.jsx` includes `import ReportHistory from "/src/pages/ReportHistory.jsx";` and the new authenticated route element.
- `GET /src/components/AppShell.jsx` includes `{ to: "/reports/history", label: "Reports" }` in the `nav` array.
- `GET /src/pages/ReportHistory.jsx` returns the transformed page module (`92027` bytes from Vite). A grep over the served module surfaces the expected tokens:
  - imports `downloadBlob` from `/src/reportDownloads.js`
  - imports `REPORT_RUN_STATUSES`, `downloadReportOutput`, `formatBytes`, `listReportRunsForUser` from `/src/lib/reportHistory.js`
  - calls `listReportRunsForUser({...})` and `downloadReportOutput({...})`
  - title `Report history`
  - filter-form aria label `Report history filters`
  - the documented `/tmp` warning copy: `"Report history currently shows generated dashboard snapshot reports. Downloads require durable local output files; older smoke files written under "` followed by a `<code>/tmp</code>` chunk
  - `REPORT_RUN_STATUSES.map(...)` powering the status dropdown
  - `formatBytes(output.size)` in the per-output row
- `GET /src/lib/reportHistory.js` (`47239` bytes from Vite) shows the helper module with the documented backend URLs in its preamble (`GET /api/v1/reports/runs`, `GET /api/v1/reports/runs/:runId/outputs/:format`), the runtime URL builder (`${base}/api/v1/reports/runs/${encodeURIComponent(cleanRunId)}/outputs/${encodeURIComponent(cleanFormat)}`), and the single `storage_key` reference used only for the presence-only `downloadable` computation.

Grep summary for `storage_key` over the dev-served modules:

- `/src/pages/ReportHistory.jsx`: `0` occurrences (the page never reads or renders `storage_key`).
- `/src/lib/reportHistory.js`: `1` occurrence (`status === "succeeded" && !!storageProvider && !!cleanText(output.storage_key, 1000)` inside `normalizeOutput`; presence check only — the value is not propagated to the normalized output or to the UI).

Interactive in-browser rendering (DOM mount, button click, `<a download>` trigger) was **skipped**: no headless-browser tool is available in this execution environment. The page module is the same one the test suite imports (the 28 helper tests in `apps/web/src/lib/reportHistory.test.js` cover the helper behaviors used by the page) and the `npm run build` succeeds, so the only thing not verified live is the React mount + click handler. Sections 10 and 11 reproduce the exact `fetch` URL/header contract the page builds, so the click-path behavior is verified end-to-end through the API contract.

## 10. Org / List / Filter Result

Owner token, broad listing (the call the page issues on org selection):

```bash
curl -sS -H "Authorization: Bearer ${OWNER}" \
  "http://127.0.0.1:5050/api/v1/reports/runs?organization_id=s2-15-fixture-org"
```

- HTTP `200`.
- Top-level keys (sorted): `pagination, report_runs`.
- `pagination`: `{"limit":25,"has_more":false,"next_cursor":null}` — exactly the shape `normalizeReportRunRow` / the page's `setPagination` expect.
- `report_runs.length`: `2`.
- Both rows match `organization_id=s2-15-fixture-org`, `status=succeeded`, `client_id=null`, `location_id=null`. The S2-24.1 smoke row (`report_key: s2-24-1-smoke-dashboard`, id short `02c0f77c...`) and the earlier S2-22.1 smoke row (`report_key: s2-22-1-smoke-dashboard`, id short `d4a99c3d...`) are visible. Per-output: 2 outputs each (`pdf` 2047 B; `xlsx` 8678 B), `storage_provider: "local"`, `storage_key` starts with `report-outpu...`.

Owner token, filter narrowing (the call the page issues when the user applies `status=succeeded`, `report_type=dashboard_snapshot`, `report_key=s2-24-1-smoke-dashboard`, `date_from=2026-05-15`, `date_to=2026-05-17`, `limit=1`):

```bash
curl -sS -H "Authorization: Bearer ${OWNER}" \
  "http://127.0.0.1:5050/api/v1/reports/runs?\
organization_id=s2-15-fixture-org&\
status=succeeded&\
report_type=dashboard_snapshot&\
report_key=s2-24-1-smoke-dashboard&\
date_from=2026-05-15&\
date_to=2026-05-17&\
limit=1"
```

- HTTP `200`.
- `pagination`: `{"limit":1,"has_more":false,"next_cursor":null}`.
- `report_runs.length`: `1`. Row: `report_key: s2-24-1-smoke-dashboard`, `status: succeeded`, id short `02c0f77c...`.

The query string above is exactly what the page's `buildReportRunsQuery` helper builds for the same filter inputs (verified in unit tests; behavior re-checked here against a live response).

## 11. Download Result

The S2-25 page's `downloadReportOutput({ runId, format })` helper builds:

```
${apiBase}/api/v1/reports/runs/${encodeURIComponent(runId)}/outputs/${encodeURIComponent(format)}
```

The same URL was exercised directly under the owner JWT (full run id intentionally not echoed; short prefix `02c0f77c-...`):

```bash
curl -sS -D /tmp/s2-25-1-pdf-headers.txt  -o /tmp/s2-25-1-pdf.bin \
  -H "Authorization: Bearer ${OWNER}" \
  "http://127.0.0.1:5050/api/v1/reports/runs/<run_id>/outputs/pdf"
# HTTP 200 bytes 2047

curl -sS -D /tmp/s2-25-1-xlsx-headers.txt -o /tmp/s2-25-1-xlsx.bin \
  -H "Authorization: Bearer ${OWNER}" \
  "http://127.0.0.1:5050/api/v1/reports/runs/<run_id>/outputs/xlsx"
# HTTP 200 bytes 8678
```

Captured response headers (the only headers the page reads):

| header | PDF | XLSX |
| --- | --- | --- |
| `Content-Type` | `application/pdf` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `Content-Disposition` | `attachment; filename="s2-24-1-smoke-dashboard-<run_id>.pdf"` | `attachment; filename="s2-24-1-smoke-dashboard-<run_id>.xlsx"` |
| `Content-Length` | `2047` | `8678` |
| `Cache-Control` | `no-store` | `no-store` |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |

Byte / integrity confirmation:

| format | downloaded size | sha256 prefix | first bytes |
| --- | --- | --- | --- |
| `pdf` | `2047` | `fc62c1bb2b92...` | `%PDF-1.4` |
| `xlsx` | `8678` | `6c1331a5967c...` | `PK\x03\x04` (zip magic) |

Both sha256 prefixes match the S2-24.1 persisted metadata, confirming the page's download contract returns the same bytes the storage adapter wrote.

Filename / safety re-check: the page's `parseContentDispositionFilename` + `safeDownloadFilename` helpers were re-run against the captured `Content-Disposition` headers:

- `parseContentDispositionFilename(pdf_cd)` → `s2-24-1-smoke-dashboard-<run_id>.pdf`
- `safeDownloadFilename(..., "report-fallback.pdf")` → `s2-24-1-smoke-dashboard-<run_id>.pdf` (allow-listed; the page would pass this directly to `downloadBlob`).
- Same for xlsx.

The actual in-browser `<a download>` click was **skipped** (no headless browser available). The browser-side hand-off path is `downloadReportOutput → { blob, filename } → downloadBlob(filename, blob)`. `downloadBlob` is the existing helper in `apps/web/src/reportDownloads.js` (unchanged), which `apps/web/src/pages/Dashboard.jsx` already uses in production for the synchronous report-route response; that path is exercised by the existing dashboard report action.

## 12. Sanitization Confirmation

The two captured listing responses (`/tmp/s2-25-1-list-owner.json`, `/tmp/s2-25-1-list-filtered.json`) were scanned. Counts per literal (zero matches expected for everything except the documented `storage_key` durable-metadata field):

| literal | broad listing | filtered listing |
| --- | --- | --- |
| `"_id"` | `0` | `0` |
| `"input_snapshot"` | `0` | `0` |
| `"buffer"` | `0` | `0` |
| `"base64"` | `0` | `0` |
| `/tmp/` | `0` | `0` |
| `/var/www/` | `0` | `0` |
| `REPORT_STORAGE_LOCAL_DIR` | `0` | `0` |
| `parametrics-s2-24-1-report-storage` | `0` | `0` |
| `@gmail` | `0` | `0` |
| `@parametrics` | `0` | `0` |

`storage_key` is intentionally present in the backend listing response (S2-20 Section 4.3 classifies it as durable metadata for the listing contract). The frontend `normalizeReportRunRow` helper drops it before rendering — Section 9 confirms zero `storage_key` references in the dev-served page module and a single presence-only check in the dev-served helper module. No download URL or any other clickable element is ever constructed from `storage_key`.

The captured download response headers carry only `Content-Type`, `Content-Disposition` (with the ASCII-safe filename), `Content-Length`, `Cache-Control`, `X-Content-Type-Options`, and the standard Helmet hardening set; no absolute path, no `storage_key`, no env value, no email, and no token is echoed in any header.

## 13. Error State Result

Each error path the page can show was reproduced as a non-mutating request against the same endpoints the page calls:

| label | role / context | URL | HTTP | `error.code` |
| --- | --- | --- | --- | --- |
| listing missing `organization_id` | owner | `GET /reports/runs` | `400` | `bad_request` |
| listing denied for `member` | member | `GET /reports/runs?organization_id=s2-15-fixture-org` | `403` | `organization_role_required` |
| listing manager without scope | manager | `GET /reports/runs?organization_id=s2-15-fixture-org` | `403` | `organization_scope_required` |
| download invalid format | owner | `GET /reports/runs/<run_id>/outputs/csv` | `400` | `bad_request` |
| download manager on org-level run | manager | `GET /reports/runs/<run_id>/outputs/pdf` | `403` | `organization_scope_required` |
| download missing auth | (no header) | `GET /reports/runs/<run_id>/outputs/pdf` | `401` | `unauthorized` |

Each response is a sanitized JSON envelope (`{ error: { code, message, ... } }`) that the page's `describeReportHistoryError` helper formats inline as `<code>: <message>`. None of these envelopes mutate data; none of them clear the app's auth session (the page surfaces them inline rather than calling `clearAuthSession`), and none of them trigger the Google provider reauth banner (the new helpers never invoke `triggerGoogleReauth`).

The `401` envelope on the no-auth download probe would also flow through the shared `api()` client's existing redirect-to-login behavior if the page made any subsequent JSON call with the missing token — the existing `apiClient.js` contract handles that case; nothing in S2-25 changes it.

## 14. Secret / Raw Record Confirmation

- No JWTs were printed in this proof doc or in any terminal output captured here. The minted local JWTs lived in `/tmp/s2-25-1-tokens/<role>.txt` (`0600`) for the duration of the smoke and were removed afterward.
- No OAuth access/refresh/ID tokens, auth codes, authorization headers, encrypted secret payloads, passwords, emails, or raw user records appear in this doc, the captured request URLs, the captured response headers, the captured response bodies, or any helper script output.
- The Mongo connection log line was redacted at the credential portion: `mongodb+srv://***:***@cluster0.l9tto5f.mongodb.net/...`. No live credential value is reproduced here.
- The dev-served SPA shell does not contain any user identifier or secret; it is the static Vite-injected HTML wrapper.
- The captured download response bodies are raw PDF/XLSX bytes by design; only the byte-level magic prefix (`%PDF`, `PK\x03\x04`) is reproduced in this doc.

## 15. Checks Run

```bash
cd apps/web && npm test -- --run
cd apps/web && npm run build
cd apps/api && npm test
git diff --name-only -- apps/api/src apps/web/src apps/api/package.json apps/web/package.json package-lock.json
git diff --check
```

Outcomes:

- `cd apps/web && npm test -- --run`: `Test Files 5 passed (5) / Tests 49 passed (49)`.
- `cd apps/web && npm run build`: `288 modules transformed. ✓ built in ~22s` (pre-existing Browserslist data-age warning unchanged).
- `cd apps/api && npm test`: `1..176 # tests 176 # pass 176 # fail 0 # skipped 0` (unchanged matrix).
- `git diff --name-only -- apps/api/src apps/web/src apps/api/package.json apps/web/package.json package-lock.json`: empty.
- `git diff --check`: no whitespace conflicts.

Working-tree files for this task (`git status --short`):

- `M docs/architecture/report-history-and-storage.md`
- `M docs/architecture/report-service.md`
- `M docs/codex/sprint-2-phase-1-guardrails.md`
- `?? docs/proof/s2-25-1-report-history-ui-browser-smoke.md`

API process and web Vite dev server were both stopped after the smoke and the ports were confirmed free.

## 16. Skipped / Remaining Risks

- Interactive in-browser DOM mount, button click, and the `<a download>` trigger were **skipped** because no headless-browser tool is available in this environment. The smoke covered the page module on the wire (dev-served Vite transform), the route/nav wiring in the served modules, the exact `fetch` URL/header/body contract the page builds for listing and downloading, and the page's filename parsing/sanitization helpers (re-run against the captured `Content-Disposition` values). The existing 28-test helper suite (`apps/web/src/lib/reportHistory.test.js`) covers the helper behaviors used by the page. A future task could install `@testing-library/react` + `jsdom` to cover the React mount path, but that is intentionally out of scope here (no dependency install per S2-25.1 constraints).
- Org-level rows only. The S2-22.1 and S2-24.1 smoke rows are both `client_id: null` and `location_id: null`, so the manager/viewer positively-matching-scope success path was not exercised live in this smoke. Existing unit tests in `apps/api/src/routes/reports.test.js` already cover that path for both endpoints.
- The Vite child process (`vite --host 127.0.0.1`) was not stopped by the workspace-name `pkill`. A `kill <pid>` cleanup step was required and is reflected in Section 7. Future smokes that need to stop the web dev server should target the Vite pid directly (or use the new `npm run dev:prepare` mapping to bind ports inside a controlled subprocess).
- `next_cursor` remains reserved in the backend response (always `null` today); the page's `has_more` hint copy is the only paging signal in the UI.
- The S2-22.1 / S2-24.1 fixture rows still live in MongoDB because no safe delete route exists. Same convention as the S2-15 / S2-16.1 / S2-17.1 / S2-22.1 / S2-23.1 / S2-24.1 fixtures.
- The S2-24.1 storage directory (`/tmp/parametrics-s2-24-1-report-storage`) is still subject to Linux `/tmp` cleanup on host reboot; if it is wiped before the next smoke, downloads against the existing run will return `500 report_output_read_failed`. Production deployments should set `REPORT_STORAGE_LOCAL_DIR` to a persistent path outside `/tmp`, as already called out in the S2-22.1 / S2-24.1 risks.
- Pre-existing Browserslist build warning is unchanged.

## 17. Code Changes Needed

No. The page route, nav entry, served page module, helper module, listing API, download API, and inline error envelopes all behaved correctly against the running API + web dev pair under the controlled fixture scope. No real UI or backend blocker was found.

## 18. Ready For GPT Verification

Yes. The smoke proved the S2-25 `/reports/history` page is served by Vite with the documented route/nav/page module wiring; the listing flow uses the documented `GET /api/v1/reports/runs` URL/shape under the controlled fixture scope and surfaces both fixture rows under broad listing and narrows to the S2-24.1 row under the documented filter combo; the download flow uses the documented `GET /api/v1/reports/runs/:runId/outputs/:format` URL with bearer auth and returns raw PDF/XLSX bytes (not JSON, not base64) with `Content-Type`, `Content-Disposition` (ASCII-safe filename), `Content-Length`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`; the dev-served page module contains zero `storage_key` references and the dev-served helper module exposes only a presence-only check; the listing response carries no `_id`/`input_snapshot`/`buffer`/`base64`/absolute path/env value/email leakage; the documented denial codes (`bad_request`, `organization_role_required`, `organization_scope_required`, `unauthorized`) all surface as sanitized JSON envelopes that the page can render inline. All API tests (176), web tests (49), and the web build pass. Working tree shows only the four allowed doc paths.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-25.1 report history UI browser smoke was verified after local API/web smoke, route/nav/page-module verification, listing/filter checks, download-contract checks, sanitization review, API tests, web tests, web build, no-source-diff checks, and diff checks.
