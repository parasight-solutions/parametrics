# Sprint 2 Report Foundation Closeout Proof Pack

Date: 2026-05-16

## 1. Scope And Decision

S2-26 is the Sprint 2 report foundation closeout audit. It is documentation/proof/audit only. No backend or frontend code, routes, services, auth/JWT/provider behavior, GBP/report/location runtime behavior, RBAC middleware, billing/entitlements, Phase 2 providers, Google location binding behavior, worker/scheduler behavior, destructive scripts, or dependencies were changed or run.

Claude Code is the execution tool. Claude Code did not commit or push.

### Current State Vs Target State

Current state:

- ParaMetrics remains a Google Business Profile first operations app. The synchronous authenticated dashboard snapshot generation flow from S2-05/S2-06 is still the primary report path. It now writes durable PDF/XLSX bytes through a local storage adapter (S2-22) in addition to returning the original base64 `files[]` for backward compatibility.
- A read-only report history surface exists end-to-end: backend listing API (S2-23), backend output download API (S2-24), and a minimal authenticated frontend page at `/reports/history` (S2-25) wired through pure helpers and tested with 28 Vitest cases. Three live local smokes (S2-22.1 / S2-23.1 / S2-24.1) confirmed the storage adapter, listing API, and download API end-to-end against the controlled `s2-15-fixture-org` fixture; one dev-server smoke (S2-25.1) confirmed the SPA route/nav/page-module wiring plus the exact `fetch` URL/header contract the page builds for listing and downloading.
- The workspace/member foundation from Sprint 2 (S2-07..S2-17.1) and the closeout follow-up tasks (S2-18 / S2-19) remain in place. `organization_members` is the only workspace authorization source; JWT `role` and `location_org_map` are never consulted for workspace authorization. Owned-location and canonical scope guards still run before any membership check on GBP location-bound paths.
- The `docs/codex/*` workflow remains the source of truth. A thin Claude Code governance adapter (`CLAUDE.md`, `docs/claude-code/README.md`) is in place for Claude Code execution.

Target state:

- Multi-tenant, multi-channel SaaS. Future work may add cloud storage adapters (S3/GCS/Azure), signed/short-lived download URLs, retention/expiry enforcement, queue/worker-backed generation, scheduled reports, email delivery, a frontend report detail page, a regenerate UI/route, dedicated `report.run.list`/`report.output.download` audit events, dedicated `report_list`/`report_download` rate-limit buckets, dashboard builder, billing/entitlements, and Phase 2 provider adapters.
- Target-state features are not assumed implemented unless verified.

### Pass / Not Pass Decision

**Pass.**

Reason: every task in the Sprint 2 report foundation sequence (S2-01..S2-06.1, S2-20, S2-22..S2-25.1) is implemented, tested, and live-smoke verified within the documented scope. The synchronous generation route, the durable local storage adapter, the listing API, the download API, and the report history UI all behave according to the S2-20 contract under the controlled fixture. `organization_members`-based authorization, sanitization, owned-location guards, `location_org_map` legacy-only status, and the API/worker/scheduler runtime separation hold across the route, service, and UI surfaces. No Phase 2 drift was introduced.

### GPT Decision

Pass.

## 2. Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-2-closeout-proof-pack.md`
- `docs/proof/s2-19-api-test-script.md`
- `docs/proof/s2-20-report-history-storage-contract.md`
- `docs/proof/s2-22-durable-local-report-storage.md`
- `docs/proof/s2-22-1-durable-report-storage-live-smoke.md`
- `docs/proof/s2-23-report-runs-listing-api.md`
- `docs/proof/s2-23-1-report-runs-listing-live-smoke.md`
- `docs/proof/s2-24-report-output-download-api.md`
- `docs/proof/s2-24-1-report-output-download-live-smoke.md`
- `docs/proof/s2-25-report-history-ui.md`
- `docs/proof/s2-25-1-report-history-ui-browser-smoke.md`
- `docs/architecture/report-history-and-storage.md`
- `docs/architecture/report-service.md`
- `docs/runtime/processes.md`

## 3. Completed Report Foundation Summary

| Task | Status | Summary |
| --- | --- | --- |
| S2-01 | Complete | Pure backend report service abstraction with dashboard snapshot input normalization, sanitized `input_snapshot`, output metadata helpers, and the `pending`/`running`/`succeeded`/`failed` status lifecycle (`apps/api/src/services/reportService.js`). |
| S2-02 | Complete | In-memory PDF buffer generation from the S2-01 report run metadata (`apps/api/src/services/reportPdf.js`). No files persisted, no route, no queue. |
| S2-03 | Complete | In-memory XLSX workbook generation with sanitized sheets and capped row counts (`apps/api/src/services/reportXlsx.js`). |
| S2-04 | Complete | Mongo persistence for `reports` and `report_runs` with the scope-aware unique index strategy in `apps/api/src/startup/ensureIndexes.js` and metadata-only lifecycle helpers in `apps/api/src/services/reportStore.js`. No generated buffers/base64 in Mongo. |
| S2-04.1 | Complete | Verified configured MongoDB index creation for `reports` and `report_runs` before any report route landed. |
| S2-05 | Complete | Authenticated synchronous `POST /api/v1/reports/dashboard-snapshot` route wires S2-01..S2-04, enforces owned-location and canonical scope guards, generates outputs synchronously, returns base64 `files[]`, and persists metadata-only. |
| S2-05.1 | Complete | Live local API/Mongo smoke — HTTP 200, base64 `files[]` returned, metadata-only `report_runs` persistence, audit success logging. |
| S2-06 | Complete | Frontend dashboard action calls the authenticated route from the existing GBP dashboard, converts returned base64 to a `Blob`, triggers browser downloads, and never persists generated bytes in `localStorage`/`sessionStorage`. Existing client-side CSV/SVG/PNG/PDF exports remain. |
| S2-06.1 | Complete | Browser smoke for the frontend dashboard report action confirmed downloads, metadata-only persistence, and audit success logging. |
| S2-20 | Complete (docs/design only) | Report history and durable storage **contract** in `docs/architecture/report-history-and-storage.md`: future `GET /api/v1/reports/runs`, `GET /api/v1/reports/runs/:runId`, `GET /api/v1/reports/runs/:runId/outputs/:format`, optional regenerate, `ReportStorageAdapter` abstraction, additive `report_runs.outputs[]` durable-metadata fields, `organization_members`-based authorization with `member`/`invited`/`disabled` denial, `/reports/history` frontend recommendation, listing/download index recommendations, reserved `report.run.list`/`report.run.read`/`report.output.download` audit events and `report_list`/`report_download` rate-limit buckets, and the conservative implementation sequence S2-22 → S2-23 → S2-24 → S2-25 (queue/worker S2-26-style work only after acceptance). |
| S2-22 | Complete | First cut of the storage adapter (`apps/api/src/services/reportStorage.js`) — `local` provider with `writeOutput`/`readOutput`/`statOutput`/`deleteOutput`, safe key building, traversal-protected resolution, sha256 checksums, and `REPORT_STORAGE_LOCAL_DIR`-driven root resolution (`<os.tmpdir()>/parametrics/report-outputs` fallback). The synchronous report route now writes durable bytes through the adapter and persists `storage_provider`/`storage_key`/`content_type`/`filename`/`checksum`/`generated_at`/`expires_at` on `report_runs.outputs[]` alongside the existing fields. `path` stays `null`. Generated buffers/base64 are never stored in Mongo. |
| S2-22.1 | Complete | Live local API + Mongo smoke proved real PDF/XLSX files on disk under `REPORT_STORAGE_LOCAL_DIR` with sizes and sha256 hashes matching persisted metadata, durable metadata persisted on `report_runs.outputs[]`, the unchanged base64 `files[]` response, no raw `input_snapshot`/`buffer`/`base64` in Mongo, `path: null`, no absolute path or env value leaked in the response, and `location_org_map` untouched. |
| S2-23 | Complete | Read-only `GET /api/v1/reports/runs` listing endpoint returns sanitized `report_runs` rows with optional `client_id`/`location_id`/`report_type`/`report_key`/`status`/`date_from`/`date_to` filters, `limit` bounded to `[1,100]` (default `25`), server-controlled `created_at desc` sort with `id` tiebreaker, and `{ limit, has_more, next_cursor: null }` pagination. Auth uses `organization_members` only; `owner`/`admin` see all rows; `manager`/`viewer` must supply matching `client_id`/`location_id`; `member`/`invited`/`disabled`/missing denied. Sanitization omits Mongo `_id`, raw `input_snapshot`, raw buffers/base64, and absolute paths; `storage_key` is exposed as durable metadata per the S2-20 contract. |
| S2-23.1 | Complete | Live local API + Mongo smoke proved HTTP 200, the documented `{ report_runs[], pagination }` shape, newest-first sort, the S2-22.1 row visible to broad roles, filter narrowing to a single row under `status`/`report_type`/`report_key`/`date_from`/`date_to`/`limit=1`, durable per-output metadata exposed with `path: null`, no `_id`/`input_snapshot`/`buffer`/`base64`/absolute-path leakage, the documented denial codes (`organization_scope_required` for manager/viewer without scope, `organization_role_required` for `member`, `organization_membership_required` for `invited`/`disabled`), Mongo counts matching the listing response, and `location_org_map` untouched. |
| S2-24 | Complete | Read-only `GET /api/v1/reports/runs/:runId/outputs/:format` endpoint reads bytes through the `ReportStorageAdapter` and streams them back as a raw response body (not JSON, not base64). Auth uses `organization_members` only — `owner`/`admin` can download any output in their org; `manager`/`viewer` only when the run's `client_id`/`location_id` matches their assignments; org-level runs denied for `manager`/`viewer` with `403 organization_scope_required`; `member`/`invited`/`disabled`/missing denied. Output readiness requires `status: succeeded` plus `storage_provider` and `storage_key` (otherwise `409 report_output_not_ready`). Missing run ⇒ `404 report_run_not_found`; missing format ⇒ `404 report_output_not_found`; invalid format/runId ⇒ `400 bad_request`. Storage read failures surface as `500 report_output_read_failed`; size or sha256 mismatch ⇒ `500 report_output_integrity_failed`. Headers: `Content-Type` from persisted output, `Content-Disposition: attachment; filename="<sanitized>"`, `Content-Length`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. The route never returns base64, never returns absolute paths, never logs the storage root, never mutates `report_runs`, never writes new storage. New store helpers `getReportRunById` and `findReportRunOutput` in `apps/api/src/services/reportStore.js`. |
| S2-24.1 | Complete | Live local API + Mongo smoke proved HTTP 200 for `owner`/`admin` with raw PDF/XLSX bodies (`%PDF` and `PK\x03\x04` magic), `Content-Type` matching persisted `output.content_type`, ASCII-safe `Content-Disposition`, matching `Content-Length`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, downloaded sha256 matching persisted `output.checksum.value`, the documented `403` denial codes for manager/viewer/`member`/`invited`/`disabled` against an org-level run, `400 bad_request` for invalid/unknown format, `404 report_run_not_found` for an unknown run id, and `401 unauthorized` for the no-auth probe. The S2-22.1 `/tmp` directory was wiped between 2026-05-12 and 2026-05-16, so a fresh fixture run was generated under the controlled scope (`report_key: s2-24-1-smoke-dashboard`) before downloading. `404 report_output_not_found`, `409 report_output_not_ready`, `500 report_output_read_failed`, `500 report_output_integrity_failed` were skipped live (would require data mutation) and remain covered by unit tests. |
| S2-25 | Complete | Minimal authenticated frontend page at `/reports/history` (`apps/web/src/pages/ReportHistory.jsx`) wires the read-only listing and download endpoints through a new pure helper module (`apps/web/src/lib/reportHistory.js`) and its Vitest tests (`apps/web/src/lib/reportHistory.test.js`, 28 tests). New `Reports` nav entry in `AppShell` between `Reviews` and `Members`. The page renders an org picker, a labeled filter form (`status`/`report_type`/`report_key`/`date_from`/`date_to`/`limit`), and per-run cards with status/type badges, scope summary (`organization`/`client`/`location` ids only — never emails), `requested_by_user_id`, `created_at`/`completed_at`, and one row per output with format/status/size/storage-provider plus a `Download <FORMAT>` button when the output is `succeeded` with `storage_provider`+`storage_key`. The helper module's `downloadReportOutput` uses `fetch` directly because the shared JSON `api()` client cannot return raw bytes; the page combines it with the existing `downloadBlob` helper for the browser-side `<a download>` hand-off. The page never reads or renders `storage_key`, never constructs storage URLs, never displays absolute paths or base64, and never shows emails. |
| S2-25.1 | Complete | Local API + Vite dev-server smoke proved the SPA shell + dev-served React modules carry the documented route, nav, and page wiring; the live listing flow returned both fixture rows under broad listing and narrowed to the S2-24.1 row under the documented filter combo; the live download flow returned raw PDF/XLSX bytes whose sha256 prefixes match the S2-24.1 persisted metadata with the documented header set; the dev-served page module contained zero `storage_key` references (helper module has a single presence-only check); the listing response contained no `_id`/`input_snapshot`/`buffer`/`base64`/`/tmp/`/`/var/www/`/`REPORT_STORAGE_LOCAL_DIR`/storage-root literal/`@`-style address leakage; and the documented `400 bad_request` / `401 unauthorized` / `403 organization_role_required` / `403 organization_scope_required` envelopes all surface as sanitized JSON for the page to render inline. Interactive in-browser DOM mount + `<a download>` click were skipped (no headless-browser tool available in this environment); the same `fetch` URL/header contract the page builds was reproduced and validated. |

Explicit limitations carried forward:

- Report generation is still synchronous on the API runtime. No queue, dedicated report worker, or scheduler change has been wired.
- Storage is local-only. No cloud adapter (S3/GCS/Azure), signed URLs, retention/expiry enforcement, or scheduled cleanup exists.
- No frontend report detail page, regenerate button, or cursor pagination UI.
- No dedicated `report.run.list`/`report.run.read`/`report.output.download` audit events and no dedicated `report_list`/`report_download` rate-limit bucket.
- Dashboard builder, email delivery, recurring schedules, multi-channel metrics, AI/premium layer, billing/entitlements, and Phase 2 providers remain out of scope and blocked.

## 4. Security And Tenancy Summary

- **`organization_members` is the only workspace authorization source.** The listing route (S2-23), the download route (S2-24), and the frontend page (S2-25) all resolve authorization through `requireOrganizationMembership({ organizationId, userId })` and the `assigned_client_ids`/`assigned_location_ids` arrays. `owner`/`admin` see/download everything in the organization; `manager`/`viewer` are scoped to their assignments and denied org-level runs (`403 organization_scope_required`); `member`/`invited`/`disabled`/missing memberships are denied.
- **JWT `role` is never trusted for workspace authorization.** Every smoke in this sprint minted JWTs with the default `role: "individual"` and the routes still produced the correct allow/deny decisions because they consult `organization_members` only.
- **`location_org_map` is legacy-only.** It is not consulted in any new report-foundation route or helper, and the S2-22.1 / S2-23.1 / S2-24.1 smokes explicitly confirmed `location_org_map.countDocuments({ organization_id: "s2-15-fixture-org" })` remained `0` throughout.
- **No raw buffers or base64 in Mongo.** `report_runs.outputs[]` carries only durable metadata (`format`, `status`, `size`, `path: null`, `storage_provider`, `storage_key`, `content_type`, `filename`, `checksum`, `generated_at`, `expires_at`, `error`, timestamps). The synchronous route response continues to include base64 `files[]` for backward compatibility, but those bytes are never persisted.
- **No absolute paths exposed.** The download route never logs `REPORT_STORAGE_LOCAL_DIR` or absolute file paths and never includes them in responses. The listing/download response scans in S2-22.1 / S2-23.1 / S2-24.1 / S2-25.1 found zero `/tmp/`, `/var/www/`, or `REPORT_STORAGE_LOCAL_DIR` literal occurrences.
- **`storage_key` is treated as durable metadata only.** It is exposed by the listing API per the S2-20 contract (so the contract can later support cloud adapters or signed URLs without redesigning the response shape) but is never used to construct a download URL on the frontend. The page module has zero `storage_key` references, and `normalizeReportRunRow` strips the field from every output it returns to the UI.
- **No secrets/tokens/raw records in proofs.** The S2-22.1 / S2-23.1 / S2-24.1 / S2-25.1 proof docs explicitly confirm no JWTs, OAuth access/refresh/ID tokens, auth codes, authorization headers, encrypted secret payloads, passwords, emails, or raw user records were printed; tokens lived in `/tmp/s2-*/tokens/*.txt` (`0600`) for the duration of each smoke and were removed afterward. Mongo connection log lines were redacted at the credential portion.
- **Owned-location and canonical scope guards are unchanged.** The synchronous report route still runs the existing owned-location check before any membership-aware check on GBP location-bound paths. The new listing and download routes do not loosen any owned-location guard.
- **Sanitized error envelopes.** All routes use `toApiError(res, mapValidationError(error))` and return compact `{ error: { code, message, ... } }` envelopes. The frontend page surfaces them inline through `describeReportHistoryError` and does not clear app auth or trigger Google reauth on 403/404/409/500.

## 5. Test / Build Proof Summary

API focused matrix (run from `apps/api`):

```bash
cd apps/api && npm test
```

Result (S2-26 run, 2026-05-16):

```text
1..176
# tests 176
# pass 176
# fail 0
# skipped 0
```

The matrix runs the same focused 14-test-file set documented in S2-19 (`docs/proof/s2-19-api-test-script.md`); the count grew from `114` (S2-18) to `176` (current) as the report-foundation follow-ups (S2-22 storage tests, S2-23 listing tests, S2-24 download tests + new `getReportRunById`/`findReportRunOutput` tests) landed inside the existing test files.

Web checks (run from `apps/web`):

```bash
cd apps/web && npm test -- --run
cd apps/web && npm run build
```

Results (S2-26 run, 2026-05-16):

```text
Test Files  5 passed (5)
Tests  49 passed (49)
```

```text
288 modules transformed.
✓ built in ~30s
```

The web test count grew from `21` (S2-18) to `49` (current); the new 28 tests live in `apps/web/src/lib/reportHistory.test.js` and cover the helper behaviors used by the `/reports/history` page (constants, limit clamping, query builder, `Content-Disposition` parsing, filename sanitization, byte formatting, error formatting, row normalization including a `JSON.stringify` scan that confirms `storage_key` is never exposed, and `downloadReportOutput` URL/header construction with an injected fake fetch). The build adds two modules (`286 → 288`) for the new page and helper. The pre-existing Browserslist data-age warning is unchanged.

Live API/Mongo/disk smoke coverage (in order):

- `docs/proof/s2-04-1-report-index-verification.md`
- `docs/proof/s2-05-1-report-route-smoke.md`
- `docs/proof/s2-06-1-...` (frontend dashboard report browser smoke)
- `docs/proof/s2-22-1-durable-report-storage-live-smoke.md` — durable local storage end-to-end against the controlled fixture (PDF/XLSX bytes on disk, sha256-matched persisted metadata, no `input_snapshot`/`buffer`/`base64` in Mongo, no env leak in the response).
- `docs/proof/s2-23-1-report-runs-listing-live-smoke.md` — listing endpoint end-to-end (HTTP 200, documented response shape, role/scope denial codes, sanitization, Mongo count match, `location_org_map` untouched).
- `docs/proof/s2-24-1-report-output-download-live-smoke.md` — download endpoint end-to-end (raw PDF/XLSX bytes, integrity match, header set, role/scope denial codes, error codes; fresh fixture run generated after `/tmp` cleanup).
- `docs/proof/s2-25-1-report-history-ui-browser-smoke.md` — `/reports/history` dev-server smoke (SPA shell, dev-served route/nav/page-module wiring, exact `fetch` URL/header contract for listing and downloading; interactive DOM mount + click skipped because no headless-browser tool was available).

Final diff/scope checks for this S2-26 closeout:

- `git status --short`: only docs-only changes for S2-26.
- `git diff --check`: no whitespace conflicts.
- `git diff --name-only -- apps/api/src apps/web/src apps/api/package.json apps/web/package.json package-lock.json`: empty.

## 6. Remaining Risks

- **Local storage needs a persistent path outside `/tmp` in production.** The S2-22 local adapter defaults to `<os.tmpdir()>/parametrics/report-outputs` when `REPORT_STORAGE_LOCAL_DIR` is unset; both the S2-22.1 directory (`/tmp/parametrics-s2-22-1-report-storage`) and the S2-24.1 directory (`/tmp/parametrics-s2-24-1-report-storage`) are vulnerable to Linux `/tmp` cleanup on host reboot. The S2-22.1 files were already wiped between 2026-05-12 and 2026-05-16 (the S2-24.1 smoke had to generate a fresh fixture row to download). Production deployments must set `REPORT_STORAGE_LOCAL_DIR` to a persistent path outside `/tmp` (or move to a cloud adapter) before relying on download history.
- **No cloud storage adapter.** Only the `local` provider exists today. S3/GCS/Azure adapters are reserved in the S2-20 contract behind the same `ReportStorageAdapter` surface but are not implemented.
- **No queue / worker / scheduler.** Generation is still synchronous on the API runtime. The S2-20 contract documents an `report-generate` queue + dedicated report worker direction (`S2-26 (optional)` in the contract's implementation sequence); it remains intentionally not implemented until product demand and acceptance.
- **No report scheduling / email delivery / recurring schedule.** Reserved as future work; no scaffolding exists.
- **No report detail or regenerate UI.** The listing carries enough metadata for the download path; a dedicated detail page or regenerate button is reserved.
- **No cursor pagination UI.** `next_cursor` is reserved in the backend response shape but always `null`; the UI shows a "narrow filters" hint when `has_more` is true.
- **No dedicated `report.run.list` / `report.run.read` / `report.output.download` audit events and no dedicated `report_list` / `report_download` rate-limit bucket.** Both are reserved in the S2-20 contract. Today the listing/download endpoints rely on the existing in-process rate-limit middleware (per S1-13 baseline) and on the existing `report.dashboard_snapshot.*` audit events at generation time.
- **No full interactive browser-click smoke.** The S2-25.1 dev-server smoke covered the served SPA shell, the dev-served React modules (App.jsx, AppShell.jsx, ReportHistory.jsx, reportHistory.js), and the exact `fetch` URL/header contract the page builds for listing and downloading. Interactive DOM mount, button click, and the `<a download>` trigger were skipped because no headless-browser tool is available in this execution environment. The existing helper unit-test suite covers the helper behaviors used by the page; a future task (S2-27 below) can drive a real browser pass.
- **Pre-existing Browserslist build warning.** Unchanged.
- **Fixture rows remain in MongoDB by convention.** S2-22.1 (`d4a99c3d…`) and S2-24.1 (`02c0f77c…`) `report_runs` rows under `s2-15-fixture-org` are not removed because no safe delete route exists. Same convention as the S2-15 / S2-16.1 / S2-17.1 / S2-22.1 / S2-23.1 / S2-24.1 fixtures.
- **Cross-user shared access to imported Google locations is still blocked by the existing owned-location guard.** Membership-aware checks run after that guard on GBP location-bound paths.

## 7. Recommended Next Tasks

Conservative, phase-aware sequencing. Phase 2 work remains blocked until this closeout is explicitly accepted.

- **S2-27 (optional)** — Manual / visual browser click smoke for `/reports/history`. A human (or a future agent equipped with a headless browser) drives login, organization selection, filter apply, download click for the S2-22.1/S2-24.1 fixture rows, an inline error display (e.g. by signing in as a `manager` against the org-level row), and visual confirmation that the page renders inside `AppShell` with the `Reports` nav active. Docs/proof only; no code changes expected.
- **S2-28** — Persistent storage environment + deployment hardening. Document and apply a non-`/tmp` `REPORT_STORAGE_LOCAL_DIR` for any deployed environment, add `ensureIndexes`-equivalent startup checks for the storage root (writable / inside the configured root / not a symlink-out), document a directory-permissions baseline, and add a follow-up risk note for hosts that wipe `/tmp` on reboot. Optional: a small startup-log line that records `storage_provider="local"` and a redacted root (e.g. `/<persistent-root>/parametrics/report-outputs`) without exposing the absolute path in responses.
- **S2-29** — Report audit / rate-limit hardening. Add the reserved `report.run.list`, `report.run.read`, and `report.output.download` audit events and the dedicated `report_list` / `report_download` rate-limit buckets behind the existing audit and rate-limit helpers. Compact metadata only; no full payloads. Add per-bucket smoke coverage.
- **S2-30** — Optional report detail / regenerate contract. Either (a) add a frontend `/reports/history/:runId` detail page with the existing listing fields plus a per-output `Download <FORMAT>` button, or (b) add the S2-20-design `POST /api/v1/reports/runs/:runId/regenerate` route (synchronous fallback only until a queue exists; never mutates the source run). Docs/design only first, implementation gated on acceptance.
- **Phase 2 provider adapter layer** — remains blocked until this S2-26 closeout is explicitly accepted by GPT and the human. Future Phase 2 work should start with an adapter contract task that does not change current GBP behavior.

## 8. Explicit Non-Goals

S2-26 does **not**:

- Add Phase 2 integrations or any new provider channel.
- Add report queues, workers, schedulers, durable cloud storage, signed URLs, retention enforcement, scheduled/recurring reports, email delivery, or dashboard-builder behavior.
- Add a frontend report detail page, a regenerate button, or cursor pagination UI.
- Add or modify backend routes, services, middleware, dependencies, or `package-lock.json`.
- Add or modify frontend code or `apps/web/package.json`.
- Add or modify auth/JWT/provider behavior, member-management services, RBAC middleware, billing/entitlements, Google location binding behavior, or `location_org_map` canonicality.
- Start API/worker/scheduler runtime, run destructive scripts, or commit/push.
- Print or record JWTs, OAuth tokens, refresh tokens, ID tokens, auth codes, authorization headers, encrypted secrets, raw provider payloads, raw user records, passwords, or emails.

## GPT Verification

GPT decision: Pass.

The Sprint 2 report foundation proof pack was verified after docs-only closeout review, API npm test, web tests, web build, no-source-diff checks, no-lockfile-diff checks, and diff checks.
