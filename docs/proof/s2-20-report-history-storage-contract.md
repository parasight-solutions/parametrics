# S2-20 Report History And Storage Contract Proof Pack

Date: 2026-05-11

## 1. Scope And Decision

S2-20 is the docs-only design contract for the next report foundation step. It defines the future report history listing, run detail, output download, optional regenerate, and durable output storage in `docs/architecture/report-history-and-storage.md` and updates the existing report service architecture doc to link to it.

S2-20 is documentation/design only. No backend or frontend code, routes, services, queues, workers, scheduler behavior, auth/JWT/provider behavior, GBP/report/location runtime behavior, member-management services, RBAC middleware, billing/entitlements, Phase 2 providers, Google location binding behavior, file/cloud storage implementation, email delivery, frontend history UI, dependencies, destructive scripts, or API/worker/scheduler runtime services were changed or run.

Sprint 2 / Phase 1 closeout (S2-18) and the S2-19 API `npm test` script consolidation are accepted preconditions for this design.

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
- `docs/runtime/processes.md`
- `docs/architecture/report-service.md`
- `docs/architecture/member-management-api-contract.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`
- `apps/api/package.json`
- `apps/api/src/server.js` (mount path for `/api/v1/reports`)
- `apps/api/src/routes/reports.js` (existing route + audit codes for consistency)

## 3. Files Changed

- `docs/architecture/report-history-and-storage.md` — new contract doc.
- `docs/architecture/report-service.md` — appended an S2-20 section linking to the new contract; kept current state vs target state separate.
- `docs/codex/sprint-2-phase-1-guardrails.md` — added S2-20 to the completed Sprint 2 task list and a detailed completion paragraph; Phase 2 remains blocked.
- `docs/proof/sprint-2-closeout-proof-pack.md` — small follow-up note on the existing S2-20 next-task line pointing at the contract/proof docs (no closeout history rewrite).
- `docs/proof/s2-20-report-history-storage-contract.md` — this proof doc (new).

No backend source files changed. No frontend source files changed. No `apps/api/package.json` or `apps/web/package.json` changed. No `package-lock.json` change. No dependencies installed.

## 4. Contract Doc Path

`docs/architecture/report-history-and-storage.md`

## 5. Proposed Endpoints

All endpoints are designed only. Nothing is implemented in S2-20.

- `GET /api/v1/reports/runs` — sanitized listing of report runs in a single `organization_id`, with optional `client_id`, `location_id`, `report_type`, `report_key`, `status`, `date_from`, `date_to`, `limit` (default 25, max 100), `cursor`, `offset` (max 1000), and `sort` (default `created_at_desc`).
- `GET /api/v1/reports/runs/:runId` — sanitized single-run detail with a `links.outputs[]` array of relative API download paths and `available` flags. `404 report_run_not_found` is returned both when the row is missing and when the row is not visible to the requester, to avoid leaking existence.
- `GET /api/v1/reports/runs/:runId/outputs/:format` — streams durable bytes for `pdf` or `xlsx`. `Content-Type` from `outputs[].content_type`; `Content-Disposition` filename is server-sanitized. Bytes never round-trip through MongoDB or base64. Returns `409 output_not_available` for legacy runs that never wrote to durable storage.
- `POST /api/v1/reports/runs/:runId/regenerate` — optional future. Sketched only; not implementable until durable storage and a queue boundary exist. May return `501 not_implemented` during the synchronous-only phase.

Each endpoint documents its auth/membership rules, query/body params, response shape, safe error codes, pagination, sorting, audit event, and rate-limit bucket. Audit codes: `report.run.list`, `report.run.read`, `report.output.download`, plus the existing `report.dashboard_snapshot.generate` codes from S2-05. Rate-limit buckets: `report_list` (default `RATE_LIMIT_REPORT_LIST_MAX = 120`) and `report_download` (default `RATE_LIMIT_REPORT_DOWNLOAD_MAX = 60`), both keyed by `req.user.user_id + organization_id`.

## 6. Storage Contract Summary

Storage uses a `ReportStorageAdapter` abstraction (`apps/api/src/services/reportStorage.js`, future), with `writeOutput`, `readOutputStream`, `statOutput`, `deleteOutput` methods. Local-filesystem adapter for development reads its root path from `REPORT_STORAGE_LOCAL_DIR`. Cloud adapters (S3/GCS/Azure) implement the same interface; storage credentials are configured separately and never recorded in `report_runs` or in API responses.

Storage key convention: `report-outputs/<organization_id>/<YYYY>/<MM>/<run_id>.<format>`. Keys derive from sanitized ids only; no user-controllable strings are embedded.

Additive `report_runs.outputs[]` fields: `storage_provider`, `storage_key` (server-only), `content_type`, `filename`, `checksum` (`{ algorithm, value }`, optional first cut), `generated_at`, `expires_at` (always `null` until signed-link work lands), and a compact `error`. The existing `path` field stays `null` so absolute server paths are never exposed.

Forbidden anywhere in `report_runs.outputs[]` or responses: raw absolute paths, signed URLs persisted in Mongo, adapter credentials, raw PDF/XLSX buffers, base64 buffers, raw `input_snapshot` body.

Storage decisions in plain English: bytes do not live in Mongo, clients never see absolute paths or storage keys, provider identity is recorded with each output to support per-environment migration, and the existing synchronous route may begin writing durable bytes during the storage implementation task without requiring a queue.

## 7. Authorization Decision

Authorization always resolves an `active` membership in `organization_members`. JWT `role` claim and `location_org_map` are never consulted for workspace authorization.

| Role | List / Detail | Download |
| --- | --- | --- |
| `owner` | All runs in the organization. | All outputs in the organization. |
| `admin` | All runs in the organization. | All outputs in the organization. |
| `manager` | Runs whose `client_id`/`location_id` are in assignments; org-level runs only with org-level scope. | Same filter. |
| `viewer` | Same filter as `manager`, read-only. | Same filter. |
| `member` | **Deny.** | **Deny.** |
| `invited` / `disabled` / missing | Deny. | Deny. |

Justification for denying `member`:

- Mirrors the existing S2-12 read-only member listing denial of `member`, keeping the role surface coherent.
- `member` can still consume the live GBP dashboard subject to the existing owned-location guard; that path is unchanged.
- Granting `member` history access would expose dashboard snapshots beyond the live UI scope without first defining a per-member assignment story. A future task may extend a `viewer`-like read-only history permission if demand is verified.

Imported Google location and shared-access rules are unchanged: imported locations are never auto-bound, and the existing owned-location guard still runs ahead of every membership check on GBP location-bound paths. History endpoints only authorize against `report_runs` rows that already passed those guards at run creation time.

## 8. Frontend UX Decision

Recommended frontend route: `/reports/history`. A read-only authenticated page wired through the existing `api()` client.

Columns: Created, Report name, Type, Scope (organization/client/location labels via existing lookups — never email or raw user records), Date range, Formats, Status, Requested by (display name when available, otherwise `User <short-id>`), Actions (per-output download buttons disabled when `available: false`).

Filters: organization picker (existing), optional client, optional location, optional report type, optional status, date range bounded to 366 days defaulting to last 30 days.

Status badges: `pending` and `running` neutral, `succeeded` success, `failed` danger; per-output `Unavailable` badge when `available: false`.

Downloads: `GET /api/v1/reports/runs/:runId/outputs/:format` only. The frontend never reconstructs storage URLs and never reads `storage_key`. Filename comes from `Content-Disposition` and is not overridden from frontend state. `409 output_not_available` surfaces an inline tooltip without retry.

Empty / error / loading states: existing spinner, friendly empty state pointing back to the GBP dashboard, backend `error.code`/`error.message` rendered verbatim via the existing `formatErrorEnvelope` helper. `401 unauthorized` clears app auth and redirects to login. Provider (Google) reauth banners must not clear app auth unless app auth itself is invalid; existing S1 reauth/stale-state rules carry forward.

Tests: pure-helper Vitest tests for filter parsing, status-badge classification, and error formatting. Component-render tests remain deferred until a React testing-library is installed in a separate task.

Display safety: emails, raw `input_snapshot`, storage keys, absolute paths, bucket names, and tokens are never displayed.

## 9. Migration / Index Impact

S2-20 is documentation only; no migration runs. Implementation tasks should:

- Keep the existing S2-04 `report_runs` indexes intact (unique `id`; `report_id + created_at`; `report_key + created_at`; `organization_id + created_at`; `client_id + created_at`; `location_id + created_at`; `status + created_at`).
- Add (in S2-22 or S2-23 as appropriate) compound indexes to back the scoped listing filters:
  - `organization_id + status + created_at`
  - `organization_id + client_id + created_at`
  - `organization_id + location_id + created_at`
- Keep `id` unique so the detail and download routes can resolve a run without scanning.

Output metadata additions (`storage_provider`, `storage_key`, `content_type`, `filename`, `checksum`, `generated_at`, `expires_at`) are additive on `report_runs.outputs[]`. Pre-existing rows produced by the current synchronous route remain valid: their outputs simply report `storage_provider: null`, `available: false`, and the download endpoint returns `409 output_not_available`.

## 10. Explicit Non-Goals

S2-20 does not include and does not authorize the implementation follow-ups to include:

- Phase 2 integrations or any new provider channel.
- Dashboard builder behavior.
- AI / premium feature layer.
- Multi-channel metrics.
- Billing or entitlements.
- Email delivery, scheduled/recurring reports, public sharing, signed-URL adapters.
- Cross-organization report search.
- Provider auth or JWT/auth middleware changes.
- Frontend code edits.
- Backend code edits, new routes, new services, new dependencies.
- Worker, scheduler, or destructive script execution.
- Removing or modifying current GBP dashboard exports, the synchronous report route, or its base64 response shape.
- Loosening of `organization_members`-based authorization, `location_org_map` canonicality, or owned-location guards.
- Printing or recording JWTs, OAuth tokens, refresh tokens, ID tokens, auth codes, authorization headers, encrypted secrets, raw provider payloads, raw user records, passwords, or emails.

## 11. Remaining Risks

- Cursor pagination is recommended over offset, but implementing it correctly with the existing `created_at + id` shape requires a tiebreaker stable across writes. The S2-23 implementation task must define and test that tiebreaker.
- `report_runs` rows produced by the current synchronous route will return `409 output_not_available` from the download endpoint. The product owner must accept that historical runs prior to durable storage land are list/detail-only.
- `member` role denial from history may surface as a UX gap if a future role redesign reclassifies `member`. The contract explicitly leaves room for a future `viewer`-like permission.
- The local-filesystem storage adapter must reject paths outside `REPORT_STORAGE_LOCAL_DIR` to avoid traversal. Implementation tests should include a malicious-key test even though storage keys are server-controlled.
- Signed/short-lived download URLs are not yet designed. The contract reserves `expires_at` and a future adapter method but does not commit to specifics. A future task is required before enabling them.
- A `report-generate` queue is **explicitly deferred** until storage, listing, download, and UI are accepted. Adding it earlier would couple the queue to an unsettled storage contract.
- Pre-existing Browserslist build warning is unchanged.

## 12. Checks Run

```bash
git status --short
git diff --check
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --name-only -- apps/api/src apps/web/src apps/api/package.json apps/web/package.json package-lock.json
```

Results:

- `git status --short` lists only allowed docs files (`M docs/architecture/report-service.md`, `M docs/codex/sprint-2-phase-1-guardrails.md`, `M docs/proof/sprint-2-closeout-proof-pack.md`, `?? docs/architecture/report-history-and-storage.md`, `?? docs/proof/s2-20-report-history-storage-contract.md`).
- `git diff --check`: no output (no whitespace conflicts).
- `cd apps/api && npm test`: `1..114 # tests 114 # pass 114 # fail 0 # skipped 0`.
- `cd apps/web && npm test -- --run`: `Test Files 4 passed (4) / Tests 21 passed (21)`.
- `cd apps/web && npm run build`: `286 modules transformed. ✓ built in ~22s` (pre-existing Browserslist data-age warning unchanged).
- `git diff --name-only -- apps/api/src apps/web/src apps/api/package.json apps/web/package.json package-lock.json`: empty.

No API server, worker, or scheduler was started. No destructive scripts ran. No migrations or seed scripts ran.

## 13. Code Changes Needed

No. Documentation/design only.

## 14. Ready For GPT Verification

Yes. Working tree contains only the S2-20 contract doc, this proof doc, the small report-service link update, the guardrails entry, and a small follow-up note in the closeout proof pack. No backend or frontend source diff, no `package.json` or `package-lock.json` diff, no destructive command, no API/worker/scheduler service started, and the focused matrix, web tests, and web build all still pass.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-20 report history and storage contract was verified after docs-only review, API npm test, web tests, web build, no-source-diff checks, no-lockfile-diff checks, and diff checks.
