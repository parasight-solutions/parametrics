# S2-17 Workspace Member Management UI Proof

Date: 2026-05-11

## Scope

S2-17 added a minimal, production-safe frontend UI for direct (user_id-based) organization member management using the verified S2-12 / S2-16 backend APIs. This task is frontend + docs only.

Endpoints wired (existing backend, unchanged):

- `GET /api/v1/orgs`
- `GET /api/v1/orgs/:orgId/members`
- `POST /api/v1/orgs/:orgId/members`
- `PATCH /api/v1/orgs/:orgId/members/:memberId`
- `POST /api/v1/orgs/:orgId/members/:memberId/disable`

This task did not change backend code, add backend routes, add email invitations, add invitation acceptance/token flows, add billing/entitlements, add Phase 2 providers, change auth/JWT/provider behavior, change GBP location binding behavior, change report/location/GBP behavior, or make `location_org_map` canonical. No dependencies were installed.

Claude Code is the execution tool. Claude Code did not commit or push.

## Docs Read

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/README.md`
- `docs/codex/task-template.md`
- `docs/codex/verification-checklist.md`
- `docs/codex/local-proof-pack.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-1-phase-0-proof-pack.md`
- `docs/proof/sprint-2-workspace-member-foundation-proof-pack.md`
- `docs/proof/s2-14-member-management-api-contract.md`
- `docs/proof/s2-15-2-organization-member-fixtures-apply.md`
- `docs/proof/s2-16-member-management-api.md`
- `docs/proof/s2-16-1-member-management-api-smoke.md`
- `docs/runtime/processes.md`
- `docs/architecture/workspace-members.md`
- `docs/architecture/member-management-api-contract.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`

## Files Inspected

- `apps/web/package.json`
- `apps/web/vite.config.js`
- `apps/web/src/App.jsx`
- `apps/web/src/apiClient.js`
- `apps/web/src/apiClient.test.js`
- `apps/web/src/lib/api.js`
- `apps/web/src/session.js`
- `apps/web/src/session.test.js`
- `apps/web/src/reportDownloads.test.js`
- `apps/web/src/components/AppShell.jsx`
- `apps/web/src/components/RecurrenceLab.jsx`
- `apps/web/src/pages/Locations.jsx`
- `apps/web/src/pages/Integrations.jsx`
- `apps/web/src/pages/Dashboard.jsx`
- `apps/web/src/pages/Recurrence.jsx`
- `apps/web/src/pages/Posts.jsx`

## Files Changed

New:

- `apps/web/src/pages/OrganizationMembers.jsx`
- `apps/web/src/lib/memberManagement.js`
- `apps/web/src/lib/memberManagement.test.js`
- `docs/proof/s2-17-workspace-member-ui.md`

Modified:

- `apps/web/src/App.jsx` (added route + import)
- `apps/web/src/components/AppShell.jsx` (added Members nav item)
- `docs/codex/sprint-2-phase-1-guardrails.md` (status updates)
- `docs/backlog/sprint-2-workspace-member-foundation.md` (added S2-17 row)
- `docs/architecture/workspace-members.md` (documented S2-17 frontend status)

No backend files were modified:

- `git diff --name-only -- apps/api/src apps/api/package.json package-lock.json`: no output.

## Route And Page Added

- Route: `/organization-members` (authenticated; redirects to `/login` when not authed; existing `App.jsx` auth gating reused).
- Page component: `apps/web/src/pages/OrganizationMembers.jsx` rendered inside the existing `AppShell` layout.
- Navigation: added `Members` item to the existing `AppShell` top nav.

## API Methods Added

Added in `apps/web/src/lib/memberManagement.js`, each calling the existing authenticated `api(...)` client:

- `listOrganizations()` → `GET /api/v1/orgs` (reuses the existing org list endpoint to source the org selector).
- `listOrgMembers(orgId)` → `GET /api/v1/orgs/:orgId/members`.
- `createOrgMember(orgId, body)` → `POST /api/v1/orgs/:orgId/members`.
- `updateOrgMember(orgId, memberId, patch)` → `PATCH /api/v1/orgs/:orgId/members/:memberId`.
- `disableOrgMember(orgId, memberId, reason?)` → `POST /api/v1/orgs/:orgId/members/:memberId/disable`.

The module also exports pure helpers: `parseAssignmentIdsInput`, `formatAssignmentIds`, `roleSupportsAssignments`, `describeBackendError`, `formatDate`, plus the `MEMBER_ROLES`, `MEMBER_STATUSES_ALL`, `MEMBER_CREATE_STATUSES`, and `ROLES_WITH_ASSIGNMENTS` constants.

## UI Behavior

Organization selector:

- Calls `listOrganizations()` on mount.
- Shows a `<select>` of `id`/`name` pairs.
- Shows a `Refresh orgs` button and a `Refresh members` button.
- Auto-selects the first organization in the list when no selection exists.
- Surfaces a sanitized backend error if the orgs request fails.

Members list:

- Calls `GET /api/v1/orgs/:orgId/members` when the org changes.
- Shows loading, empty, and error states.
- Renders `user_id`, role badge (owner/admin/manager/member/viewer), status badge (active/invited/disabled), membership `id`, `created_at`/`updated_at` formatted via `toLocaleString`, and assigned client/location counts.
- Never renders emails or raw user records. The page consumes only the documented sanitized backend response shape.

Add direct member form:

- Inputs: `user_id` (text), `role` (`owner`/`admin`/`manager`/`member`/`viewer`), `status` (`active`/`disabled` only — invited is explicitly described as not available because no invitation flow exists yet).
- For `manager`/`viewer` roles, two extra comma-separated assignment inputs appear (`assigned_client_ids`, `assigned_location_ids`). The CSV is parsed via `parseAssignmentIdsInput` (trim, dedupe, drop empties).
- Submit calls `createOrgMember(orgId, body)`. Surfaces the backend's `created` boolean: when `created === false`, the UI states the membership already existed and was returned unchanged.

Edit member panel:

- Inline panel (no modal) toggled by the `Edit` button on each row.
- Lets the operator change `role`, `status`, and assignment CSVs.
- When the new role does not support assignments, the assignment inputs are hidden and the existing assignments are cleared on save (matches backend rules).
- Submit calls `updateOrgMember(orgId, memberId, patch)` and surfaces the backend's `updated` boolean.

Disable action:

- A `Disable` button on each row.
- Uses `window.confirm()` for a simple confirmation before calling `disableOrgMember`.
- Disabled when the row is already disabled.
- Surfaces the backend's `disabled` boolean to distinguish no-op from real disable.

UX copy:

- Page subtitle states this is direct user_id membership management and that email invitations are not available yet.
- Members section subtitle states that sanitized rows only are shown.

Role constraints:

- The UI does not pretend to enforce all server-side rules. It surfaces the backend's compact JSON error envelope (`error.code` + `error.message`) verbatim so the operator sees the canonical reason for a denial (for example `member_role_not_allowed`, `organization_role_required`, `last_owner_required`).

Accessibility:

- Every input has an associated `<label htmlFor>`.
- Buttons have clear text labels (`Add member`, `Edit`, `Cancel`, `Disable`, `Refresh members`, `Refresh orgs`).
- Status/error regions use `role="status"` and `role="alert"` respectively for assistive technology.

Styling stays consistent with the existing Tailwind-based shell (white cards, rounded-xl borders, gray-50 background, gray-900 primary buttons).

## Error / Auth Handling

- The page uses the existing `api()` client. App-auth 401s remain handled by `apiClient.js` (clear session + redirect to login). Member-management 403 and 404 do not clear app auth.
- A location-bound 404 path is not hit here because the route is org-scoped, not location-scoped.
- The page does not modify `sessionStorage` reauth state. The existing Google reauth banner behavior is preserved.
- The page never prints tokens. The `api()` client attaches the Authorization header internally.

## Tests / Build

Run from `apps/web`:

```bash
npm test -- --run
npm run build
```

`npm test -- --run`:

```text
Test Files  4 passed (4)
Tests  21 passed (21)
Duration  4.49s
```

The 21 tests include eight new pure-helper tests for `memberManagement` and the previously passing `apiClient`, `reportDownloads`, and `session` test files.

`npm run build`:

```text
286 modules transformed.
✓ built in 31.02s
```

Build emits an unrelated Browserslist age warning that pre-exists from prior tasks; no dependency update was performed.

No React testing-library is installed in the project, so component-render tests were not added. Per the task contract, no dependencies were installed; pure helper coverage was used instead.

## Scope / Diff Checks

- `git status --short`:

```text
 M apps/web/src/App.jsx
 M apps/web/src/components/AppShell.jsx
?? apps/web/src/lib/memberManagement.js
?? apps/web/src/lib/memberManagement.test.js
?? apps/web/src/pages/OrganizationMembers.jsx
```

(Doc-only updates under `docs/` are added separately by S2-17 to guardrails, backlog, architecture, and proof.)

- `git diff --check`: no output.
- `git diff --name-only -- apps/api/src apps/api/package.json package-lock.json`: no output (no backend diff, no dependency lockfile changes).

## Explicit Non-Goals

S2-17 did not:

- change backend API code or add backend routes
- add email invitations or invitation acceptance/token routes
- add billing/entitlements
- add Phase 2 providers or multi-channel metrics
- change auth/JWT/provider behavior
- change GBP location binding behavior
- change report/location/GBP backend or frontend behavior
- make `location_org_map` canonical
- install dependencies
- add React component-render tests (no testing-library is set up)
- run live API smoke (covered by S2-16.1 already)

## Backend Changes

No. The S2-16 backend behaves as documented and was not modified.

## Remaining Risks

- No browser smoke was run against a live API in this task. UI behavior was verified through pure-helper tests, the production build, and the existing API contract from S2-16 / S2-16.1. A later live browser smoke task can confirm end-to-end UX.
- The frontend currently lists all orgs from `GET /api/v1/orgs`, which already includes legacy-owned and membership-visible orgs. Member-management actions still fail closed server-side for orgs where the requester lacks an owner/admin role.
- Assignment IDs are entered as free-text CSV. Validation of canonical client/location IDs is done server-side; the UI does not pre-validate.
- The UI uses `window.confirm()` for the disable confirmation step rather than a custom modal. This is intentional to stay restrained; a future task can replace it if richer UX is required.
- Email invitation flow is intentionally not present; the UI explicitly says so.
- The Browserslist data warning during build is unrelated and pre-existing.

## Ready For GPT Verification

Yes.

## GPT Decision

Pass

The S2-17 frontend workspace member UI was verified after helper tests, web build, no-backend-diff review, and diff checks.
