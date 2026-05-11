# S2-22 Durable Local Report Output Storage Proof Pack

Date: 2026-05-11

## 1. Scope And Decision

S2-22 implements the first cut of the durable report output storage adapter described in S2-20. It introduces a local-filesystem `ReportStorageAdapter` and wires the existing synchronous `POST /api/v1/reports/dashboard-snapshot` route to write each generated output to durable local storage. The response `files[]` base64 shape is preserved for compatibility. Listing, run-detail, download, regenerate routes, cloud storage adapters, signed URLs, retention enforcement, and report history UI all remain future work.

Phase 2 integrations remain blocked. No frontend code changed.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pending.

## 2. Docs Read / Files Inspected

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/README.md`
- `docs/codex/task-template.md`
- `docs/codex/verification-checklist.md`
- `docs/codex/local-proof-pack.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-2-closeout-proof-pack.md`
- `docs/proof/s2-19-api-test-script.md`
- `docs/proof/s2-20-report-history-storage-contract.md`
- `docs/runtime/processes.md`
- `docs/architecture/report-service.md`
- `docs/architecture/report-history-and-storage.md`
- `apps/api/package.json`
- `apps/api/src/server.js` (`/api/v1/reports` mount)
- `apps/api/src/routes/reports.js` (existing route + audit codes)
- `apps/api/src/routes/reports.test.js` (existing route tests; shape of memory collections)
- `apps/api/src/services/reportService.js` (pending/succeeded/failed output helpers)
- `apps/api/src/services/reportStore.js` (`normalizeOutputs` shape, lifecycle helpers)
- `apps/api/src/services/reportStore.test.js` (existing reportStore coverage)
- `apps/api/src/services/reportPdf.js`, `apps/api/src/services/reportXlsx.js` (output result shape)

## 3. Files Changed

- `apps/api/src/services/reportStorage.js` — new local-filesystem storage adapter module.
- `apps/api/src/services/reportStorage.test.js` — new focused tests for the adapter (key building, path safety, write/read/stat/delete, error codes, frozen surface).
- `apps/api/src/routes/reports.js` — added `persistOutputsToStorage` step; injected storage via `deps.reportStorage` with a default `getDefaultReportStorage()` fallback; preserved the existing response shape; preserved the existing failure flow.
- `apps/api/src/routes/reports.test.js` — added `memoryStorage` helper, new tests for durable storage metadata persistence and storage-failure handling, and injected `reportStorage` (memory or `null`) into existing tests so they remain deterministic and do not touch the real filesystem.
- `apps/api/src/services/reportStore.js` — extended `normalizeOutputs` so persisted `report_runs.outputs[]` entries include `storage_provider`, `storage_key`, `content_type`, `filename`, `checksum`, `generated_at`, and `expires_at` in addition to the existing fields. `path` continues to default to `null`. Added a small `normalizeChecksum` helper.
- `apps/api/package.json` — extended the `test` script argv list to include `src/services/reportStorage.test.js`. No dependency or `package-lock.json` change.
- `docs/architecture/report-history-and-storage.md` — added an S2-22 implementation note explaining that the adapter and route wiring are implemented while listing/download remain future.
- `docs/architecture/report-service.md` — added an S2-22 durable storage section documenting the new persisted output fields, the unchanged base64 response, and the explicit out-of-scope items.
- `docs/codex/sprint-2-phase-1-guardrails.md` — added an S2-22 completion line and a detailed completion paragraph; Phase 2 remains blocked.
- `docs/proof/s2-22-durable-local-report-storage.md` — this proof doc (new).

No frontend source files changed. No `apps/web/package.json`, `apps/web/src`, or `package-lock.json` change. No new dependencies installed.

## 4. Storage Adapter Behavior

Module: `apps/api/src/services/reportStorage.js`.

Public surface:

- `STORAGE_PROVIDER_LOCAL = "local"`
- `SUPPORTED_STORAGE_FORMATS = ["pdf", "xlsx"]`
- `getDefaultLocalStorageRoot(env)` — returns `env.REPORT_STORAGE_LOCAL_DIR` when set, else `<os.tmpdir()>/parametrics/report-outputs`.
- `buildStorageKey({ organization_id, run_id, format, now })` — returns `report-outputs/<organization_id>/<YYYY>/<MM>/<run_id>.<format>` (UTC year/month). Rejects invalid ids/format/empty values with codes `report_storage_invalid_id`, `report_storage_unsupported_format`.
- `isUnsafeStorageKey(key)` — pure boolean helper used by `read/stat/delete`.
- `createLocalReportStorage({ root?, fs?, env? })` — frozen adapter exposing `provider: "local"`, `root` (absolute), `writeOutput`, `readOutput`, `statOutput`, `deleteOutput`.
- `getDefaultReportStorage()` / `resetDefaultReportStorageForTests()` — lazy singleton for runtime use.

Adapter behavior:

- `writeOutput({ organization_id, run_id, format, content_type, filename, buffer, now })`:
  - Rejects empty/missing buffer (`report_storage_empty_buffer`) and buffers > 25 MB (`report_storage_buffer_too_large`).
  - Rejects missing/invalid `content_type` (`report_storage_invalid_content_type`).
  - Rejects unsafe filenames (`report_storage_invalid_filename`).
  - Builds a safe storage key and resolves the absolute path under the configured root.
  - Confirms the resolved path stays inside the root using `path.relative` (rejects with `report_storage_invalid_key` otherwise).
  - Creates parent directories with `recursive: true` and writes the buffer.
  - Reads the file back to compute size and sha256 checksum, so the persisted checksum corresponds exactly to the bytes on disk.
  - Returns `{ storage_provider, storage_key, content_type, filename, size, checksum: { algorithm: "sha256", value }, generated_at, expires_at: null }`. No absolute path, no adapter credential, no buffer.
- `readOutput({ storage_provider, storage_key })` — returns a `Buffer` for callers that need it (tests and the future download route). Rejects non-`local` providers (`report_storage_unsupported_provider`) and unsafe keys (`report_storage_invalid_key`).
- `statOutput(...)` — returns `{ exists, size }`. Reports `{ exists: false, size: null }` on `ENOENT`; other fs errors bubble.
- `deleteOutput(...)` — returns `{ deleted: true }` on success, `{ deleted: false }` on `ENOENT`. Other fs errors bubble.
- Storage root for the adapter instance is resolved to an absolute path; all read/write resolution happens against that absolute root.

Forbidden behavior verified by tests:

- Storage keys may not contain `..`, leading `/`, `\`, NUL bytes, dot segments, or empty segments.
- The returned metadata object never includes `path`, `absolute_path`, or any key matching `/root/`.
- The first-cut `readOutput` returns a `Buffer`; the future download route (S2-24) may rename it to `readOutputStream` returning a stream without changing on-disk layout or persisted metadata. This deviation is documented in `docs/architecture/report-history-and-storage.md`.

## 5. Route Behavior

Module: `apps/api/src/routes/reports.js`.

Changes:

- `generateOutputs(...)` now also returns the original `buffers[]` (index-aligned with `outputs[]`) so the downstream storage step has the bytes it needs.
- New `persistOutputsToStorage(reportRun, generated, storage, options)` (exported for future reuse/tests):
  - For each succeeded output with a buffer, calls `storage.writeOutput({ organization_id, run_id, format, content_type, filename, buffer, now })`.
  - On success, merges `storage_provider`, `storage_key`, `content_type`, `filename`, `size`, `checksum`, `generated_at`, `expires_at` onto the output.
  - On failure, marks the output `failed` with `error.code = "report_storage_failed"` (defaulted) and `completed_at = now`. Other outputs from the same run can still succeed.
- New `resolveStorageAdapter(deps)`:
  - `deps.reportStorage = null` ⇒ no storage (used by tests that don't reach the storage step).
  - `deps.reportStorage = <adapter>` ⇒ used directly (tests inject `memoryStorage`).
  - Otherwise ⇒ `getDefaultReportStorage()` lazily constructs the default local adapter.
- The main flow now reads:
  ```js
  const generated = await generateOutputs(reportRun, deps, { now, maxTotalFileBytes });
  const storage = resolveStorageAdapter(deps);
  outputs = await persistOutputsToStorage(reportRun, generated, storage, { now });
  if (hasFailedOutput(outputs)) { throw makeError(500, "report_generation_failed", ...); }
  const persistedRun = await markReportRunSucceeded(run.id, { ..., outputs });
  ```
- Response shape unchanged: `{ report_run, outputs, files }` with `files[]` items `{ format, filename, content_type, base64, size }`. Generated PDF/XLSX buffers are still never stored in MongoDB.
- Failure flow unchanged: if any output is failed (generation or storage), `markReportRunFailed` records the failure with the existing compact error shape and the route surfaces `500 report_generation_failed`. Successful outputs from the same run remain on disk.
- Audit metadata unchanged: existing `report.dashboard_snapshot.generate` audit events continue to include `target_id`, `organization_id`, `client_id`, `location_id`, `report_key`, `requested_formats`, counts, role, and outcome. Storage keys are not added to audit metadata.

Module: `apps/api/src/services/reportStore.js`.

Changes:

- `normalizeOutputs` now also preserves `storage_provider`, `storage_key`, `content_type`, `filename`, `checksum`, `generated_at`, `expires_at`. `path` continues to default to `null` so absolute server paths can never leak through persistence. Generated raw buffers and base64 are still never persisted.

## 6. Env / Default Storage Root Behavior

- `REPORT_STORAGE_LOCAL_DIR` (new optional env): when set, the adapter root resolves to this exact path (absolute or relative to the API process's CWD). The directory is created on first write with `fs.mkdir({ recursive: true })`.
- When `REPORT_STORAGE_LOCAL_DIR` is unset, the adapter root is `<os.tmpdir()>/parametrics/report-outputs`. The OS temp directory is chosen deliberately so:
  - The default never writes inside the git working tree.
  - Local development works without configuration.
  - CI and ephemeral environments can clean up via the existing temp directory lifecycle.
- Tests do not rely on the default; every test passes an explicit `root` (typically via `fs.mkdtemp(...)`) and cleans up with `fs.rm({ recursive: true, force: true })`.
- No new required environment variable was introduced. `apps/api/src/startup/env.js` and `apps/api/src/config.js` were not modified because the adapter reads `process.env.REPORT_STORAGE_LOCAL_DIR` directly inside `getDefaultLocalStorageRoot`, which keeps the surface area for S2-22 minimal. Future tasks (e.g., S2-23/S2-24) may centralize this in `config.js` if a non-default value is required at startup.

## 7. Tests Run

```bash
cd apps/api && node --check src/services/reportStorage.js
cd apps/api && node --check src/services/reportStorage.test.js
cd apps/api && node --check src/services/reportStore.js
cd apps/api && node --check src/routes/reports.js
cd apps/api && node --check src/routes/reports.test.js
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
```

Results:

- `node --check` of each changed/new JS file: OK.
- `cd apps/api && npm test`: `1..135 # tests 135 # pass 135 # fail 0 # skipped 0 # duration_ms ~10299`. Coverage includes:
  - 16 new tests in `src/services/reportStorage.test.js` (key building, path safety, env/default root, pdf/xlsx write, empty buffer / missing content_type / invalid filename / unsupported format / invalid ids rejection, read/stat/delete roundtrip, unsupported provider rejection, unsafe-key rejection on read/stat/delete, frozen public surface).
  - 2 new tests in `src/routes/reports.test.js` (`generateDashboardSnapshotReport persists durable storage metadata on each succeeded output`, `generateDashboardSnapshotReport marks run failed when storage write fails`).
  - All previously verified tests still pass after the storage step was added (existing route tests inject `memoryStorage` or `reportStorage: null` so they remain deterministic and do not touch the real filesystem).
- `cd apps/web && npm test -- --run`: `Test Files 4 passed (4) / Tests 21 passed (21)`.
- `cd apps/web && npm run build`: `286 modules transformed. ✓ built in ~34s`. The pre-existing Browserslist data-age warning is unchanged.

Scope/whitespace verification:

```bash
git diff --name-only -- apps/web/src apps/web/package.json package-lock.json
```

No output. Web sources, the web package manifest, and the workspace lockfile are all untouched.

```bash
git diff --check
```

No output. No whitespace conflicts.

```bash
git status --short
```

```
 M apps/api/package.json
 M apps/api/src/routes/reports.js
 M apps/api/src/routes/reports.test.js
 M apps/api/src/services/reportStore.js
 M docs/architecture/report-history-and-storage.md
 M docs/architecture/report-service.md
 M docs/codex/sprint-2-phase-1-guardrails.md
?? apps/api/src/services/reportStorage.js
?? apps/api/src/services/reportStorage.test.js
?? docs/proof/s2-22-durable-local-report-storage.md
```

## 8. Package-Lock Changed

No. `package-lock.json` was not modified. No dependencies were installed or upgraded. Only the `test` script argv list inside `apps/api/package.json` changed.

## 9. Frontend Changes

No. No file under `apps/web/src` or `apps/web/package.json` was modified. The frontend dashboard report action continues to consume the existing base64 `files[]` response unchanged.

## 10. Remaining Risks

- Storage write happens after generation but synchronously inside the request lifecycle. A slow disk could increase response time slightly for large outputs. Existing per-output and per-response size caps still apply.
- The default storage root lives under `<os.tmpdir()>/parametrics/report-outputs`. On hosts that wipe `/tmp` on reboot, durable outputs may disappear between restarts. Production deployments must set `REPORT_STORAGE_LOCAL_DIR` to a persistent location, or wait for the future cloud adapter task.
- There is no retention/expiry enforcement yet. Stored files accumulate forever until an operator deletes them. A future scheduler/cleanup task can iterate `report_runs.outputs[]` and delete expired storage keys.
- `readOutput` returns a `Buffer` rather than the `ReadableStream` contract from S2-20. The future download route (S2-24) may need to rename/extend this method to stream large files; that change does not affect on-disk layout or persisted metadata.
- No cross-process locking on writes. Concurrent writes for the same `(organization_id, run_id, format)` would race on the same key. In practice run ids are unique per generation, so this is not a current correctness risk.
- `REPORT_STORAGE_LOCAL_DIR` is read at the time `getDefaultReportStorage()` first runs and cached for the API process lifetime. Changing the env var requires an API restart.
- No new audit event was added. Storage successes/failures still surface through the existing `report.dashboard_snapshot.generate` audit codes plus the per-output `error.code = "report_storage_failed"` recorded in `report_runs`. A dedicated `report.output.write` audit event is documented in S2-20 as future-but-optional and was not added here.
- Pre-existing Browserslist build warning is unchanged.
- No live API/Mongo smoke was run as part of S2-22; unit tests cover the route, adapter, and store. A live smoke against a running API and MongoDB (creating a real `report_runs` doc and verifying the file lands on disk) remains a recommended follow-up before relying on storage durability in any deployed environment.

## 11. Ready For GPT Verification

Yes. Working tree contains only the S2-22 backend storage adapter, route wiring, store-shape extension, focused tests, package test-script update, architecture/guardrails doc updates, and this proof doc. No frontend source, web package, or lockfile diff. No API/worker/scheduler service was started. No destructive scripts ran. No new dependency was installed. All API and web tests and the web build pass.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-22 durable local report storage implementation was verified after storage adapter tests, report route tests, API npm test, web tests, web build, no-frontend-diff checks, no-lockfile-diff checks, and diff checks.
