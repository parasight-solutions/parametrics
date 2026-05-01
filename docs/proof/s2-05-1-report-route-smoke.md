# S2-05.1 Report Route Smoke

Date: 2026-05-01

## Scope

S2-05.1 smoke tested the authenticated dashboard snapshot report route against the configured API/Mongo environment and verified that `report_runs` persistence stores metadata only.

No frontend work, report queues/workers, scheduler changes, email, file/cloud storage, or Phase 2 providers were added.

## Pre-Change Working Tree

Command:

```bash
git status --short
```

Result:

```text
?? .codex
```

Tracked files were clean before S2-05.1 changes. The untracked `.codex` entry was pre-existing and was not touched.

## Commands Run

Syntax checks:

```bash
cd apps/api && node --check src/routes/reports.js
cd apps/api && node --check src/routes/reports.test.js
cd apps/api && node --check src/server.js
cd apps/api && node --check src/services/reportStore.js
```

Result: passed with no output.

Focused tests:

```bash
cd apps/api && node --test src/routes/reports.test.js src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
```

Result:

```text
1..9
# tests 9
# suites 0
# pass 9
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

API availability check:

```bash
node --input-type=module -e "<fetch http://127.0.0.1:5050/api/v1/health>"
```

Result: API was not already running.

API startup:

```bash
cd apps/api && npm run start
```

The first start attempt was blocked by sandbox network restrictions for Redis/Mongo. The command was rerun with approved network access. Only the API process was started; workers and scheduler were not started. The API process was stopped after verification.

Smoke command:

```bash
node --input-type=module -e "<obtain JWT without printing it, choose existing report scope, POST /api/v1/reports/dashboard-snapshot, verify report_runs and audit_logs>"
```

## API Target

```text
http://127.0.0.1:5050
```

## Auth Method

Auth method: local seed credential login through `/api/v1/auth/login`.

The JWT was used only in memory and was not printed.

## Report Scope

Existing scoped Google location was used:

```json
{
  "organization_id": "9658a8f2-9f08-45a3-ad58-24de3a34a68e",
  "client_id": "834213d9-6ac6-4b98-b28a-6df2ba834f9a",
  "location_id": "7ce4f68b-63f1-41a5-aa3c-ec6978fa8314",
  "provider": "google"
}
```

No location was auto-bound and no org/location data was created.

## Smoke Request Summary

Endpoint:

```text
POST /api/v1/reports/dashboard-snapshot
```

Request summary:

- `report_name`: `S2-05.1 smoke dashboard`
- `report_key`: smoke-test prefixed key
- `requested_formats`: `["pdf", "xlsx"]`
- `date_range`: `2026-04-01` to `2026-04-30`
- dashboard snapshot: one card, one metric, one table, one chart

## Initial Finding

The first route smoke was functionally successful but returned HTTP `201`.

S2-05.1 required HTTP `200`, so this was treated as a real route-contract bug. The route was changed from `res.status(201).json(result)` to `res.json(result)`.

After the code change, the API was restarted and the smoke was rerun.

## Final Smoke Response Summary

Final response:

```json
{
  "http_status": 200,
  "ok": true,
  "run_id": "9a97506e-6ac9-418c-b26f-42c892871902",
  "run_status": "succeeded",
  "outputs": [
    { "format": "pdf", "status": "succeeded", "size": 2206, "path": null, "error": null },
    { "format": "xlsx", "status": "succeeded", "size": 9059, "path": null, "error": null }
  ],
  "files": [
    {
      "format": "pdf",
      "size": 2206,
      "base64_length": 2944,
      "base64_prefix": "JVBERi0x",
      "content_type": "application/pdf"
    },
    {
      "format": "xlsx",
      "size": 9059,
      "base64_length": 12080,
      "base64_prefix": "UEsDBBQA",
      "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
  ]
}
```

The full base64 payloads were not printed.

## `report_runs` Persistence Verification

Verified document by returned `report_run.id`:

```json
{
  "found": true,
  "status": "succeeded",
  "output_formats": ["pdf", "xlsx"],
  "output_statuses": ["succeeded", "succeeded"],
  "has_input_snapshot": false,
  "has_files": false,
  "has_top_level_base64": false,
  "outputs_have_buffer": false,
  "outputs_have_base64": false,
  "has_summary": true,
  "has_filters": true
}
```

This confirms Mongo persistence contains lifecycle/output metadata, summary, and filters only. Generated buffers and base64 payloads were not stored.

## Audit Verification

Verified `audit_logs` success entry:

```json
{
  "found": true,
  "action": "report.dashboard_snapshot.generate",
  "status": "success",
  "target_id": "9a97506e-6ac9-418c-b26f-42c892871902"
}
```

## Code Changes Needed

Yes. One route-contract bug was found and fixed:

- `apps/api/src/routes/reports.js`: success response now returns HTTP `200` instead of HTTP `201`.

No PDF/XLSX generation behavior was changed.

## Pass/Fail Summary

Pass after the HTTP status fix.

- JS syntax checks passed.
- Focused backend tests passed.
- API started successfully with approved network access.
- Authenticated smoke request returned HTTP `200`.
- Report run succeeded.
- PDF/XLSX output metadata succeeded.
- PDF/XLSX base64 files were returned, with only lengths/prefixes printed.
- `report_runs` stored metadata only.
- Audit success entry was observed.
- API process was stopped after verification.

## Remaining Risks

- The smoke used the local seed credential login path and an existing configured Mongo dataset.
- The route remains synchronous and returns base64; larger reports still need future storage/queue work.
- No frontend integration was exercised.
- The smoke created report run and audit log records in the configured Mongo environment; no cleanup script was run.
