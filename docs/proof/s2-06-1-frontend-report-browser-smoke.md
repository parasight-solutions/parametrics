# S2-06.1 Frontend Report Browser Smoke

Date: 2026-05-02

## Scope

S2-06.1 manually verified the frontend dashboard `Report PDF/XLSX` action against the running API and configured MongoDB environment.

This was verification and proof documentation only. No backend features, report queues/workers, scheduler changes, email, file/cloud storage, report history UI, Phase 2 providers, multi-channel metrics, or dashboard redesign were added.

## Pre-Verification Working Tree

Command:

```bash
git status --short
```

Result:

```text
?? .codex
```

Tracked files were clean before S2-06.1 verification. The untracked `.codex` entry was pre-existing/unrelated and was not touched.

## Commands Run

Frontend tests:

```bash
cd apps/web && npm test -- --run
```

Result:

```text
Test Files  3 passed (3)
Tests  8 passed (8)
```

Frontend build:

```bash
cd apps/web && npm run build
```

Result: passed.

```text
vite v7.1.7 building for production...
Browserslist: browsers data (caniuse-lite) is 8 months old.
283 modules transformed.
built in 4.97s
```

Diff whitespace check:

```bash
git diff --check
```

Result: passed with no output.

API availability check:

```bash
node --input-type=module -e "<fetch http://127.0.0.1:5050/api/v1/health>"
```

Initial result: API was not already running.

API startup:

```bash
cd apps/api && npm run start
```

Result: API-only process started successfully. Workers and scheduler were not started.

Web dev server startup:

```bash
cd apps/web && npm run dev -- --host 127.0.0.1
```

Initial sandboxed attempt failed with `listen EPERM` on `127.0.0.1:5173`. The command was rerun with approval for local dev-server binding. Port `5173` was already in use, so Vite selected `5174`.

Process cleanup check after verification:

```bash
ps -eo pid,ppid,cmd | grep -E 'vite --host 127\\.0\\.0\\.1|node src/server\\.js|google-chrome.*pm-s2-06-1' | grep -v grep || true
```

Result: no matching API, Vite, or temporary Chrome smoke processes remained.

## Targets

API target:

```text
http://127.0.0.1:5050
```

Web target:

```text
http://127.0.0.1:5174/
```

## Browser Verification

Browser method: local Google Chrome headless browser with a temporary profile and temporary download directory.

The login form was submitted using the local working user flow. No JWTs, passwords, OAuth tokens, Mongo credentials, or generated base64 payloads were printed.

Checklist:

- Pass: login reached the dashboard.
- Pass: selected the existing Beetle Google location.
- Pass: selected location had canonical `organization_id` and `client_id` scope.
- Pass: dashboard data loaded and `Raw totals` remained visible.
- Pass: `Report PDF/XLSX` button was visible.
- Pass: button was disabled before location/data/scope readiness.
- Pass: button became enabled after the scoped Beetle location and dashboard data were ready.
- Pass: clicking `Report PDF/XLSX` showed `Generating...`.
- Pass: button was disabled during generation, blocking duplicate clicks while loading.
- Pass: success state appeared: `Generated 2 backend report files.`
- Pass: app auth remained active after success.
- Pass: app did not redirect to `/login`.
- Pass: no provider reauth banner appeared during this smoke.
- Pass: dashboard data remained visible after success.

Selected location summary:

```json
{
  "location_id": "7ce4f68b-63f1-41a5-aa3c-ec6978fa8314",
  "label": "Beetle Digital - Digital Marketing, Video Production & Training Hub",
  "provider": "google",
  "has_scope": true,
  "beetle_match": true
}
```

Report request count observed in browser memory:

```json
{
  "report_fetch_count": 1
}
```

## Download Verification

The backend response returned two files. The browser downloaded both files to a temporary directory, verified the downloaded filenames matched the backend response filenames, then removed the temporary downloads.

Downloaded file summary:

```json
[
  {
    "format": "pdf",
    "filename": "gbp_dashboard_snapshot-864e60cf-2391-4e98-82ae-dd0e5a167098.pdf",
    "content_type": "application/pdf",
    "size": 3186,
    "base64_length": 4248
  },
  {
    "format": "xlsx",
    "filename": "gbp_dashboard_snapshot-864e60cf-2391-4e98-82ae-dd0e5a167098.xlsx",
    "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "size": 13686,
    "base64_length": 18248
  }
]
```

The proof records base64 lengths only. It does not include generated base64 content and does not upload or retain generated files.

## Report Run Verification

Browser-generated report run id:

```text
864e60cf-2391-4e98-82ae-dd0e5a167098
```

Mongo verification command:

```bash
node --input-type=module -e "<query report_runs and audit_logs by report run id; print sanitized metadata booleans only>"
```

Result:

```json
{
  "found": true,
  "status": "succeeded",
  "report_key": "gbp_dashboard_snapshot",
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

This confirms the browser-generated `report_runs` record stores lifecycle/output metadata, summary, and filters only. It does not store the full dashboard snapshot, files, generated base64, or output buffers/base64.

## Audit Verification

Audit verification result:

```json
{
  "audit_success_found": true,
  "audit_action": "report.dashboard_snapshot.generate",
  "audit_status": "success",
  "audit_target_id": "864e60cf-2391-4e98-82ae-dd0e5a167098"
}
```

## Code Changes Needed

No code changes were needed.

Only proof and guardrail documentation were changed for S2-06.1.

## Pass/Fail Summary

Pass.

- Frontend tests passed.
- Frontend build passed.
- `git diff --check` passed.
- API-only process was used.
- Workers and scheduler were not started.
- Browser smoke verified login, location selection, dashboard load, button disabled/enabled behavior, loading state, duplicate-click blocking while loading, success state, and preserved dashboard data.
- PDF and XLSX downloads were triggered.
- Downloaded filenames matched backend response filenames.
- App auth remained active.
- No provider reauth banner appeared.
- `report_runs` persistence remained metadata-only.
- Audit success entry was found.

## Remaining Risks

- The smoke created one real `report_runs` document and one audit success entry in the configured MongoDB environment; no cleanup script was run.
- The browser smoke used the local working user and the existing Beetle Google location only.
- Provider reauth was not forced; this smoke only verifies that no reauth event occurred and no app logout happened during successful report generation.
- The route remains synchronous and returns base64; queue-backed generation, durable storage, report history UI, scheduled reports, and email delivery remain future follow-ups.
