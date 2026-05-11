# S2-17.1 Workspace Member Management UI Browser Smoke Proof

Date: 2026-05-11

## Scope

S2-17.1 smoke-tested the `/organization-members` frontend page against the local API and local web dev server. The verification used non-interactive probes from the headless Claude Code shell because no interactive browser session was available; backend API behavior behind the page was independently validated through the same routes the page calls. This is proof/docs only — no backend or frontend source changes.

Routes / endpoints exercised:

- web: `GET http://127.0.0.1:5174/organization-members` (SPA shell)
- web dev module endpoints (vite served): `/src/pages/OrganizationMembers.jsx`, `/src/lib/memberManagement.js`, `/src/components/AppShell.jsx`
- api: `GET /api/v1/health`
- api (matches what the page calls): `GET /api/v1/orgs/:orgId/members`, `POST /api/v1/orgs/:orgId/members`, `PATCH /api/v1/orgs/:orgId/members/:memberId`, `POST /api/v1/orgs/:orgId/members/:memberId/disable`

Claude Code is the execution tool. Claude Code did not commit or push.

## Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/s2-16-1-member-management-api-smoke.md`
- `docs/proof/s2-17-workspace-member-ui.md`
- `docs/architecture/workspace-members.md`
- `docs/architecture/member-management-api-contract.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`
- `docs/runtime/processes.md`

## Files Inspected

- `apps/web/src/pages/OrganizationMembers.jsx`
- `apps/web/src/components/AppShell.jsx`
- `apps/web/src/lib/memberManagement.js`
- `apps/web/.env.local`
- `apps/api/.env.local`

## Files Changed

- `docs/proof/s2-17-1-workspace-member-ui-browser-smoke.md` (new)
- `docs/codex/sprint-2-phase-1-guardrails.md` (status update)
- `docs/backlog/sprint-2-workspace-member-foundation.md` (S2-17.1 row)
- `docs/architecture/workspace-members.md` (S2-17.1 smoke status)

No `apps/api`, `apps/web`, `package.json`, or `package-lock.json` files were modified.

## Starting State

```bash
git status --short
```

Result: clean. `git log --oneline -3` confirmed S2-17 (`feat(web): add organization member management UI`) is the head commit on `main`.

## Commands Run

```bash
git status --short
git log --oneline -3
npm run -w @parametrics/api dev:api &           # API only; workers/scheduler not started
npm run -w @parametrics/web dev -- --host 127.0.0.1 &
ss -ltn | grep -E ':5050|:5173|:5174'
curl -s -o /dev/null -w "api:%{http_code}\n" http://127.0.0.1:5050/api/v1/health
curl -s -o /dev/null -w "web:%{http_code}\n" http://127.0.0.1:5174/
curl -s -o /dev/null -w "members-page:%{http_code}\n" http://127.0.0.1:5174/organization-members
curl -s http://127.0.0.1:5174/organization-members | head
curl -s http://127.0.0.1:5174/src/pages/OrganizationMembers.jsx | grep -nE "Email invitations|invitation flow|Direct user_id|Sanitized rows" 
curl -s http://127.0.0.1:5174/src/components/AppShell.jsx | grep -nE "Members|/organization-members"
# Backend wiring probe (same endpoints the page calls), JWT signed in-process and never printed
node --input-type=module -e '<probe script: list/create/duplicate/patch/disable/denial>'
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --check
git diff --name-only -- apps/api/src apps/api/package.json package-lock.json
git diff --name-only -- apps/web/src apps/web/package.json package-lock.json
# Stop services
kill <api-pid>
kill <web-pid>
```

No workers or scheduler were started. The S2-17.1 probe script lives only in memory and was not written to the repo.

## API / Web Status

API:

- Started with `npm run -w @parametrics/api dev:api` only.
- Listening on `127.0.0.1:5050`.
- `GET /api/v1/health` returned `200`.
- Startup env log shows boolean readiness flags and a masked MongoDB URI only (no secrets printed).

Web:

- Started with `npm run -w @parametrics/web dev -- --host 127.0.0.1`.
- Vite reported `ready in 1272 ms` on `127.0.0.1:5174` (driven by `VITE_WEB_PORT=5174` in `apps/web/.env.local`; `VITE_API_BASE_URL=http://127.0.0.1:5050` so the page calls the API directly, not via the dev proxy).
- `GET /` returned `200`.
- `GET /organization-members` returned `200` and served the SPA shell HTML containing `<div id="root">` and `/src/main.jsx`.
- `GET /src/pages/OrganizationMembers.jsx` returned `200` with the transformed page module.
- `GET /src/lib/memberManagement.js` returned `200`.
- `GET /src/components/AppShell.jsx` returned `200` and contains `{ to: "/organization-members", label: "Members" }`.

Both services were stopped after the smoke. Final `ss -ltn` showed no parametrics-owned listener on `5174` (a separate unrelated project on `5173` continued to listen and was not touched).

## Browser / Manual Steps

This smoke ran from the headless Claude Code shell. Interactive browser steps (login form submission, button clicks, `window.confirm()` dialog, on-screen text rendering) were not exercised because no browser was driven. Server-side and API-side evidence below covers each item the task listed:

- Page renders inside AppShell: the served module imports `AppShell` and wraps the page; the AppShell module served at `/src/components/AppShell.jsx` includes the `Members` nav item targeting `/organization-members`. The SPA shell HTML for `/organization-members` is served with HTTP 200, so the React Router route resolves.
- Members nav item visible: confirmed in the served `AppShell.jsx` module — `{ to: "/organization-members", label: "Members" }` at line 10.
- Direct user_id limitation copy visible: the served page module contains both `subtitle: "Direct user_id-based workspace membership. Email invitations are not available yet."` and `"Direct membership by existing app user_id only. Backend role rules apply."`.
- Invitation-not-available copy visible: the served page module contains `"Direct create supports active or disabled only. Invited status requires an invitation flow that is not implemented yet."`.
- Sanitized-rows-only copy visible: the served page module contains `"Sanitized rows only. Emails and raw user records are not displayed."`.
- Organization selector loads / member list loads: validated by the backend wiring probe below; the page consumes the exact response shapes returned by those endpoints.

Explicit limitation: visual rendering, click-driven state changes, and the disable `window.confirm()` modal were not exercised. A human-driven browser pass remains a recommended follow-up.

## Selected Org Summary

Backend wiring probe targeted the controlled S2-15 fixture organization only:

- organization id: `s2-15-fixture-org`
- requester for read/positive path: `s2-15-user-owner` (active owner fixture)
- requester for negative path: `s2-15-user-manager` (active manager fixture; denied for member mutation)
- target user for mutations: `s2-17-smoke-user-browser-1` (new fixture-prefixed id; no real user record created)

No real users, real orgs, or Beetle/current working organizations were touched. JWTs were signed in-memory using the existing `JWT_SECRET` for fixture user_ids only; tokens were never logged, printed, written to files, or recorded in this document.

## Read / List Result

- `GET /api/v1/orgs/s2-15-fixture-org/members` returned HTTP `200` with 9 membership rows (7 S2-15 fixtures + 2 S2-16.1 smoke memberships that intentionally remain because no safe delete route exists).
- Sample row key check vs the documented canonical key set (`id`, `organization_id`, `user_id`, `role`, `status`, `assigned_client_ids`, `assigned_location_ids`, `invited_by_user_id`, `created_at`, `updated_at`): `sample-extra-keys=[]` — no unexpected keys, no `_id`, no email, no token, no secret, no provider/OAuth payload.

## Create / Edit / Disable Result

| Step | Method | HTTP | Body |
| --- | --- | --- | --- |
| create `s2-17-smoke-user-browser-1` as `viewer/active` | POST | 200 | `created: true`, role `viewer` |
| duplicate create same target | POST | 200 | `created: false` (idempotency) |
| patch role → `manager`, empty assignments | PATCH | 200 | `updated: true`, role `manager` |
| disable | POST | 200 | `disabled: true` |
| disable already-disabled | POST | 200 | `disabled: false` (no-op) |

These outcomes match exactly what the page's `createOrgMember`, `updateOrgMember`, and `disableOrgMember` helpers parse and surface via the `created`, `updated`, and `disabled` booleans.

The new smoke membership `s2-17-smoke-user-browser-1` remains in the fixture org after this run, following the same non-destructive convention as S2-16.1 (no safe delete route exists yet; the task forbids destructive cleanup).

## Error Display Result

Backend denial probe used the active manager fixture requester (`s2-15-user-manager`) attempting to create a member:

- HTTP `403`
- response body has `error.code = "organization_role_required"` and `error.message` (compact envelope)

The page's `describeBackendError` helper turns this into `organization_role_required: required organization role is missing`, which is surfaced in the create form's status region (`role="status"`) without clearing app auth or redirecting. No browser-rendered screenshot was captured; the verification is the matching response shape combined with the existing `memberManagement.test.js` unit tests for `describeBackendError`.

## No Token / Secret / Email / Raw-Record Printing

The smoke output contained only:

- HTTP status codes
- HTTP outcome booleans (`created`, `updated`, `disabled`)
- aggregate counts and the `sample-extra-keys=[]` check result
- error code strings from the route's compact JSON envelope

No JWTs, OAuth tokens, refresh tokens, ID tokens, auth codes, authorization headers, encrypted secret payloads, raw provider payloads, raw user records, email addresses, passwords, or full request bodies were printed in terminal output, this proof doc, or any supporting files.

## No Backend / Frontend Code Changes

- `git diff --name-only -- apps/api/src apps/api/package.json package-lock.json`: no output.
- `git diff --name-only -- apps/web/src apps/web/package.json package-lock.json`: no output.
- `git diff --check`: no output.

Pending working-tree changes are docs-only:

```text
?? docs/proof/s2-17-1-workspace-member-ui-browser-smoke.md
modified: docs/codex/sprint-2-phase-1-guardrails.md
modified: docs/backlog/sprint-2-workspace-member-foundation.md
modified: docs/architecture/workspace-members.md
```

## Web Tests And Build

Run from `apps/web`:

- `npm test -- --run`:

```text
Test Files  4 passed (4)
Tests  21 passed (21)
Duration  9.20s
```

- `npm run build`:

```text
286 modules transformed.
✓ built in ~1m33s
```

Build emits the unrelated Browserslist data-age warning from prior tasks.

## Remaining Risks

- No interactive browser session was driven. Visual rendering, button click handlers, `window.confirm()` dialog, and state-transition UX remain manually unverified. A human-driven browser pass is recommended.
- The smoke membership `s2-17-smoke-user-browser-1` remains in the fixture org. The fixture org now contains 9 carried-over memberships plus this one (10 total) after the create+disable round. Future fixture cleanup tooling will need a separate task.
- Live denial-error display was validated via response shape and unit-test coverage of `describeBackendError`; visual rendering of the formatted error string was not browser-verified.
- The page lists every org returned by `GET /api/v1/orgs` and depends on the backend to fail closed for non-owner/admin callers; this still holds based on the S2-12 / S2-16 backend behavior verified by S2-12.1 and S2-16.1.
- Pre-existing Browserslist build warning is unchanged.

## Ready For GPT Verification

Yes.

## GPT Decision

Pass.

The S2-17.1 browser smoke was verified after local API/web smoke, fixture-scoped member API checks, web tests, web build, no-source-diff checks, and diff checks.
