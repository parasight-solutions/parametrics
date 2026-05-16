# S2-28 Report Storage Env Hardening Proof Pack

Date: 2026-05-16

## 1. Scope And Decision

S2-28 adds a startup-time configuration validator for the local report output storage adapter so production-like environments cannot silently fall back to `<os.tmpdir()>/parametrics/report-outputs`. The new `validateReportStorageConfig({ env, cwd, fsImpl })` helper lives in `apps/api/src/services/reportStorage.js` and is invoked from `apps/api/src/server.js` before `ensureIndexes()` and `app.listen()`. On any validation failure the API logs a compact `[report_storage] startup validation failed: <code>: <message>` line and exits non-zero. On success it logs only a redacted `safeRootLabel` (`<persistent-root>/<basename>` or `<os-tmpdir>/parametrics/report-outputs`); the absolute root is never logged or returned to clients.

The S2-22 storage adapter behavior is unchanged: `writeOutput`/`readOutput`/`statOutput`/`deleteOutput`, storage key safety (`isUnsafeStorageKey` / `resolveSafePath`), `report_runs.outputs[]` metadata shape, and the listing/download API contracts all stay as-is. Worker and scheduler runtimes are unaffected — the validator is wired only into the API server entrypoint because reports are written/read only on the API runtime today.

No new dependencies were added. `package-lock.json` is unchanged. No frontend file changed. Phase 2 integrations remain blocked.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pass.

## 2. Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-2-report-foundation-proof-pack.md`
- `docs/proof/s2-22-durable-local-report-storage.md`
- `docs/proof/s2-22-1-durable-report-storage-live-smoke.md`
- `docs/proof/s2-24-1-report-output-download-live-smoke.md`
- `docs/architecture/report-history-and-storage.md`
- `docs/architecture/report-service.md`
- `docs/runtime/processes.md`

## 3. Files Changed

- `apps/api/src/services/reportStorage.js` — added `validateReportStorageConfig({ env, cwd, fsImpl })`, the constants `PRODUCTION_BLOCKED_ROOTS` (`["/", "/tmp", "/var/tmp"]`) and `STORAGE_WRITE_CHECK_FILENAME` (`.parametrics-storage-writable-check`), and small private helpers `isLocalNodeEnv` / `defaultRepoRoot` / `isPathInside` / `isBlockedProductionRoot` / `redactedRootLabel`. The existing `STORAGE_PROVIDER_LOCAL` / `SUPPORTED_STORAGE_FORMATS` / `getDefaultLocalStorageRoot` / `buildStorageKey` / `isUnsafeStorageKey` / `createLocalReportStorage` / `getDefaultReportStorage` / `resetDefaultReportStorageForTests` exports are unchanged. The synchronous-fs interface used by the validator is injected through `fsImpl` (defaults to `node:fs`) so tests can drive every branch with a deterministic fake.
- `apps/api/src/services/reportStorage.test.js` — added 15 focused Node tests for the validator (Section 7). The 19 existing tests for `buildStorageKey` / `isUnsafeStorageKey` / `getDefaultLocalStorageRoot` / `createLocalReportStorage` remain green.
- `apps/api/src/server.js` — imported `validateReportStorageConfig` and inserted a synchronous validation step just before `ensureIndexes()`. On success: a single `[report_storage] provider=<...> configured=<...> production=<...> root=<safe-label>` log line. On failure: `[report_storage] startup validation failed: <code>: <message>` followed by `process.exit(1)`.
- `docs/architecture/report-history-and-storage.md` — added an "S2-28 Storage Config Hardening Note" section describing the rule set, the production/development behavior, and the redacted-logging contract.
- `docs/architecture/report-service.md` — added an "S2-28 Report Storage Env Hardening" section with the deployment-owned persistent path recommendation and the explicit "no behavior change" guarantee for the existing endpoints.
- `docs/runtime/processes.md` — added a `REPORT_STORAGE_LOCAL_DIR` entry to the Required API Environment section, documenting required production env, the development fallback, the directory permission baseline (owned by app runtime user, not world-writable, outside repo, persistent disk), the recommended deployment value (`/var/lib/parametrics/report-outputs`), and the `/tmp`-cleanup non-recoverability note.
- `docs/codex/sprint-2-phase-1-guardrails.md` — added the S2-28 completion bullet to the active task list and a detailed completion paragraph to the per-task narrative section; Phase 2 remains blocked.
- `docs/proof/s2-28-report-storage-env-hardening.md` — this proof doc (new).

`apps/api/package.json` was not changed. `apps/web/src` was not changed. `apps/web/package.json` was not changed. `package-lock.json` is unchanged.

## 4. Production Behavior

When `NODE_ENV` is neither `development` nor `test`:

- `REPORT_STORAGE_LOCAL_DIR` is required. Missing or empty value ⇒ `report_storage_config_missing_root`. The API exits non-zero with a compact `[report_storage] startup validation failed: report_storage_config_missing_root: …` line.
- `REPORT_STORAGE_LOCAL_DIR` is validated as a string. Non-string values (e.g. exported numbers from a misconfigured process manager) ⇒ `report_storage_config_invalid_env_type`.
- The path must be absolute (`path.isAbsolute(...)`). Relative paths ⇒ `report_storage_config_relative_root`.
- The resolved path must not be one of the blocked non-persistent system roots:
  - exactly `/`, or
  - exactly `/tmp` or any path under `/tmp/…`, or
  - exactly `/var/tmp` or any path under `/var/tmp/…`.
  Violations ⇒ `report_storage_config_blocked_root`. Reasoning: the S2-22.1 (`/tmp/parametrics-s2-22-1-report-storage`) files were already wiped between 2026-05-12 and 2026-05-16, so `/tmp` and `/var/tmp` are explicitly non-durable in production-like environments.
- The resolved path must not be inside the project root (computed from the `apps/api/src/services/reportStorage.js` file location by walking up four levels, with an optional override via the helper's `cwd` argument for tests). Violations ⇒ `report_storage_config_inside_repo`.
- If the path already exists it must be a directory, not a regular file (`report_storage_config_path_is_file`).
- If the path does not exist, it is created with `mkdirSync(p, { recursive: true })`. Creation failures ⇒ `report_storage_config_mkdir_failed`.
- The validator writes a `.parametrics-storage-writable-check` probe file and immediately removes it to verify the runtime user can write. Failures ⇒ `report_storage_config_not_writable`.
- On success the helper returns `{ provider: "local", configured: true, production: true, root: <abs>, safeRootLabel: "<persistent-root>/<basename>" }`. The startup log records only the flags and the redacted label.

The API never logs the absolute root. The download endpoint (S2-24) continues to never return absolute paths. The listing endpoint (S2-23) continues to expose `storage_key` as durable metadata only; the frontend page (S2-25) continues to strip it via `normalizeReportRunRow`.

## 5. Development Behavior

When `NODE_ENV=development` or `NODE_ENV=test`:

- `REPORT_STORAGE_LOCAL_DIR` is **optional**. If unset, the helper returns `{ configured: false, production: false, root: <os.tmpdir>/parametrics/report-outputs, safeRootLabel: "<os-tmpdir>/parametrics/report-outputs" }`. No directory is created and no probe is written; the storage adapter continues to lazily create the directory on the first `writeOutput`. The startup log records only the redacted label so the absolute tmpdir is not echoed.
- If `REPORT_STORAGE_LOCAL_DIR` **is** set in development, it is validated through the same shape rules (absolute, not relative, not a file, must be writable, may be a path under `/tmp` because the blocked-root rule is production-only). This lets the existing S2-22.1 / S2-24.1 / S2-25.1 smoke flows (`/tmp/parametrics-s2-XX-...`) continue to run without changes.
- The startup log line stays compact (`[report_storage] provider=local configured=<bool> production=<bool> root=<redacted>`), matching the existing one-line `[env]` log convention.

## 6. Validation Rules

| Rule | Code | When |
| --- | --- | --- |
| env required outside `development`/`test` | `report_storage_config_missing_root` | Production-like env and `REPORT_STORAGE_LOCAL_DIR` is missing or empty. |
| env must be a string when present | `report_storage_config_invalid_env_type` | The env value is not a string (defensive). |
| path must be absolute | `report_storage_config_relative_root` | Relative path. |
| path must not be a blocked system root | `report_storage_config_blocked_root` | Production-like env and resolved path is exactly `/`, exactly `/tmp`, under `/tmp/…`, exactly `/var/tmp`, or under `/var/tmp/…`. |
| path must not resolve inside the project root | `report_storage_config_inside_repo` | Resolved path is inside the computed repo root (or under the test-injected `cwd`). |
| existing path must be a directory, not a file | `report_storage_config_path_is_file` | `existsSync(p)` is true and `statSync(p).isDirectory()` is false. |
| existing-path stat failure surfaces compactly | `report_storage_config_stat_failed` | `statSync(p)` throws (rare; e.g. permission). |
| missing directory must be creatable | `report_storage_config_mkdir_failed` | `mkdirSync(p, { recursive: true })` throws. |
| runtime user must be able to write a probe file | `report_storage_config_not_writable` | `writeFileSync` / `unlinkSync` of the `.parametrics-storage-writable-check` file throws (e.g. EACCES). |

Storage key safety inside the adapter (`buildStorageKey`, `isUnsafeStorageKey`, `resolveSafePath`) is unchanged. Output metadata returned from `writeOutput` continues to omit absolute paths (`path: null`), credentials, and any storage-root literal. Adapter `readOutput` / `statOutput` / `deleteOutput` continue to reject unsafe storage keys and unsupported providers.

## 7. Startup / Config Wiring

`apps/api/src/server.js` runs the validator before `ensureIndexes()` and `app.listen()`:

```js
try {
  const reportStorageCfg = validateReportStorageConfig()
  console.log(
    `[report_storage] provider=${reportStorageCfg.provider}`,
    `configured=${reportStorageCfg.configured}`,
    `production=${reportStorageCfg.production}`,
    `root=${reportStorageCfg.safeRootLabel}`,
  )
} catch (error) {
  const code = error?.code || "report_storage_config_error"
  console.error(`[report_storage] startup validation failed: ${code}: ${error?.message || ""}`)
  process.exit(1)
}

ensureIndexes().then(() => {
  app.listen(port, () => console.log(`API listening on http://localhost:${port}`))
})
```

- The validator runs synchronously on the import-time startup environment loaded by `apps/api/src/startup/env.js` (which already sources `.env.local`, `.env`, and `apps/api/.env`). No change to `startup/env.js` was needed; the validator reads `process.env` defensively and accepts an injected `env` for tests.
- Worker (`apps/api/src/workers/index.js`) and scheduler (`apps/api/src/jobs/scheduler.js`) entrypoints are unchanged. Neither runtime writes or reads report storage today, so failing fast there would be incorrect and would break unrelated deployments. The validator is intentionally API-only.
- The validator does not start any HTTP listener; if it fails, `ensureIndexes()` and `app.listen()` are never reached.
- The startup log line is compact and never echoes the absolute root, env values, JWT secret, Mongo URI, or any other configuration value. The error log line only carries the validator's `code` and `message`; the validator never includes the env value or secret-bearing strings in its error messages (verified by a dedicated unit test).

## 8. Tests / Build / Checks

```bash
cd apps/api && node --check src/services/reportStorage.js
cd apps/api && node --check src/services/reportStorage.test.js
cd apps/api && node --check src/server.js
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --name-only -- apps/web/src apps/web/package.json package-lock.json
git diff --check
```

Outcomes:

- `node --check` of each changed file: OK.
- `cd apps/api && npm test`: `1..191 # tests 191 # pass 191 # fail 0 # skipped 0` (was 176; +15 from S2-28's new validator tests). The 15 new tests, run individually with `node --test src/services/reportStorage.test.js`, also report `1..34 / pass 34 / fail 0` (19 existing + 15 new).
- `cd apps/web && npm test -- --run`: `Test Files 5 passed (5) / Tests 49 passed (49)` (unchanged).
- `cd apps/web && npm run build`: `288 modules transformed. ✓ built in ~30s` (pre-existing Browserslist data-age warning unchanged).
- `git diff --name-only -- apps/web/src apps/web/package.json package-lock.json`: empty.
- `git diff --check`: no whitespace conflicts.

New test coverage (`apps/api/src/services/reportStorage.test.js`, 15 tests):

| # | Test | Covers |
| --- | --- | --- |
| 1 | returns tmp fallback in non-production when env is unset | dev fallback, redacted label, no env leak |
| 2 | fails in production when env is unset | `report_storage_config_missing_root` |
| 3 | rejects production `/tmp` root | `report_storage_config_blocked_root` (subpath under `/tmp`) |
| 4 | rejects production `/var/tmp` root | `report_storage_config_blocked_root` (subpath under `/var/tmp`) |
| 5 | rejects exact `/` production root | `report_storage_config_blocked_root` (exact root) |
| 6 | allows `/tmp` root in development | dev tolerance for the existing smoke flow |
| 7 | rejects a relative path | `report_storage_config_relative_root` |
| 8 | rejects a path inside the project root | `report_storage_config_inside_repo` (uses test `cwd` override) |
| 9 | passes for an existing writable directory outside the repo | happy path with persistent root |
| 10 | creates missing directory and passes | `mkdirSync` invocation + safe return |
| 11 | rejects a path that resolves to a file | `report_storage_config_path_is_file` |
| 12 | rejects a non-writable directory | `report_storage_config_not_writable` (probe write throws) |
| 13 | rejects non-string env values defensively | `report_storage_config_invalid_env_type` |
| 14 | error messages stay compact and never echo secrets | validates message length and absence of JWT/path substrings |
| 15 | safe label hides absolute path even when configured | redacted-label invariant |

The existing 19 tests (`buildStorageKey`, `isUnsafeStorageKey`, `getDefaultLocalStorageRoot`, `createLocalReportStorage` read/write/stat/delete, frozen adapter surface, etc.) still pass unchanged.

`apps/web/src/lib/reportHistory.test.js` (28 tests) and the other web test files (21 tests) are unaffected by S2-28.

## 9. Frontend Changes

No. No file under `apps/web/src` or `apps/web/package.json` was modified.

## 10. Package-Lock Changed

No.

## 11. Explicit Non-Goals

S2-28 intentionally does **not**:

- Add cloud storage adapters (S3 / GCS / Azure). The S2-20 contract reserves them behind the same `ReportStorageAdapter` surface.
- Add signed / short-lived download URLs. `expires_at` continues to be `null`.
- Add report queues, dedicated report workers, or scheduler changes. Generation remains synchronous on the API runtime.
- Add retention or cleanup of old `report_runs` rows / on-disk files.
- Change the listing API (S2-23) or the download API (S2-24) contract, response shape, or authorization rules.
- Change frontend code or `apps/web/package.json`.
- Install dependencies or modify `package-lock.json`.
- Add new audit events or rate-limit buckets (S2-29 is the reserved follow-up).
- Add or modify auth/JWT/provider behavior, RBAC middleware, billing/entitlements, `organization_members` rules, or `location_org_map` canonicality.
- Print or record JWTs, OAuth tokens, refresh tokens, ID tokens, auth codes, authorization headers, encrypted secrets, raw provider payloads, raw user records, passwords, emails, or absolute storage roots.
- Start API/worker/scheduler runtime as part of the smoke (only `node --check`, `npm test`, and `npm run build` were run).
- Commit or push.

## 12. Remaining Risks

- The validator uses `path.resolve` rather than `realpath` for the inside-repo and blocked-root checks. A symlink that redirects the configured root into the repo or into `/tmp` would not be detected. Production deployments should configure the env to a real path owned by the runtime user; the directory-permissions baseline in `docs/runtime/processes.md` already implies that. A future hardening task can add `realpath` resolution if symlink-attack-vectors become a real concern.
- The probe write/unlink check happens once at startup. It does not detect a subsequent disk-full or permission-revoked condition during normal operation. The download path already surfaces those as `500 report_output_read_failed` and write failures already mark the run failed with `report_storage_failed`.
- The validator runs only on the API entrypoint (`server.js`). Worker and scheduler runtimes do not currently consume report storage; a future task that introduces report queues/workers (the reserved `report-generate` queue from S2-20) should add a matching `validateReportStorageConfig` invocation in the worker entrypoint at that time.
- `/tmp`-backed historical rows are not recoverable. The S2-22.1 row (`d4a99c3d…`) is already broken; the S2-24.1 row (`02c0f77c…`) is also `/tmp`-backed in this local dev environment and will become broken on the next `/tmp` cleanup. Production deployments must set `REPORT_STORAGE_LOCAL_DIR` to a persistent path before relying on download history.
- Pre-existing Browserslist build warning is unchanged.
- Adapter behavior around concurrent writes to the same `storage_key` (same `run_id` regenerated twice) is unchanged; out of scope for S2-28.

## 13. Ready For GPT Verification

Yes. Working tree contains the validator + tests in `apps/api/src/services/reportStorage.js` / `reportStorage.test.js`, the small startup wiring in `apps/api/src/server.js`, the three docs updates (`docs/architecture/report-history-and-storage.md`, `docs/architecture/report-service.md`, `docs/runtime/processes.md`), the guardrails completion entry, and this proof doc. No frontend source, web package, or lockfile diff. All 191 API tests, all 49 web tests, and the web build pass. `git diff --check` is clean and `git diff --name-only -- apps/web/src apps/web/package.json package-lock.json` is empty. No API/worker/scheduler runtime was started.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-28 report storage env hardening was verified after validator tests, startup wiring review, API npm test, web tests, web build, no-frontend-diff checks, no-lockfile-diff checks, and diff checks.
