# S2-24.1 Report Output Download API Live Smoke Proof Pack

Date: 2026-05-16

## 1. Scope And Decision

S2-24.1 is a live local API + MongoDB smoke verifying that the S2-24 read-only `GET /api/v1/reports/runs/:runId/outputs/:format` endpoint streams persisted PDF/XLSX bytes back to the requester with the documented headers, role/scope rules, and integrity guarantees. No application or test code was changed; this is documentation/proof only.

Phase 2 integrations remain blocked. No frontend code changed. No new routes, no detail/regenerate APIs, no queues, no workers, and no scheduler were started or modified. The synchronous `POST /api/v1/reports/dashboard-snapshot` route, the durable local storage adapter, PDF/XLSX generation, and the S2-23 listing endpoint were exercised read-only (apart from the one fresh fixture run created at the start of the smoke, see Section 6) and otherwise unchanged.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pass.

## 2. Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/s2-22-1-durable-report-storage-live-smoke.md`
- `docs/proof/s2-23-1-report-runs-listing-live-smoke.md`
- `docs/proof/s2-24-report-output-download-api.md`
- `docs/architecture/report-history-and-storage.md`
- `docs/architecture/report-service.md`
- `docs/runtime/processes.md`

## 3. Files Inspected

- `apps/api/src/routes/reports.js` (`GET /api/v1/reports/runs/:runId/outputs/:format` route + `downloadReportOutputForUser` helper + private filename/content-type/scope helpers)
- `apps/api/src/services/reportStore.js` (`getReportRunById`, `findReportRunOutput`)
- `apps/api/src/services/reportStorage.js` (`readOutput` path safety + storage root resolution)
- `apps/api/src/services/organizationAccess.js` (`isMembershipAssignedToLocation`, `requireOrganizationMembership`)
- `apps/api/src/services/organizationMemberFixtures.js` (fixture org / user / member / client / location ids)
- `apps/api/src/middleware/auth.js`, `apps/api/src/lib/jwt.js`, `apps/api/src/lib/authConfig.js` (local JWT minting path)
- `apps/api/src/lib/mongo.js` (count helpers used for summary)

## 4. Files Changed

- `docs/proof/s2-24-1-report-output-download-live-smoke.md` — this proof doc (new).
- `docs/codex/sprint-2-phase-1-guardrails.md` — S2-24.1 completion entry; Phase 2 remains blocked.
- `docs/architecture/report-history-and-storage.md` — small live-smoke note referencing this proof doc.
- `docs/architecture/report-service.md` — small live-smoke note referencing this proof doc.

No backend or frontend source code, route handlers, services, tests, or `package.json` entries were changed. `package-lock.json` is unchanged.

## 5. Working Tree State Before Smoke

```text
git status --short
git log -3 --oneline
```

- `git status --short`: empty (clean working tree at the start of S2-24.1).
- Most recent commits before this smoke:
  - `7a29755 feat(api): add report output download endpoint` (S2-24)
  - `860838f chore(api): smoke test report run listing` (S2-23.1)
  - `884d0cb feat(api): add report run listing endpoint` (S2-23)

## 6. Smoke Environment

- Local API only. Workers and scheduler were intentionally not started.
- `npm run dev:prepare` was run from the repo root; it generated `apps/api/.env.local` and `apps/web/.env.local` with the deterministic local mapping (API on `127.0.0.1:5050`, web on `127.0.0.1:5174`).
- Storage root was set to a smoke-specific value outside the repo: `REPORT_STORAGE_LOCAL_DIR=/tmp/parametrics-s2-24-1-report-storage`. The directory was created empty before the smoke.
- API started with `REPORT_STORAGE_LOCAL_DIR=/tmp/parametrics-s2-24-1-report-storage npm run -w @parametrics/api dev:api`, logging redirected to `/tmp/s2-24-1-api.log`.
- Local Mongo connection uses the existing configured MongoDB URI/database (`parametrics`). The startup log redacted the credential portion as `mongodb+srv://***:***@cluster0.l9tto5f.mongodb.net/...` (no secrets printed).
- Original plan was to download the S2-22.1 smoke run from `/tmp/parametrics-s2-22-1-report-storage`. On smoke start the directory was already gone (Linux `/tmp` cleanup between 2026-05-12 and 2026-05-16). The persisted `report_runs` row from S2-22.1 was still present in Mongo, but its on-disk PDF/XLSX bytes were missing, so a download attempt against that run would have returned `500 report_output_read_failed`. The user authorized generating a fresh fixture run for S2-24.1 instead (one additional `report_runs` row under the controlled fixture scope; no other data mutation). Section 7 records the snapshot request used to create that fresh fixture run.
- Short-lived (15 min) local JWTs were minted in-process by importing `apps/api/src/lib/jwt.js` (after loading the existing API env) for each S2-15 fixture user_id (`s2-15-user-owner`, `s2-15-user-admin`, `s2-15-user-manager`, `s2-15-user-viewer`, `s2-15-user-member`, `s2-15-user-invited`, `s2-15-user-disabled`). Tokens were written to `/tmp/s2-24-1-tokens/<role>.txt` with `0600` permissions and were never echoed to the terminal or this proof doc. No user records were created; the JWTs target the existing fixture user ids seeded in S2-15.2. Token lengths (193..197 bytes) were printed only to confirm the helper wrote real JWTs.
- After the smoke, every token file and the helper directory were removed (`rm -f /tmp/s2-24-1-tokens/*.txt; rmdir /tmp/s2-24-1-tokens`). The mint helper and Mongo summary helper (under `/tmp/s2-24-1-*.mjs`) were also deleted so the working tree carries no stray files.

## 7. API Health Status

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5050/api/v1/health
```

Result: `200`. After the smoke, `pkill -f "node src/server.js"` was issued and a follow-up health probe returned `Connection refused` (`%{http_code}=000`), confirming the API was stopped.

## 8. Auth / Token Strategy

- A small node helper imported `apps/api/src/startup/env.js` and `apps/api/src/lib/jwt.js` and called `signJwt({ user_id, role: "individual" }, { expiresIn: "15m" })` for each fixture user_id.
- Tokens were written to `/tmp/s2-24-1-tokens/<role>.txt` with mode `0600` and removed after the smoke. Nothing in this proof, the captured response files, or any printed log echoes the token value.
- No user records were created. No JWT secret value or full token was logged. The route's `authenticate` middleware accepted the minted tokens because `JWT_SECRET` is the same in-process value used by `signJwt` and `verifyJwt`.

## 9. Fresh Fixture Run And Lookup

Because the original S2-22.1 storage directory was wiped from `/tmp` between 2026-05-12 and 2026-05-16, one fresh fixture run was generated under the S2-15 controlled scope before downloading. This is the same `POST /api/v1/reports/dashboard-snapshot` flow S2-22.1 used; only the `report_name` and `report_key` differ. Request body (no `location_id`, no `client_id`, org-level report):

```json
{
  "organization_id": "s2-15-fixture-org",
  "report_name": "s2-24-1-smoke org dashboard",
  "report_key": "s2-24-1-smoke-dashboard",
  "requested_formats": ["pdf", "xlsx"],
  "date_range": { "start": "2026-04-01", "end": "2026-04-07" },
  "dashboard_snapshot": {
    "title": "S2-24.1 smoke dashboard",
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

Snapshot response summary (top-level, redacted):

| field | value |
| --- | --- |
| HTTP status | `200` |
| `report_run.id` short | `02c0f77c-...` (full UUID known internally) |
| `report_run.report_key` | `s2-24-1-smoke-dashboard` |
| `report_run.report_type` | `dashboard_snapshot` |
| `report_run.status` | `succeeded` |
| `report_run.organization_id` | `s2-15-fixture-org` |
| `report_run.client_id` | `null` |
| `report_run.location_id` | `null` |
| `report_run.outputs.length` | `2` |

Per-output durable metadata on the snapshot response (one row per format):

| format | status | size | path | storage_provider | storage_key starts with | content_type | filename ends with | checksum.algo | checksum.value.len |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pdf` | `succeeded` | `2047` | `null` | `local` | `report-outputs/s2-15-fixture-o...` | `application/pdf` | `.pdf` | `sha256` | `64` |
| `xlsx` | `succeeded` | `8678` | `null` | `local` | `report-outputs/s2-15-fixture-o...` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `.xlsx` | `sha256` | `64` |

Two files were written under the configured root by the snapshot route:

- `/tmp/parametrics-s2-24-1-report-storage/report-outputs/s2-15-fixture-org/2026/05/<run_id>.pdf` (`2047` bytes)
- `/tmp/parametrics-s2-24-1-report-storage/report-outputs/s2-15-fixture-org/2026/05/<run_id>.xlsx` (`8678` bytes)

The run id was captured internally to `/tmp/s2-24-1-runid.txt` (mode `0600`) for later requests. Only the short prefix (`02c0f77c-...`) is printed in this proof doc.

## 10. Owner Download Result

Two download requests under the owner JWT (full run id intentionally not echoed; short prefix `02c0f77c-...`):

```bash
curl -sS -D /tmp/s2-24-1-pdf-headers.txt -o /tmp/s2-24-1-pdf.bin \
  -H "Authorization: Bearer ${OWNER_TOKEN}" \
  -w "HTTP %{http_code} bytes %{size_download}\n" \
  "http://127.0.0.1:5050/api/v1/reports/runs/<run_id>/outputs/pdf"

curl -sS -D /tmp/s2-24-1-xlsx-headers.txt -o /tmp/s2-24-1-xlsx.bin \
  -H "Authorization: Bearer ${OWNER_TOKEN}" \
  -w "HTTP %{http_code} bytes %{size_download}\n" \
  "http://127.0.0.1:5050/api/v1/reports/runs/<run_id>/outputs/xlsx"
```

Result:

- PDF: `HTTP 200 bytes 2047`.
- XLSX: `HTTP 200 bytes 8678`.

## 11. Header / Integrity Checks

Response headers captured (`-D <file>` then read in proof prep). Same shape on both formats; only the format-specific fields differ.

| header | PDF response | XLSX response |
| --- | --- | --- |
| `Content-Type` | `application/pdf` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `Content-Disposition` | `attachment; filename="s2-24-1-smoke-dashboard-<run_id>.pdf"` | `attachment; filename="s2-24-1-smoke-dashboard-<run_id>.xlsx"` |
| `Content-Length` | `2047` | `8678` |
| `Cache-Control` | `no-store` | `no-store` |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| Helmet headers | `Strict-Transport-Security`, `Referrer-Policy`, `X-Frame-Options`, CSP/COOP/CORP, etc. (pre-existing app-wide hardening) | same |

`Content-Type` for both responses matches the persisted `output.content_type` recorded in Mongo. `Content-Disposition` filename is ASCII-safe (matches `^[A-Za-z0-9._-]+$`) and is derived from `report_key`/`run_id`, not from user-controlled report-name strings. The filename echoes the `report_key`/run id pair only; no email, secret, or path-like value appears.

Byte-level integrity vs persisted metadata:

| format | persisted size | downloaded size | size match | persisted sha256 prefix | downloaded sha256 prefix | sha256 match | first 4 bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pdf` | `2047` | `2047` | `true` | `fc62c1bb2b92...` | `fc62c1bb2b92...` | `true` | `%PDF` |
| `xlsx` | `8678` | `8678` | `true` | `6c1331a5967c...` | `6c1331a5967c...` | `true` | `PK\x03\x04` (zip magic) |

Raw-binary confirmation:

- PDF body begins with `%PDF-1.4\n` followed by the standard PDF marker bytes. No JSON envelope, no base64 alphabet padding.
- XLSX body begins with `PK\x03\x04` (zip container, as XLSX is a zipped OOXML package). No JSON envelope, no base64 alphabet padding.

Together with the matching `sha256` values, these confirm: HTTP 200, raw bytes (not JSON, not base64), `Content-Type` matches persisted, `Content-Disposition: attachment` with safe filename, `Content-Length` matches bytes, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, downloaded byte size matches persisted `output.size`, and downloaded sha256 matches persisted `output.checksum.value`.

## 12. Denial Probes

The smoke row is an org-level run (`client_id: null`, `location_id: null`). Each non-owner fixture role was probed against the same `GET /api/v1/reports/runs/<run_id>/outputs/pdf` URL (and `outputs/xlsx` for the scoped/denied roles), recording HTTP status and `error.code` (or "raw body" when allowed). Tokens were minted per role and never echoed.

| role (suffix → fixture user_id) | membership status | PDF probe | XLSX probe |
| --- | --- | --- | --- |
| `admin` (`s2-15-user-admin`) | `active` | `200` raw PDF (2047 bytes, sha256 `fc62c1bb2b92...`) | (not re-probed; same broad role) |
| `manager` (`s2-15-user-manager`) | `active`, `assigned_client_ids=[s2-15-fixture-client-1]`, `assigned_location_ids=[s2-15-fixture-location-1]` | `403 organization_scope_required` | `403 organization_scope_required` |
| `viewer` (`s2-15-user-viewer`) | `active`, same assignments as manager | `403 organization_scope_required` | `403 organization_scope_required` |
| `member` (`s2-15-user-member`) | `active` | `403 organization_role_required` | `403 organization_role_required` |
| `invited` (`s2-15-user-invited`) | `invited` | `403 organization_membership_required` | `403 organization_membership_required` |
| `disabled` (`s2-15-user-disabled`) | `disabled` | `403 organization_membership_required` | `403 organization_membership_required` |

Observations:

- `owner` (Section 11) and `admin` are allowed to download org-level runs because `manager`/`viewer` are denied org-level by design (S2-20 Section 6: "deny-by-default until an org-level scope model exists"). `admin` returned `200` with raw PDF bytes whose size (`2047`) and sha256 prefix (`fc62c1bb2b92...`) match the owner-side download.
- `manager` and `viewer` denied org-level downloads with `403 organization_scope_required`. The denial fires even though both roles have `s2-15-fixture-client-1` / `s2-15-fixture-location-1` in their assignment lists, because the smoke run has `client_id: null` and `location_id: null` and the route's `assertManagerOrViewerDownloadScope` denies before consulting assignments in that case.
- `member` denied with `403 organization_role_required` because `member` is not in `REPORT_DOWNLOAD_BROAD_ROLES` and not in `REPORT_DOWNLOAD_SCOPED_ROLES`.
- `invited` and `disabled` denied with `403 organization_membership_required` because their membership `status` is not `active`; `requireOrganizationMembership` rejects them before the route reaches the role check.
- JWT `role` claim was always the default `"individual"`; authorization decisions came from `organization_members` only.
- A `manager`/`viewer`-with-positively-matching-scope success path was not exercised in this smoke because the existing smoke row is org-level. Unit tests in `apps/api/src/routes/reports.test.js` already cover manager-with-client-scope allow and viewer-with-location-scope allow.

## 13. Error / Edge Probes (Non-Mutating)

| label | URL | HTTP | `error.code` |
| --- | --- | --- | --- |
| invalid format (`csv`) | `.../runs/<run_id>/outputs/csv` | `400` | `bad_request` |
| unknown format (`json`) | `.../runs/<run_id>/outputs/json` | `400` | `bad_request` |
| missing run (`s2-24-1-no-such-run`) | `.../runs/s2-24-1-no-such-run/outputs/pdf` | `404` | `report_run_not_found` |
| no auth header | `.../runs/<run_id>/outputs/pdf` | `401` | `unauthorized` |

`404 report_output_not_found` (missing format on an existing run) is **skipped** for this live smoke. The route validates `format` against `REPORT_DOWNLOAD_FORMATS = ["pdf", "xlsx"]` before the run lookup and the output lookup, so any non-`pdf`/non-`xlsx` value is rejected at the `400 bad_request` stage instead of reaching the per-output lookup. Exercising the `404` branch live would require either a `report_runs` row where `outputs[]` is missing one of `pdf`/`xlsx` (data mutation in production / fixture surface, out of scope per the task constraint "Do not mutate data"), or a code change to surface the branch through an alternate probe (also out of scope). The branch remains covered by the S2-24 unit test in `apps/api/src/routes/reports.test.js` ("missing format on the run returns 404 report_output_not_found").

`409 report_output_not_ready`, `500 report_output_read_failed`, and `500 report_output_integrity_failed` are also not probed live for the same reason: they require either pending/failed outputs, intentionally tampered storage, or intentionally corrupted persisted bytes. All three branches are covered by the S2-24 unit tests.

## 14. Sanitization Confirmation

Both header captures (`/tmp/s2-24-1-pdf-headers.txt`, `/tmp/s2-24-1-xlsx-headers.txt`) and a follow-up scan over the captured request URLs were checked for leakage:

- No header contains the literal `/tmp/`, `/var/www/`, `REPORT_STORAGE_LOCAL_DIR`, or the configured smoke root literal `parametrics-s2-24-1-report-storage`.
- No header contains an absolute server path, a `storage_key` segment, a Mongo `_id`, or any `report_runs` document field beyond `Content-Type`, `Content-Disposition` (with the sanitized filename), and `Content-Length`.
- `Content-Disposition` filename matches `^[A-Za-z0-9._-]+$` for both formats and is derived from `report_key`+`run_id`+`format`; no user-controlled report-name string is echoed.
- The downloaded response bodies are raw PDF/XLSX bytes (Section 11 first-bytes check). No JSON error envelope, no base64 alphabet body, no echoed query-string parameters, no echoed metric name (`BUSINESS_IMPRESSIONS_SEARCH`) appears in any byte stream that was inspected for body framing.
- Error probe bodies (`bad_request`, `report_run_not_found`, `unauthorized`) are short JSON envelopes with `error.code` and `error.message`; they do not include `runId`, storage paths, or auth header values.

## 15. Mongo Summary (No Raw Docs Printed)

Connected to the existing configured local Mongo database (`parametrics`) via the shared `getDb()` helper. Counts only:

- `report_runs.countDocuments({ report_key: "s2-24-1-smoke-dashboard" })`: `1`.
- `report_runs.countDocuments({ id: "<run_id>" })`: `1`.
- `report_runs.countDocuments({ organization_id: "s2-15-fixture-org" })`: `2` (the S2-22.1 row + the S2-24.1 row created in Section 9).
- `report_runs.countDocuments({ organization_id: "s2-15-fixture-org", status: "succeeded" })`: `2`.
- `report_runs.countDocuments({ organization_id: "s2-15-fixture-org", status: "failed" })`: `0`.
- `location_org_map.countDocuments({ organization_id: "s2-15-fixture-org" })`: `0` (legacy collection still untouched by fixture scope).

Per-output flags on the persisted S2-24.1 row (projection `_id: 0, input_snapshot: 0`; no raw doc printed):

| field | pdf | xlsx |
| --- | --- | --- |
| `status` | `succeeded` | `succeeded` |
| `path === null` | `true` | `true` |
| `storage_provider` | `local` | `local` |
| `storage_key` relative (no leading `/`, no Windows drive) | `true` | `true` |
| has `content_type` | `true` | `true` |
| has `filename` | `true` | `true` |
| `checksum.algorithm === "sha256"` with 64-hex value | `true` | `true` |
| has `generated_at` | `true` | `true` |
| `expires_at` | `null` | `null` |
| has `buffer` field | `false` | `false` |
| has `base64` field | `false` | `false` |

`input_snapshot` is not present on the persisted document; `input_snapshot_summary` is. No raw Mongo documents were printed.

## 16. Secret / Raw Record Confirmation

- No JWTs were printed in this proof doc or in any terminal output captured here. The minted local JWTs lived in `/tmp/s2-24-1-tokens/<role>.txt` (`0600`) for the duration of the smoke and were removed afterward.
- No OAuth access/refresh/ID tokens, auth codes, authorization headers, encrypted secret payloads, passwords, emails, or raw user records appear in this doc, the captured request URLs, the captured response headers, the captured response bodies, the Mongo summary, or the helper script outputs.
- The Mongo connection log line was redacted at the credential portion: `mongodb+srv://***:***@cluster0.l9tto5f.mongodb.net/...`. No live credential value is reproduced here.
- The captured response headers were scanned for `/tmp/`, `/var/www/`, `REPORT_STORAGE_LOCAL_DIR`, the configured smoke root literal, `@`-style addresses, and the original `BUSINESS_IMPRESSIONS_SEARCH` metric name from the Section 9 request body. None appear.
- The response bodies are raw PDF/XLSX bytes by design; only the byte-level magic prefix (`%PDF`, `PK\x03\x04`) is reproduced in this doc.

## 17. Checks Run

```bash
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --name-only -- apps/api/src apps/web/src apps/api/package.json apps/web/package.json package-lock.json
git diff --check
```

Outcomes:

- `cd apps/api && npm test`: `1..176 # tests 176 # pass 176 # fail 0 # skipped 0` (same focused matrix as S2-24).
- `cd apps/web && npm test -- --run`: `Test Files 4 passed (4) / Tests 21 passed (21)`.
- `cd apps/web && npm run build`: `286 modules transformed. ✓ built in ~4s` (pre-existing Browserslist data-age warning unchanged).
- `git diff --name-only -- apps/api/src apps/web/src apps/api/package.json apps/web/package.json package-lock.json`: empty.
- `git diff --check`: no whitespace conflicts.

API process was stopped (`pkill -f "node src/server.js"`) and a follow-up health probe confirmed the port refused connections.

## 18. Skipped / Remaining Risks

- Org-level smoke only. The smoke row created in Section 9 has `client_id: null` and `location_id: null`, so the manager/viewer positively-matching-scope download branch (`200` raw bytes for a run inside the requester's assignments) was not exercised live. Existing S2-24 unit tests cover that positively-matching path.
- `404 report_output_not_found`, `409 report_output_not_ready`, `500 report_output_read_failed`, and `500 report_output_integrity_failed` were not exercised live because reproducing them safely requires either intentional data mutation (pending/failed outputs, deleted bytes on disk, deliberately tampered checksum metadata) or code changes. All four branches are covered by the S2-24 unit tests in `apps/api/src/routes/reports.test.js`.
- A fresh fixture run had to be generated at smoke start (Section 9) because the S2-22.1 storage directory under `/tmp` was wiped between 2026-05-12 and 2026-05-16. The fresh run produces a second `report_runs` row under the controlled fixture scope (`s2-15-fixture-org`, `report_key: s2-24-1-smoke-dashboard`); the previously-recorded S2-22.1 row remains in Mongo for forensic continuity but is no longer downloadable because its on-disk bytes are gone. Production deployments that need durable history across `/tmp` cleanup must set `REPORT_STORAGE_LOCAL_DIR` to a persistent path outside `/tmp`, as called out in the S2-22.1 risks.
- No dedicated `report.output.download` audit event and no dedicated `report_download` rate-limit bucket are wired today; the smoke did not attempt to trigger or verify either. Both items remain reserved in the S2-20 contract.
- `Content-Disposition` uses ASCII-safe filenames only; the route does not emit `filename*=UTF-8''…` because there is no need for non-ASCII filenames in the current report set.
- The S2-22.1 and S2-24.1 smoke `report_runs` rows intentionally remain in MongoDB because no safe delete route exists. Same convention as the S2-15 / S2-16.1 / S2-17.1 / S2-22.1 / S2-23.1 fixtures.
- The route reads the full buffer into memory and sends it via `res.end`. The storage adapter caps individual outputs at 25 MB; the S2-24.1 outputs are 2 KB / 9 KB, well inside that cap. Switching to a true `ReadableStream` is reserved for a future task (matches the S2-20 contract direction).
- Pre-existing Browserslist build warning is unchanged.

## 19. Code Changes Needed

No. The route, store helpers, storage adapter, role/scope rules, and integrity checks all behaved correctly against live local API + Mongo without any code edits. The only data mutation was the one fresh fixture run created in Section 9 (necessary because the S2-22.1 on-disk bytes were missing).

## 20. Ready For GPT Verification

Yes. The smoke proved the S2-24 read-only download endpoint end-to-end against a real local API + Mongo. Confirmed: HTTP 200 for owner/admin with raw PDF/XLSX bytes (not JSON, not base64), matching persisted `Content-Type`, ASCII-safe `Content-Disposition: attachment; filename="..."`, matching `Content-Length`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, downloaded byte size matching persisted `output.size`, downloaded sha256 matching persisted `output.checksum.value`, org-level `manager`/`viewer` denied with `403 organization_scope_required`, `member` denied with `403 organization_role_required`, `invited`/`disabled` denied with `403 organization_membership_required`, invalid/unknown format rejected with `400 bad_request`, unknown run id rejected with `404 report_run_not_found`, missing auth rejected with `401 unauthorized`, no `_id`/`input_snapshot`/`buffer`/`base64`/absolute path leakage, no JWT/email/raw user record/raw Mongo doc printed, `location_org_map` untouched. Only the API runtime was started; workers and scheduler were not started. The API process was stopped after the smoke and the port was confirmed free.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-24.1 report output download live smoke was verified after local API/Mongo/disk smoke, raw-byte download checks, header checks, size/checksum integrity checks, role denial checks, API tests, web tests, web build, no-source-diff checks, and diff checks.
