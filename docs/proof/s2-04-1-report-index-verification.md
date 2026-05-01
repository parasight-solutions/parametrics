# S2-04.1 Report Index Verification

Date: 2026-05-01

## Scope

S2-04.1 verified report persistence indexes against the configured MongoDB environment before report routes are added.

This was verification-first work. No public report routes, queues, workers, scheduler changes, frontend work, email, Phase 2 providers, or report PDF/XLSX behavior changes were added.

## Pre-Change Working Tree

Command:

```bash
git status --short
```

Result:

```text
?? .codex
```

Tracked files were clean before S2-04.1 changes. The untracked `.codex` entry was pre-existing and was not touched.

## Commands Run

Syntax checks:

```bash
cd apps/api && node --check src/startup/ensureIndexes.js
cd apps/api && node --check src/services/reportStore.js
cd apps/api && node --check src/services/reportStore.test.js
```

Result: passed with no output.

Focused tests:

```bash
cd apps/api && node --test src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
```

Result:

```text
1..8
# tests 8
# suites 0
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Live Mongo index verification:

```bash
node --input-type=module -e "<import ensureIndexes, run it, list reports/report_runs indexes, verify expected names, exit>"
```

The first attempt was blocked by sandbox network/DNS access. The command was rerun with approved network access.

## Mongo Target

Mongo target was the configured Atlas-style MongoDB connection.

Redacted summary:

```text
mongodb+srv://***:***@cluster0.l9tto5f.mongodb.net/parametrics?... db=parametrics
```

No credentials or secret environment values were printed.

## Index Creation Result

Initial live verification exposed a real startup/index bug:

```text
ns does not exist: parametrics.reports
```

Cause: `ensureIndex(...)` called `listIndexes()` before the new `reports` collection existed. MongoDB can return `NamespaceNotFound` for that path.

Fix applied: `listIdx(...)` in `apps/api/src/startup/ensureIndexes.js` now treats `NamespaceNotFound` / `ns does not exist` as an empty index list, allowing `createIndex(...)` to create the missing collection.

After the fix, live index creation passed.

## Reports Indexes Verified

Verified present:

- `_id_`
- `uniq_reports_id`
- `uniq_reports_org_client_location_key`
- `uniq_reports_org_client_key`
- `uniq_reports_org_key`
- `idx_reports_org_updated_at`
- `idx_reports_client_updated_at`
- `idx_reports_location_updated_at`
- `idx_reports_status_updated_at`

Expected missing indexes after verification:

```json
[]
```

The split scoped `report_key` indexes were verified with partial filters for location, client, and organization scope.

## Report Runs Indexes Verified

Verified present:

- `_id_`
- `uniq_report_runs_id`
- `idx_report_runs_report_id_created_at`
- `idx_report_runs_report_key_created_at`
- `idx_report_runs_org_created_at`
- `idx_report_runs_client_created_at`
- `idx_report_runs_location_created_at`
- `idx_report_runs_status_created_at`

Expected missing indexes after verification:

```json
[]
```

## Data Mutation

No test report definitions or report run documents were inserted.

The live verification mutated MongoDB only by creating indexes on `reports` and `report_runs`, and by any existing index maintenance already performed by `ensureIndexes()`.

## Pass/Fail Summary

Pass after one code fix.

- JS syntax checks passed.
- Focused backend tests passed.
- Live `ensureIndexes()` execution passed.
- `reports` indexes were verified.
- `report_runs` indexes were verified.
- No generated report buffers were stored.
- No report data was inserted.

## Remaining Risks

- The live check verified index creation and index names, not report route behavior. Report routes are still future work.
- Existing `ensureIndexes()` can still maintain indexes for other collections when run; this task did not isolate only report collections.
- No destructive cleanup scripts were run.
