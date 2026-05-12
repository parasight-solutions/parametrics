# S2-22.1 Durable Local Report Storage Live Smoke Proof Pack

Date: 2026-05-12

## 1. Scope And Decision

S2-22.1 is a live local API + MongoDB smoke verifying that the S2-22 durable local report output storage adapter writes real files and persists matching durable metadata when the existing synchronous `POST /api/v1/reports/dashboard-snapshot` route runs against a controlled fixture organization. No application or test code was changed; this is documentation/proof only.

Phase 2 integrations remain blocked. No frontend code changed. No new routes, no listing/download APIs, no queues, no workers, and no scheduler were started or modified.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pass.

## 2. Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/s2-22-durable-local-report-storage.md`
- `docs/architecture/report-history-and-storage.md`
- `docs/architecture/report-service.md`
- `docs/runtime/processes.md`

## 3. Files Inspected

- `apps/api/src/server.js` (`/api/v1/reports` mount)
- `apps/api/src/routes/reports.js` (synchronous dashboard snapshot route + storage wiring)
- `apps/api/src/services/reportStorage.js` (local adapter + key/path safety)
- `apps/api/src/services/reportStore.js` (persisted output shape)
- `apps/api/src/services/organizationMemberFixtures.js` (fixture org / user / member ids)
- `apps/api/src/middleware/auth.js`, `apps/api/src/lib/jwt.js`, `apps/api/src/lib/authConfig.js` (local JWT minting path)

## 4. Files Changed

- `docs/proof/s2-22-1-durable-report-storage-live-smoke.md` — this proof doc (new).
- `docs/codex/sprint-2-phase-1-guardrails.md` — S2-22.1 completion entry; Phase 2 remains blocked.
- `docs/architecture/report-history-and-storage.md` — small live-smoke note referencing this proof doc.
- `docs/architecture/report-service.md` — small live-smoke note referencing this proof doc.

No backend or frontend source code, route handlers, services, tests, or `package.json` entries were changed. `package-lock.json` is unchanged.

## 5. Working Tree State Before Smoke

```text
git status --short
git log -3 --oneline
```

- `git status --short`: empty (clean working tree at the start of S2-22.1).
- Most recent commits before this smoke:
  - `e295192 feat(api): add durable local report output storage` (S2-22)
  - `89441df docs: design report history and storage contract` (S2-20)
  - `e5cf00d chore(api): add focused npm test script` (S2-19)

## 6. Smoke Environment

- Local API only. Workers and scheduler were intentionally not started.
- `npm run dev:prepare` was run from the repo root; it generated `apps/api/.env.local` and `apps/web/.env.local` with the deterministic local mapping (API on `127.0.0.1:5051`, web on `127.0.0.1:5175`).
- Storage root set explicitly outside the repo: `REPORT_STORAGE_LOCAL_DIR=/tmp/parametrics-s2-22-1-report-storage`. Directory was wiped and recreated before the smoke.
- API started with `REPORT_STORAGE_LOCAL_DIR=/tmp/parametrics-s2-22-1-report-storage npm run -w @parametrics/api dev:api`, logging redirected to `/tmp/s2-22-1-api.log`.
- Local Mongo connection uses the existing configured MongoDB URI/database (`parametrics`). The startup log redacted the credential portion as `mongodb+srv://***:***@...` (no secrets printed).
- A short-lived (15 min) local JWT was minted in-process by importing `apps/api/src/lib/jwt.js` after loading the existing API env. The token was written to `/tmp/s2-22-1-token.txt` and never echoed to the terminal or this proof doc. No user record was created; the JWT was generated for the existing fixture owner user id `s2-15-user-owner`.

## 7. API Health Status

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5051/api/v1/health
```

Result: `200`.

## 8. Smoke Request

`POST http://127.0.0.1:5051/api/v1/reports/dashboard-snapshot` with `Authorization: Bearer <short-lived JWT>` and the following body (no `location_id`, no `client_id`, org-level report):

```json
{
  "organization_id": "s2-15-fixture-org",
  "report_name": "s2-22-1-smoke org dashboard",
  "report_key": "s2-22-1-smoke-dashboard",
  "requested_formats": ["pdf", "xlsx"],
  "date_range": { "start": "2026-04-01", "end": "2026-04-07" },
  "dashboard_snapshot": {
    "title": "S2-22.1 smoke dashboard",
    "provider": "google",
    "cards": [
      { "title": "Website Clicks", "value": 12 },
      { "title": "Calls", "value": 3 }
    ],
    "metrics": [
      { "metric": "BUSINESS_IMPRESSIONS_SEARCH", "total": 200 }
    ],
    "tables": [],
    "charts": []
  }
}
```

The fixture owner (`s2-15-user-owner`) has an active `owner` membership in `s2-15-fixture-org` from S2-15.2, so `requireOrganizationRole({ allowedRoles: ["owner", "admin"] })` is expected to allow this request.

## 9. Smoke Response Summary

- HTTP status: `200`.
- `report_run.id` short form: `d4a99c3d-...` (full UUID known to the run document).
- `report_run.report_key`: `s2-22-1-smoke-dashboard`.
- `report_run.report_type`: `dashboard_snapshot`.
- `report_run.organization_id`: `s2-15-fixture-org`.
- `report_run.client_id`: `null`.
- `report_run.location_id`: `null`.
- `report_run.status`: `succeeded`.
- `report_run.requested_formats`: `["pdf", "xlsx"]`.
- `report_run.outputs.length`: `2`.
- `report_run.error`: `null`.

Per-output durable metadata from the response (one row per format):

| format | status | size | path | storage_provider | storage_key | content_type | filename ends with | checksum.algorithm | checksum.value.len | generated_at set | expires_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pdf` | `succeeded` | `2047` | `null` | `local` | `report-outputs/s2-15-fixture-org/2026/05/<run_id>.pdf` | `application/pdf` | `<run_id>.pdf` | `sha256` | `64` | `true` | `null` |
| `xlsx` | `succeeded` | `8678` | `null` | `local` | `report-outputs/s2-15-fixture-org/2026/05/<run_id>.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `<run_id>.xlsx` | `sha256` | `64` | `true` | `null` |

The full output property set was `checksum, completed_at, content_type, created_at, error, expires_at, filename, format, generated_at, path, size, status, storage_key, storage_provider, updated_at`. No `buffer`, no `base64`, no absolute path, no `root`, no `REPORT_STORAGE_LOCAL_DIR` segment appeared anywhere in the response. The response JSON contained no `/tmp/`, no `parametrics-s2-22-1-report-storage`, no raw `input_snapshot` body, and no echoed `BUSINESS_IMPRESSIONS_SEARCH` metric name.

`files[]` in the response still carried both formats with non-empty base64:

| format | filename ends with | content_type | size | base64.length |
| --- | --- | --- | --- | --- |
| `pdf` | `<run_id>.pdf` | `application/pdf` | `2047` | `2732` |
| `xlsx` | `<run_id>.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `8678` | `11572` |

Base64 lengths match the standard `ceil(size / 3) * 4` shape (`2047 → 2732`, `8678 → 11572`). No raw buffer fields are present.

## 10. Mongo Summary (no raw docs printed)

Connected to the existing configured local Mongo database (`parametrics`) and queried summaries only.

- `report_runs.countDocuments({ report_key: "s2-22-1-smoke-dashboard" })`: `1`.
- `report_runs.countDocuments({ organization_id: "s2-15-fixture-org" })`: `1` (matches only this smoke row; no prior smoke pollution).
- Found the persisted run by `id`:
  - `status`: `succeeded`.
  - `organization_id`: `s2-15-fixture-org`.
  - `client_id`: `null`.
  - `location_id`: `null`.
  - `requested_formats`: `["pdf", "xlsx"]`.
  - `outputs.length`: `2`.
  - `error`: `null`.
  - `input_snapshot` field: **not present** on the persisted document.
  - `input_snapshot_summary` field: **present** on the persisted document.
- Per persisted output (one row per format):
  - `status`: `succeeded`.
  - `size`: matches the response `size` exactly (`2047` PDF, `8678` XLSX).
  - `path`: `null`.
  - `storage_provider`: `"local"`.
  - `storage_key` starts with `report-outputs/`.
  - `content_type` is set.
  - `filename` is set.
  - `checksum.algorithm`: `"sha256"`.
  - `generated_at`: set (truthy date).
  - `expires_at`: `null`.
  - `buffer` field: not present.
  - `base64` field: not present.

`location_org_map` was untouched by the smoke:

- `location_org_map.countDocuments({ organization_id: "s2-15-fixture-org" })`: `0`.
- `location_org_map.countDocuments({ $or: [{ id: /s2-22-1/ }, { location_id: /s2-22-1/ }, { organization_id: /s2-22-1/ } ] })`: `0`.

No raw Mongo documents were printed. All checks reported are booleans, counts, or short identifier prefixes.

## 11. Storage Directory Summary

```bash
find /tmp/parametrics-s2-22-1-report-storage -type f | sort
```

Two files were written under the configured root:

- `/tmp/parametrics-s2-22-1-report-storage/report-outputs/s2-15-fixture-org/2026/05/<run_id>.pdf`
- `/tmp/parametrics-s2-22-1-report-storage/report-outputs/s2-15-fixture-org/2026/05/<run_id>.xlsx`

Per-file integrity:

| format | exists | persisted.size | disk.size | sizes match | persisted sha256 length | sha256 matches disk bytes | under configured root | under repo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pdf` | `true` | `2047` | `2047` | `true` | `64` | `true` | `true` | `false` |
| `xlsx` | `true` | `8678` | `8678` | `true` | `64` | `true` | `true` | `false` |

Short checksum prefixes (first 12 hex characters of the persisted `sha256` values, recorded for forensic verifiability without exposing implementation details): pdf `a116880d1f02...`, xlsx `3940e34e5181...`.

No file landed inside `/var/www/html/parametrics`. The storage root is `/tmp/parametrics-s2-22-1-report-storage`, exactly as configured by `REPORT_STORAGE_LOCAL_DIR`.

## 12. Secret / Raw Record Confirmation

- No JWTs were printed in this proof doc or in any terminal output captured here. The minted local JWT lived in `/tmp/s2-22-1-token.txt` for the duration of the smoke and was not echoed.
- No OAuth access/refresh/ID tokens, auth codes, authorization headers, encrypted secret payloads, passwords, emails, or raw user records appear in this doc, the captured request, the captured response, the Mongo summary, or the storage-directory summary.
- The Mongo connection log line was redacted at the credential portion: `mongodb+srv://***:***@cluster0.l9tto5f.mongodb.net/...`. No live credential value is reproduced here.
- The response JSON was scanned and contained no `/tmp/`, no `REPORT_STORAGE_LOCAL_DIR`, no raw `input_snapshot` body, and none of the raw metric names that were sent inside the request body (e.g. `BUSINESS_IMPRESSIONS_SEARCH`).

## 13. Checks Run

```bash
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --name-only -- apps/api/src apps/web/src apps/api/package.json apps/web/package.json package-lock.json
git diff --check
```

- `cd apps/api && npm test`: `1..135 # tests 135 # pass 135 # fail 0 # skipped 0` (same focused matrix as S2-22).
- `cd apps/web && npm test -- --run`: `Test Files 4 passed (4) / Tests 21 passed (21)`.
- `cd apps/web && npm run build`: `286 modules transformed. ✓ built in ~34s` (pre-existing Browserslist data-age warning unchanged).
- `git diff --name-only -- apps/api/src apps/web/src apps/api/package.json apps/web/package.json package-lock.json`: empty.
- `git diff --check`: no whitespace conflicts.

API process was stopped (`pkill -f "node src/server.js"`) and a follow-up health probe confirmed the port refused connections.

## 14. Skipped / Remaining Risks

- Org-level smoke only. The GBP location-bound code path (the owned-location guard plus membership-aware `requireOrganizationLocationAccess`) was not exercised in this smoke because the fixture user has no Google-imported owned location. Coverage for that branch is via the existing S2-10.2 GBP membership smoke and the S2-22 unit tests; no new live coverage was added here.
- No live deny-by-role coverage in this smoke (manager / viewer / member denial for an org-level report); the existing S2-22 route tests cover those denial paths.
- The synchronous route still writes through `getDefaultReportStorage()` at runtime. This smoke confirms the singleton picks up `REPORT_STORAGE_LOCAL_DIR` correctly on a fresh process start; changes to that env variable still require an API restart.
- No retention/expiry enforcement is implemented. The smoke files remain under `/tmp/parametrics-s2-22-1-report-storage` until manually removed; on hosts that wipe `/tmp` on reboot, durable outputs may disappear between restarts. Production deployments should set `REPORT_STORAGE_LOCAL_DIR` to a persistent location, or wait for the future cloud adapter task.
- Smoke `report_runs` row (`organization_id: s2-15-fixture-org`, `report_key: s2-22-1-smoke-dashboard`) intentionally remains in MongoDB because no safe delete route exists. Same convention as the S2-15 / S2-16.1 / S2-17.1 fixtures.
- `readOutput` returns a `Buffer` rather than the S2-20 `ReadableStream` contract; documented deviation; not exercised by this smoke because no download route exists yet. Future S2-24 may rename/extend.
- No live API smoke yet for `report.output.write`-style audit events because none were added in S2-22; outcomes still surface through the existing `report.dashboard_snapshot.generate` audit codes and the per-output `error.code` in `report_runs`.
- Pre-existing Browserslist build warning is unchanged.

## 15. Ready For GPT Verification

Yes. The smoke proved the S2-22 durable storage adapter and route wiring end-to-end against a real local API + Mongo, with files on disk that match persisted size and sha256, durable metadata persisted on `report_runs.outputs[]`, `path` null, no raw buffers/base64 in Mongo, no absolute path or env value leaked in the response, the fixture organization scope respected, `location_org_map` untouched, and no secrets/raw records printed. API, worker, and scheduler runtimes were kept separate (only the API process was started, and it was stopped after the smoke). All API tests, web tests, and the web build still pass. No backend or frontend source diff. No `package.json`/`package-lock.json` diff.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-22.1 durable report storage live smoke was verified after local API/Mongo smoke, persisted metadata checks, on-disk file integrity checks, API tests, web tests, web build, no-source-diff checks, and diff checks.
