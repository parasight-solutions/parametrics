# S2-29 Report Audit / Rate-Limit Hardening Proof Pack

Date: 2026-05-16

## 1. Scope And Decision

S2-29 adds dedicated rate-limit buckets and dedicated audit events for the read-only report listing (S2-23) and report output download (S2-24) routes. Generation (S2-05 / `POST /api/v1/reports/dashboard-snapshot`) remains on its existing `generation` bucket and its existing `report.dashboard_snapshot.generate` audit events. The listing/download response shapes, headers, error codes, and authorization rules are unchanged; the only new wire-level behavior is that the documented `429 rate_limited` envelope can now fire from the new buckets. Audit emission is best-effort and cannot fail listing/download requests (the existing `writeAuditLog` try/catch guarantees this).

No frontend file changed. No dependency added. `package-lock.json` is unchanged. Phase 2 integrations remain blocked.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pass.

## 2. Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-2-report-foundation-proof-pack.md`
- `docs/proof/s2-28-report-storage-env-hardening.md`
- `docs/architecture/report-history-and-storage.md`
- `docs/architecture/report-service.md`
- `docs/runtime/processes.md`
- `apps/api/src/routes/reports.js`
- `apps/api/src/routes/reports.test.js`
- `apps/api/src/services/auditLog.js`
- `apps/api/src/middleware/rateLimit.js`

## 3. Files Changed

- `apps/api/src/middleware/rateLimit.js` — added `report_list` and `report_download` entries to `DEFAULT_LIMITS` (`120` and `60`) and `DEFAULT_ENV_KEYS` (`RATE_LIMIT_REPORT_LIST_MAX` and `RATE_LIMIT_REPORT_DOWNLOAD_MAX`), threaded the two new buckets through `resolveRateLimitConfig`, and exported `reportListRateLimit` / `reportDownloadRateLimit` via `createRateLimiter`. The existing `createRateLimiter`, `checkRateLimit`, `buildRateLimitKey`, `getClientIdentity`, the 429 response shape, the `Retry-After` / `X-RateLimit-*` headers, and the in-process `sharedStore` are unchanged.
- `apps/api/src/middleware/rateLimit.test.js` — added 3 new tests: defaults include `report_list: 120` and `report_download: 60`; env overrides `RATE_LIMIT_REPORT_LIST_MAX` / `RATE_LIMIT_REPORT_DOWNLOAD_MAX` flow through `resolveRateLimitConfig`; `createRateLimiter` builds the documented `report_list:user:<id>` / `report_download:user:<id>` keys and emits the same JSON 429 envelope when the bucket is exceeded.
- `apps/api/src/routes/reports.js` — imported `reportListRateLimit` / `reportDownloadRateLimit` from the rate-limit middleware; wired `reportListRateLimit` onto `GET /api/v1/reports/runs` and `reportDownloadRateLimit` onto `GET /api/v1/reports/runs/:runId/outputs/:format`; left the dashboard-snapshot route on its existing `generationRateLimit`. Added and exported the audit payload builders `compactListAuditFilters(query)`, `buildListAuditDetails(query, result)`, `buildListFailureAuditDetails(query, error)`, `buildDownloadAuditDetails({ runId, format, result })`, and `buildDownloadFailureAuditDetails({ runId, format, error })`. The listing handler now calls `auditSuccess(req, "report.run.list", buildListAuditDetails(query, result))` on success and `auditFailure(req, "report.run.list_failed", buildListFailureAuditDetails(query, mapped))` on failure; the download handler emits `report.output.download` and `report.output.download_failed` analogously. The route handlers stay thin. `downloadReportOutputForUser` was extended with additive return fields `organization_id`, `storage_provider`, `checksum_algorithm` so the audit payload can reference persisted output metadata without re-reading Mongo; existing fields (`buffer`, `content_type`, `filename`, `size`, `membership_role`) are unchanged.
- `apps/api/src/routes/reports.test.js` — added 9 new tests: 3 for router-stack wiring (`/runs` uses `reportListRateLimit`; download route uses `reportDownloadRateLimit`; dashboard-snapshot stays on `generationRateLimit`), 1 for `compactListAuditFilters`, 1 for `buildListAuditDetails`, 1 for `buildListFailureAuditDetails`, 2 for `buildDownloadAuditDetails` (happy path with sanitization scan; invalid format normalized to null), 1 for `buildDownloadFailureAuditDetails`, and 1 for the swallow-on-failure invariant of `writeAuditLog` (covers the "audit failure must not fail user request" requirement via a `req` whose `headers` accessor throws).
- `docs/architecture/report-history-and-storage.md` — added an "S2-29 Report Audit / Rate-Limit Hardening" section.
- `docs/architecture/report-service.md` — added an "S2-29 Report Audit / Rate-Limit Hardening" section.
- `docs/codex/sprint-2-phase-1-guardrails.md` — added S2-29 to the completed task list and a detailed completion paragraph; Phase 2 remains blocked.
- `docs/proof/s2-29-report-audit-rate-limit-hardening.md` — this proof doc (new).

No file under `apps/web/src` or `apps/web/package.json` was modified. `apps/api/package.json` was not modified (the existing focused `npm test` script already covers the changed test files). `apps/api/src/services/auditLog.js` was not modified — the existing `auditSuccess` / `auditFailure` / `writeAuditLog` / `sanitizeAuditMetadata` surface is sufficient for the new events. `package-lock.json` is unchanged.

## 4. Rate-Limit Behavior

| Route | Bucket | Default cap | Env override | Key |
| --- | --- | --- | --- | --- |
| `GET /api/v1/reports/runs` | `report_list` | `120` per `RATE_LIMIT_WINDOW_SECONDS` (default `600s`) | `RATE_LIMIT_REPORT_LIST_MAX` | `report_list:user:<user_id>` (falls back to `report_list:ip:<ip>` via `getClientIdentity`) |
| `GET /api/v1/reports/runs/:runId/outputs/:format` | `report_download` | `60` per window | `RATE_LIMIT_REPORT_DOWNLOAD_MAX` | `report_download:user:<user_id>` (IP fallback) |
| `POST /api/v1/reports/dashboard-snapshot` | `generation` (unchanged) | `20` per window | `RATE_LIMIT_GENERATION_MAX` (unchanged) | `generation:user:<user_id>` (unchanged) |

Behavior details:

- Both new buckets reuse the existing in-process `sharedStore`, the existing `createRateLimiter`, the existing `Retry-After` and `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers, and the existing `{ error: { code: "rate_limited", message, retry_after_seconds } }` 429 body. The 429 response shape is therefore identical to the rate-limited paths today.
- Defaults are conservative but generous enough for normal local development: `120` listings and `60` downloads per 10-minute window per user. A reviewer auto-refreshing the `/reports/history` page or downloading both PDF/XLSX for several runs stays well under the cap; a runaway client or compromised JWT will trip the bucket while leaving other users unaffected (per-user key).
- Env overrides follow the established `RATE_LIMIT_*` naming pattern documented in `docs/runtime/processes.md`. They are picked up by `resolveRateLimitConfig` at process start and applied through the existing config plumbing — no additional startup wiring was needed.
- Distributed (Redis-backed) rate limiting remains a separate Phase 0 hardening follow-up, as noted in `docs/runtime/processes.md`. The current in-process buckets give per-API-instance protection only.

## 5. Audit Behavior

Four new audit events, all best-effort via the existing `auditSuccess` / `auditFailure` helpers in `apps/api/src/services/auditLog.js`. Every metadata payload is built by a small exported pure helper so the contract is unit-testable without booting Express.

### `report.run.list` (success)

Triggered by `GET /api/v1/reports/runs` returning `200`.

```jsonc
{
  "action": "report.run.list",
  "status": "success",
  "target_type": "report_run",
  "organization_id": "<from-query>",
  "client_id": "<from-query|null>",
  "location_id": "<from-query|null>",
  "metadata": {
    "report_type": "<filter|omitted>",
    "report_key":  "<filter|omitted>",
    "status":      "<filter|omitted>",
    "date_from":   "<filter|omitted>",
    "date_to":     "<filter|omitted>",
    "limit":       <effective-limit>,
    "result_count": <returned-rows>,
    "has_more":     <bool>,
    "membership_role": "<resolved-role|null>"
  }
}
```

Filters are included only when the requester supplied them, so empty queries do not pollute the audit metadata. The effective `limit` mirrors what the listing API actually applied (after clamping). `result_count` and `has_more` come from the listing's pagination response; the rows themselves are not logged.

### `report.run.list_failed` (failure after auth/membership logic)

```jsonc
{
  "action": "report.run.list_failed",
  "status": "failure",
  "target_type": "report_run",
  "organization_id": "<from-query|null>",
  "client_id": "<from-query|null>",
  "location_id": "<from-query|null>",
  "metadata": {
    "report_type": "<filter|omitted>",
    "report_key":  "<filter|omitted>",
    "status":      "<filter|omitted>",
    "date_from":   "<filter|omitted>",
    "date_to":     "<filter|omitted>",
    "limit":       <parsed-or-null>,
    "reason": { "code": "<error.code>", "message": "<short-message>" },
    "status":  <http-status|null>
  }
}
```

`reason` reuses the existing compact `{ code, message }` shape (capped strings). The original `error.data` payload is never serialized into the audit metadata.

### `report.output.download` (success)

Triggered by `GET /api/v1/reports/runs/:runId/outputs/:format` returning raw bytes with `200`.

```jsonc
{
  "action": "report.output.download",
  "status": "success",
  "target_type": "report_run_output",
  "target_id": "<run_id>",
  "organization_id": "<run.organization_id>",
  "metadata": {
    "report_run_id": "<run_id>",
    "format": "pdf|xlsx",
    "size":   <bytes>,
    "content_type": "<application/pdf|application/vnd.openxml...>",
    "storage_provider": "local",
    "checksum_algorithm": "sha256",
    "membership_role": "<owner|admin|manager|viewer>"
  }
}
```

Explicit non-fields (verified by unit tests with `JSON.stringify` scans): `storage_key`, `filename`, `path`, `buffer`, `base64`, absolute paths, `/tmp/...`, `/var/www/...`, the storage root literal, the run document body, and the persisted `input_snapshot` are never present.

### `report.output.download_failed` (failure after auth/membership logic)

```jsonc
{
  "action": "report.output.download_failed",
  "status": "failure",
  "target_type": "report_run_output",
  "target_id": "<run_id|null>",
  "metadata": {
    "report_run_id": "<run_id|null>",
    "format": "pdf|xlsx|null",
    "reason": { "code": "<error.code>", "message": "<short-message>" },
    "status": <http-status|null>
  }
}
```

`format` is normalized to lowercase and validated against `REPORT_DOWNLOAD_FORMATS = ["pdf","xlsx"]`. Unsupported / arbitrary values supplied by the requester (e.g. `csv`) are recorded as `null` rather than echoed verbatim, so the audit payload cannot be used as a free-text injection vector.

### Audit failure is best-effort

Every audit call goes through the existing `writeAuditLog` helper in `apps/api/src/services/auditLog.js`, which wraps the entire body in `try/catch` and logs `[audit] write failed` to `console.error` on failure. The new test "writeAuditLog (used by report routes) swallows errors so route handlers cannot fail because of audit" exercises this path by passing a `req` whose `headers` accessor throws synchronously: the `writeAuditLog` call resolves (no rejection) and the failure is logged to the captured `console.error` collector. This proves listing/download routes cannot 500 because of an audit emission problem.

## 6. Sanitization / No-Secret Guarantees

- The new audit payload builders only carry the fields documented in Section 5. The download builder explicitly never propagates `storage_key`, `filename`, `path`, `buffer`, or `base64`; the listing builder never propagates raw rows. Unit tests confirm with `JSON.stringify(...)` scans that the serialized payloads do not contain `storage_key`, `report-outputs/`, `buffer`, `base64`, `filename`, `/tmp/`, `/var/www/`, or `absolute`.
- All audit payloads are then passed through the existing `sanitizeAuditMetadata` pipeline before being persisted, which redacts any key matching the existing `password|secret|token|jwt|authorization|auth_code|code|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secrets_json` regex and caps depth/length. Secret-bearing fields cannot enter audit metadata even if a future caller passes them in.
- The `format` field is normalized to `pdf|xlsx|null` before it leaves the route, so arbitrary strings supplied via `:format` cannot escape into audit metadata.
- The `reason` field always uses the compact `{ code, message }` shape (already capped strings). Original `error.data` / stack traces are never serialized.
- Listing filter strings appear in the audit metadata only when the requester supplied them; empty queries do not pollute the log. Each filter value is trimmed and capped via the existing `cleanStr` helper (max 40–160 chars depending on field).
- The listing/download routes never call audit with `organization_id` derived from the run body — only from the request query (listing) or the requester-supplied run id resolved through `getReportRunById` (download). No user emails, raw user records, raw Mongo documents, JWTs, OAuth tokens, encrypted secrets, or storage roots are referenced by any audit payload.

## 7. Tests / Build / Checks

```bash
cd apps/api && node --check src/routes/reports.js
cd apps/api && node --check src/routes/reports.test.js
cd apps/api && node --check src/middleware/rateLimit.js
cd apps/api && node --check src/middleware/rateLimit.test.js
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --name-only -- apps/web/src apps/web/package.json package-lock.json
git diff --check
```

Outcomes:

- `node --check` of each changed file: OK.
- `cd apps/api && npm test`: `1..203 # tests 203 # pass 203 # fail 0 # skipped 0` (was 191 at S2-28; +12 new tests covering the three router-stack wiring assertions, the five audit-detail builder cases, the three rate-limit middleware cases, and the writeAuditLog swallow-on-failure case).
- `cd apps/web && npm test -- --run`: `Test Files 5 passed (5) / Tests 49 passed (49)` (unchanged).
- `cd apps/web && npm run build`: `288 modules transformed. ✓ built in ~38s` (pre-existing Browserslist data-age warning unchanged).
- `git diff --name-only -- apps/web/src apps/web/package.json package-lock.json`: empty.
- `git diff --check`: no whitespace conflicts.

Working-tree files for this task (`git status --short`):

- `M apps/api/src/middleware/rateLimit.js`
- `M apps/api/src/middleware/rateLimit.test.js`
- `M apps/api/src/routes/reports.js`
- `M apps/api/src/routes/reports.test.js`
- `M docs/architecture/report-history-and-storage.md`
- `M docs/architecture/report-service.md`
- `M docs/codex/sprint-2-phase-1-guardrails.md`
- `?? docs/proof/s2-29-report-audit-rate-limit-hardening.md`

No backend, frontend, or storage adapter behavior changed outside the rate-limit/audit wiring on the listing and download routes, the new audit-detail builders, and the additive return fields on `downloadReportOutputForUser`. No new dependency installed.

## 8. Frontend Changes

No.

## 9. Package-Lock Changed

No.

## 10. Explicit Non-Goals

S2-29 intentionally does **not**:

- Change the listing API response shape, the download API response shape, the download header set, or any error code.
- Add Redis-backed distributed rate limiting. The current in-process limiter remains; per-API-instance protection only.
- Add a report detail endpoint, the optional regenerate endpoint, signed URLs, cloud storage adapters, retention/cleanup, or scheduled cleanup.
- Add audit events outside the listing and download flows (the dashboard-snapshot route keeps its existing `report.dashboard_snapshot.generate` events unchanged).
- Add a frontend audit log viewer or rate-limit-aware UI affordances.
- Modify `apps/api/package.json`, install dependencies, or change `package-lock.json`.
- Start API/worker/scheduler runtime as part of the smoke (only `node --check`, `npm test`, and `npm run build` were run).
- Modify auth/JWT/provider behavior, member-management services, RBAC middleware, billing/entitlements, GBP behavior, `organization_members` rules, `location_org_map` canonicality, or storage key safety.
- Print or record JWTs, OAuth tokens, refresh tokens, ID tokens, auth codes, authorization headers, encrypted secrets, raw provider payloads, raw user records, passwords, emails, storage roots, raw snapshots, raw buffers, base64, or raw Mongo docs.

## 11. Remaining Risks

- Rate-limit defaults (`120` listings, `60` downloads per 10-minute window per user) are heuristic. They are conservative enough to absorb a `/reports/history` browsing session but might be tight for an integration that lists/downloads many rows in bulk. Operators can raise the cap via `RATE_LIMIT_REPORT_LIST_MAX` / `RATE_LIMIT_REPORT_DOWNLOAD_MAX` without code changes.
- The rate-limit store is in-process per API instance (the existing Phase 0 baseline). Multi-instance deployments will see independent buckets per process until Redis-backed distributed limiting lands as a separate hardening task.
- Audit emission failures are swallowed by `writeAuditLog`'s try/catch and are only visible via the `[audit] write failed` `console.error` line; ops dashboards that surface stderr will still see them, but there is no dedicated metric. A future task could add a counter.
- The listing audit metadata includes the requester-supplied filter strings verbatim (after the existing `cleanStr` cap of 40–160 chars and after the `sanitizeAuditMetadata` redaction pass). A future hardening task may add per-field normalization (e.g. lowercased `status`) if downstream analytics need it.
- Per-bucket telemetry (`rate_limited` event counts, who hit the limit, retry-after distribution) is not collected. Rate-limit events are not written to audit logs in S1-13 to avoid noisy logs from unauthenticated probes; that decision is unchanged here.
- The download audit reports the persisted `size`, `content_type`, `storage_provider`, and `checksum_algorithm` returned by `downloadReportOutputForUser`. It does not include the persisted `checksum.value` because the checksum hex would needlessly inflate audit storage; integrity is already verified by the route before bytes reach the client.
- Pre-existing Browserslist build warning is unchanged.

## 12. Ready For GPT Verification

Yes. Working tree contains the new rate-limit buckets + tests in `apps/api/src/middleware/rateLimit.js` / `rateLimit.test.js`, the new audit-detail builders + wiring + tests in `apps/api/src/routes/reports.js` / `reports.test.js`, the two architecture doc updates (`docs/architecture/report-history-and-storage.md`, `docs/architecture/report-service.md`), the guardrails completion entry, and this proof doc. No frontend source, web `package.json`, or lockfile diff. All 203 API tests, 49 web tests, and the web build pass. `git diff --check` is clean and `git diff --name-only -- apps/web/src apps/web/package.json package-lock.json` is empty.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-29 report audit and rate-limit hardening was verified after route/rate-limit/audit tests, API npm test, web tests, web build, no-frontend-diff checks, no-lockfile-diff checks, sanitization review, and diff checks.
