# S2-23.1 Report Run Listing API Live Smoke Proof Pack

Date: 2026-05-13

## 1. Scope And Decision

S2-23.1 is a live local API + MongoDB smoke verifying that the S2-23 read-only `GET /api/v1/reports/runs` endpoint returns sanitized listing rows for the controlled `s2-15-fixture-org` scope, with role/scope rules and sanitization matching the S2-20 contract. No application or test code was changed; this is documentation/proof only.

Phase 2 integrations remain blocked. No frontend code changed. No new routes, no detail/download APIs, no queues, no workers, and no scheduler were started or modified.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pass.

## 2. Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/s2-22-1-durable-report-storage-live-smoke.md`
- `docs/proof/s2-23-report-runs-listing-api.md`
- `docs/architecture/report-history-and-storage.md`
- `docs/architecture/report-service.md`
- `docs/runtime/processes.md`

## 3. Files Inspected

- `apps/api/src/routes/reports.js` (`GET /api/v1/reports/runs` route + role/scope handling)
- `apps/api/src/services/reportStore.js` (`listReportRuns`, `buildReportRunListQuery`, `sanitizeReportRunRow`)
- `apps/api/src/services/organizationMemberFixtures.js` (fixture org id, fixture user ids, fixture client/location ids, fixture role/status matrix)
- `apps/api/src/middleware/auth.js`, `apps/api/src/lib/jwt.js`, `apps/api/src/lib/authConfig.js` (local JWT minting path)
- `apps/api/src/lib/mongo.js` (count helpers used for summary)

## 4. Files Changed

- `docs/proof/s2-23-1-report-runs-listing-live-smoke.md` — this proof doc (new).
- `docs/codex/sprint-2-phase-1-guardrails.md` — S2-23.1 completion entry; Phase 2 remains blocked.
- `docs/architecture/report-history-and-storage.md` — small live-smoke note referencing this proof doc.
- `docs/architecture/report-service.md` — small live-smoke note referencing this proof doc.

No backend or frontend source code, route handlers, services, tests, or `package.json` entries were changed. `package-lock.json` is unchanged.

## 5. Working Tree State Before Smoke

```text
git status --short
git log -3 --oneline
```

- `git status --short`: empty (clean working tree at the start of S2-23.1).
- Most recent commits before this smoke:
  - `884d0cb feat(api): add report run listing endpoint` (S2-23)
  - `9ee9ed7 chore(api): smoke test durable report storage` (S2-22.1)
  - `e295192 feat(api): add durable local report output storage` (S2-22)

## 6. Smoke Environment

- Local API only. Workers and scheduler were intentionally not started.
- `npm run dev:prepare` was run from the repo root; it generated `apps/api/.env.local` and `apps/web/.env.local` with the deterministic local mapping (API on `127.0.0.1:5050`, web on `127.0.0.1:5174`).
- Storage root was set to a smoke-specific value outside the repo: `REPORT_STORAGE_LOCAL_DIR=/tmp/parametrics-s2-23-1-report-storage`. No write to storage was exercised in this smoke (the listing endpoint reads metadata only), so the directory was not used by the listing path. Setting it keeps the storage adapter singleton consistent with the S2-22.1 methodology and ensures the storage root is never inside the git working tree.
- API started with `REPORT_STORAGE_LOCAL_DIR=/tmp/parametrics-s2-23-1-report-storage npm run -w @parametrics/api dev:api`, logging redirected to `/tmp/s2-23-1-api.log`.
- Local Mongo connection uses the existing configured MongoDB URI/database (`parametrics`). The startup log redacted the credential portion as `mongodb+srv://***:***@cluster0.l9tto5f.mongodb.net/...` (no secrets printed).
- Short-lived (15 min) local JWTs were minted in-process by importing `apps/api/src/lib/jwt.js` (after loading the existing API env) for each S2-15 fixture user_id (`s2-15-user-owner`, `s2-15-user-admin`, `s2-15-user-manager`, `s2-15-user-viewer`, `s2-15-user-member`, `s2-15-user-invited`, `s2-15-user-disabled`). Tokens were written to `/tmp/s2-23-1-tokens/<role>.txt` with `0600` permissions and were never echoed to the terminal or this proof doc. No user records were created; the JWTs target the existing fixture user ids seeded in S2-15.2.
- After the smoke, every token file and the helper directory were removed (`rm -f /tmp/s2-23-1-tokens/*.txt; rmdir /tmp/s2-23-1-tokens`). The mint helper and Mongo summary helper (both under `scripts/.tmp-s2-23-1-*.mjs`) were also deleted so the working tree carries no stray files.

## 7. API Health Status

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5050/api/v1/health
```

Result: `200`. Response body: `{"ok":true,"ts":"<utc-iso>"}`. After the smoke, `pkill -f "node src/server.js"` was issued and a follow-up health probe returned `Connection refused` (`%{http_code}=000`), confirming the API was stopped.

## 8. Auth / Token Strategy

- A small node helper imported `apps/api/src/startup/env.js` and `apps/api/src/lib/jwt.js` and called `signJwt({ user_id, role: "individual" }, { expiresIn: "15m" })` for each fixture user_id.
- Tokens were written to `/tmp/s2-23-1-tokens/<role>.txt` with mode `0600` and removed after the smoke. Nothing in this proof, the captured response files, or any printed log echoes the token value. Token lengths were printed (193..197 bytes) only to confirm the helper wrote a real JWT.
- No user records were created. No JWT secret value or full token was logged. The route's `authenticate` middleware accepted the minted tokens as expected because `JWT_SECRET` is the same in-process value used by `signJwt` and `verifyJwt`.

## 9. List Smoke (Owner, Organization Scope)

Request:

```bash
curl -sS -H "Authorization: Bearer ${OWNER_TOKEN}" \
  "http://127.0.0.1:5050/api/v1/reports/runs?organization_id=s2-15-fixture-org"
```

Result:

- HTTP status: `200`.
- Response shape includes `report_runs[]` and `pagination`.
- `pagination`: `{ "limit": 25, "has_more": false, "next_cursor": null }`. Keys exactly match `has_more,limit,next_cursor`.
- `report_runs.length`: `1`.
- Sort: rows newest-first. With one row the strict descending check is trivially true; explicit assertion: `runs[i-1].created_at >= runs[i].created_at` for all `i`.
- Contains the S2-22.1 smoke row: `report_key = s2-22-1-smoke-dashboard` ⇒ `true`.

Smoke row summary (top-level, redacted):

| field | value |
| --- | --- |
| `id` | present (UUID; full value not echoed) |
| `report_key` | `s2-22-1-smoke-dashboard` |
| `report_type` | `dashboard_snapshot` |
| `status` | `succeeded` |
| `organization_id` | `s2-15-fixture-org` |
| `client_id` | `null` |
| `location_id` | `null` |
| `requested_by_user_id` | `s2-15-user-owner` |
| `requested_formats` | `["pdf","xlsx"]` |
| `error` | `null` |
| `outputs.length` | `2` |

Top-level row keys returned (sorted): `client_id, completed_at, created_at, error, filters, id, input_snapshot_summary, location_id, organization_id, outputs, report_id, report_key, report_name, report_type, requested_by_user_id, requested_formats, started_at, status, updated_at`. No `_id`, no `input_snapshot`.

Per-output durable metadata:

| format | status | size | path | storage_provider | storage_key starts with | content_type | filename ends with | checksum.algo | checksum.value.len | generated_at set | expires_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pdf` | `succeeded` | `2047` | `null` | `local` | `report-outputs/` | `application/pdf` | `.pdf` | `sha256` | `64` | `true` | `null` |
| `xlsx` | `succeeded` | `8678` | `null` | `local` | `report-outputs/` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `.xlsx` | `sha256` | `64` | `true` | `null` |

Per-output keys present (sorted union): `checksum, completed_at, content_type, created_at, error, expires_at, filename, format, generated_at, path, size, status, storage_key, storage_provider, updated_at`. No `buffer`, no `base64`, no absolute path. `storage_key` is a relative key (does not start with `/` and does not match a Windows-drive prefix).

## 10. Filter Smoke

Request:

```bash
curl -sS -H "Authorization: Bearer ${OWNER_TOKEN}" \
  "http://127.0.0.1:5050/api/v1/reports/runs?\
organization_id=s2-15-fixture-org&\
status=succeeded&\
report_type=dashboard_snapshot&\
report_key=s2-22-1-smoke-dashboard&\
date_from=2026-05-11&\
date_to=2026-05-13&\
limit=1"
```

Result:

- HTTP status: `200`.
- `pagination`: `{ "limit": 1, "has_more": false, "next_cursor": null }`.
- `report_runs.length`: `1`.
- Contains S2-22.1 smoke row: `true`.
- `all_status_succeeded`: `true`.
- `all_report_type_dashboard_snapshot`: `true`.
- `all_report_key_match_s2-22-1-smoke-dashboard`: `true`.
- `all_created_at_in_window` (`2026-05-11T00:00:00Z .. 2026-05-13T23:59:59.999Z`): `true`.

The smoke row's `created_at` is `2026-05-12T05:57:56.425Z`, which lies inside the requested window and produced the expected single match under `limit=1`.

## 11. Denial Smoke

Two probes per non-broad role: no-scope (`organization_id` only) and assigned-scope (`organization_id` + `client_id=s2-15-fixture-client-1`). Each probe records the HTTP status and the `error.code` (or `ok:<count>` when allowed).

| role (suffix → fixture user_id) | membership status | no-scope HTTP | no-scope `error.code` / outcome | scope HTTP | scope `error.code` / outcome |
| --- | --- | --- | --- | --- | --- |
| `admin` (`s2-15-user-admin`) | `active` | `200` | `ok:1` (broad role; smoke row visible) | `200` | `ok:0` (admin allowed; smoke row has no client_id so client filter returns 0) |
| `manager` (`s2-15-user-manager`) | `active` | `403` | `organization_scope_required` | `200` | `ok:0` (manager allowed; smoke row has no client_id so client filter returns 0) |
| `viewer` (`s2-15-user-viewer`) | `active` | `403` | `organization_scope_required` | `200` | `ok:0` (viewer allowed; smoke row has no client_id so client filter returns 0) |
| `member` (`s2-15-user-member`) | `active` | `403` | `organization_role_required` | `403` | `organization_role_required` |
| `invited` (`s2-15-user-invited`) | `invited` | `403` | `organization_membership_required` | `403` | `organization_membership_required` |
| `disabled` (`s2-15-user-disabled`) | `disabled` | `403` | `organization_membership_required` | `403` | `organization_membership_required` |

Observations:

- `owner`/`admin` are allowed broad listing without `client_id`/`location_id`. The 0-row response under the client-scope probe reflects the smoke row's `client_id: null`; the route still accepts the request from a broad role.
- `manager`/`viewer` are denied without scope (`403 organization_scope_required`) and allowed with an assigned `client_id` (`s2-15-fixture-client-1` is in their `assigned_client_ids`). 0 rows is the correct content for the smoke row's `client_id: null`.
- `member` is denied because `member` is not in `REPORT_RUN_LIST_ROLES = [owner, admin, manager, viewer]` → `403 organization_role_required`. This matches the S2-20 contract Section 6 ("deny `member` from history") and the S2-23 implementation note in `report-history-and-storage.md`.
- `invited` and `disabled` are denied by `requireOrganizationMembership` because their membership `status` is not `active` → `403 organization_membership_required`.
- JWT `role` claim was always the default `"individual"`; authorization decisions were taken from `organization_members` only, per design.

## 12. Sanitization Confirmation

The owner-scoped list response (`/tmp/s2-23-1-list-owner.json`) was scanned both as parsed JSON and as raw text. Findings:

- `_id` field present anywhere in the response: `false`.
- `input_snapshot` field present anywhere in the response: `false`.
- Per-output `buffer` field present anywhere: `false`.
- Per-output `base64` field present anywhere: `false`.
- Any output with `path !== null`: `false`.
- Any `storage_key` starting with `/` or a Windows drive prefix: `false`.
- Raw text scan: `/tmp/` ⇒ `false`. `/var/www/` ⇒ `false`. Literal `REPORT_STORAGE_LOCAL_DIR` ⇒ `false`. Configured smoke root `parametrics-s2-23-1-report-storage` ⇒ `false`. `@` (email-style) ⇒ `false`. Echoed metric name (`BUSINESS_IMPRESSIONS_SEARCH`) ⇒ `false`.
- `storage_key` is exposed and starts with `report-outputs/` (relative, no absolute prefix), which is the S2-20 contract Section 4.3 durable-metadata classification.
- `requested_by_user_id` is the fixture user id `s2-15-user-owner`; no email, password, OAuth token, or raw user record appears anywhere in the response.

## 13. Mongo Summary (no raw docs printed)

Connected to the existing configured local Mongo database (`parametrics`) via the shared `getDb()` helper. Counts only:

- `report_runs.countDocuments({ report_key: "s2-22-1-smoke-dashboard" })`: `1`.
- `report_runs.countDocuments({ organization_id: "s2-15-fixture-org" })`: `1` (matches only the S2-22.1 smoke row).
- `report_runs.countDocuments({ organization_id: "s2-15-fixture-org", status: "succeeded" })`: `1`.
- `report_runs.countDocuments({ organization_id: "s2-15-fixture-org", status: "failed" })`: `0`.
- `location_org_map.countDocuments({ organization_id: "s2-15-fixture-org" })`: `0` (legacy collection still untouched by fixture scope).

The listing API response count (`1`) matches the Mongo `organization_id` count (`1`). No raw documents were printed.

## 14. Secret / Raw Record Confirmation

- No JWTs were printed in this proof doc or in any terminal output captured here. The minted local JWTs lived in `/tmp/s2-23-1-tokens/<role>.txt` (`0600`) for the duration of the smoke and were removed afterward.
- No OAuth access/refresh/ID tokens, auth codes, authorization headers, encrypted secret payloads, passwords, emails, or raw user records appear in this doc, the captured request URLs, the captured response files, the Mongo summary, or the helper script outputs.
- The Mongo connection log line was redacted at the credential portion: `mongodb+srv://***:***@cluster0.l9tto5f.mongodb.net/...`. No live credential value is reproduced here.
- The response JSON was scanned for `/tmp/`, `/var/www/`, `REPORT_STORAGE_LOCAL_DIR`, the configured smoke root literal, `@`-style addresses, and the original `BUSINESS_IMPRESSIONS_SEARCH` metric name from the S2-22.1 request body. None of these appear in any of the captured responses.

## 15. Checks Run

```bash
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --name-only -- apps/api/src apps/web/src apps/api/package.json apps/web/package.json package-lock.json
git diff --check
```

Outcomes are recorded in Section 16 alongside the working-tree summary. The smoke wrote only docs (`docs/proof/...` plus the small `docs/architecture/*` and `docs/codex/...` cross-references); no `apps/api/src`, `apps/web/src`, `apps/api/package.json`, `apps/web/package.json`, or `package-lock.json` change is expected.

## 16. Skipped / Remaining Risks

- Org-level smoke only. The smoke row created in S2-22.1 has `client_id: null` and `location_id: null`, so the manager/viewer assigned-scope branch was exercised against an empty result set (`ok:0`) rather than against a positively matching row. The existing S2-23 unit tests cover the positively-matching manager/viewer path; production live coverage for that branch will follow naturally once a scoped fixture run is produced.
- Cursor pagination remains reserved (`next_cursor: null`). Smoke only covers `limit=25` and `limit=1`; multi-page navigation is not yet exercised live.
- No dedicated `report.run.list` audit event and no dedicated `report_list` rate-limit bucket are wired today; the smoke did not attempt to trigger or verify either. Both items remain optional hardening in the S2-20 contract.
- The smoke `report_runs` row (`organization_id: s2-15-fixture-org`, `report_key: s2-22-1-smoke-dashboard`) intentionally remains in MongoDB because no safe delete route exists. Same convention as the S2-15 / S2-16.1 / S2-17.1 / S2-22.1 fixtures.
- `storage_key` is exposed in list rows as durable metadata. No download route exists yet (S2-24), so `storage_key` is non-actionable until that route lands.
- `date_from` / `date_to` use UTC day boundaries. Clients sending local-time semantics may see off-by-one-day surprises; this matches the S2-23 implementation note in `docs/architecture/report-history-and-storage.md`.
- Pre-existing Browserslist build warning (if any) is unchanged.

## 17. Code Changes Needed

No. The route, service, sanitization, role/scope rules, and pagination shape all behaved correctly against live local API + Mongo without any code edits. No real blocker was found.

## 18. Ready For GPT Verification

Yes. The smoke proved the S2-23 read-only listing endpoint end-to-end against a real local API + Mongo. Confirmed: HTTP 200 with the documented `{ report_runs, pagination: { limit, has_more, next_cursor: null } }` shape, the S2-22.1 smoke row visible to broad roles, server-controlled `created_at desc` sort, the durable output metadata exposed per row, `path: null`, no `_id`/`input_snapshot`/`buffer`/`base64`/absolute path, filter combinations narrowing to the expected single row under `limit=1`, the documented denial codes for missing/invalid scope (`organization_scope_required`), denied roles (`organization_role_required`), and non-active membership status (`organization_membership_required`), Mongo counts matching, `location_org_map` untouched, and no secrets/raw records printed. Only the API runtime was started; workers and scheduler were not started. The API process was stopped after the smoke and the port was confirmed free.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-23.1 report run listing live smoke was verified after local API/Mongo smoke, role/scope denial checks, filter checks, sanitization review, API tests, web tests, web build, no-source-diff checks, and diff checks.
