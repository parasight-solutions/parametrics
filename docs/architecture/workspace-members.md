# Workspace Members

ParaMetrics remains a Google Business Profile first operations app. Workspace/member work in Phase 1 must preserve current GBP behavior while adding a safe foundation for future shared organization access.

## Current Vocabulary

`organization_members` is the canonical membership collection for workspace access work.

Supported membership statuses:

- `active`
- `invited`
- `disabled`

Supported membership roles:

- `owner`
- `admin`
- `manager`
- `member`
- `viewer`

The S2-08 owner seed migration remains compatible with this vocabulary because it creates `role: "owner"` and `status: "active"` memberships.

## S2-09 Helper Scope

S2-09 is complete. It added backend organization access helpers only.

The helper service can:

- normalize membership roles and statuses
- load an active membership for an explicit `{ organizationId, userId }`
- check whether a user has any active membership in an organization
- check whether a membership role is in an allowed role set
- throw compact access errors with `status`, `statusCode`, `code`, and safe messages

The helpers require explicit `organizationId` and `userId`. They do not infer organization scope from session state, active frontend location state, `locations`, or legacy `location_org_map`.

## Non-Goals

S2-09 does not:

- change existing route authorization behavior
- replace current user-owned guards
- wire membership checks into org, location, posts, reviews, recurrence, reports, or dashboard routes
- add RBAC middleware
- change JWT/auth behavior
- add workspace/member APIs
- add invite flows
- add frontend workspace/member UI
- add billing or entitlements
- add Phase 2 providers or multi-channel metrics
- change Google location binding behavior
- make `location_org_map` canonical
- auto-create memberships

## Future Handoff

S2-10 can begin route-level membership authorization gradually. Future route tasks should treat client-sent `organization_id`, `client_id`, and `location_id` as requested scope only, load the active organization membership server-side, and then verify role plus client/location scope before changing existing GBP or report behavior.

Membership helpers should remain adapter-friendly for tests: callers can use the default MongoDB collection at runtime, while tests should inject fake collections or database adapters.

## S2-10 Route Authorization Scope

S2-10 is complete. It started route-level membership authorization only for low-blast-radius organization and report paths.

Dashboard snapshot report generation now requires:

- explicit `organization_id`
- active `organization_members` membership for the authenticated `req.user.user_id`
- one of these organization roles for location-scoped reports: `owner`, `admin`, or assigned `manager`
- `owner` or `admin` for non-location organization-level report requests

Report generation continues to enforce the existing owned-location and canonical `organization_id` / `client_id` / `location_id` scope checks when `location_id` is provided. Location-scoped reports now authorize against the loaded location's canonical organization/client/location scope, not only the client-sent organization id. Generated PDF/XLSX files remain response-only base64 for the MVP route, and `report_runs` continues to persist metadata only.

Organization routes now start using membership-aware checks where the blast radius is low:

- org listing can include organizations where the user has active membership
- legacy owner-created org visibility remains available during the transition
- existing org mutation and location bind paths fail closed unless the user has active `owner` or `admin` membership
- new org creation still does not require pre-existing membership

New org creation still writes the current `user_id` and `owner_user_id` fields. Creating owner memberships for newly created orgs remains a follow-up unless handled by a later dedicated task.

S2-10 does not change GBP posts, reviews, locations, recurrence, dashboard metrics, Google integration routes, provider auth, JWT/auth middleware, frontend UI, invite/member-management APIs, billing, entitlements, Phase 2 providers, or `location_org_map` canonicality.

## S2-10.1 Location-Bound GBP Authorization Scope

S2-10.1 is complete. It extends membership-aware checks to current GBP location-bound operations after the existing owned-location and canonical scope checks.

The protected runtime pattern is:

1. Authenticate the app user through the existing JWT middleware.
2. Load the Google location through the existing user-owned location guard.
3. Require canonical `locations.organization_id`, `locations.client_id`, and `locations.id`.
4. Require active `organization_members` access for the canonical organization and the canonical client/location assignment.
5. Continue the existing GBP operation.

S2-10.1 does not trust client-sent organization/client/location scope. Client-sent IDs are request hints only; authorization uses the loaded location document's canonical `organization_id`, `client_id`, and `id`. Legacy `location_org_map` and `locations.org_id` are not authorization sources.

Role behavior for protected location-bound routes:

- `owner` and `admin`: full current access for bound locations; assignment arrays are ignored.
- `manager`: allowed for operational location-bound actions only when `assigned_location_ids` contains the location id or `assigned_client_ids` contains the client id.
- `viewer`: allowed for read-only location-scoped reads that now use the helper path, including dashboard performance metrics, review reads, post list reads when a location is specified, recurrence rule/post reads, and media reads that resolve through a canonical local location id. Viewer is denied for mutations.
- `member`: denied for protected location-bound operations.
- `invited`, `disabled`, and missing membership: denied because only active memberships are accepted.

Assignment arrays:

- `assigned_location_ids`: explicit local `locations.id` assignments.
- `assigned_client_ids`: explicit canonical client assignments.
- Empty or missing assignment arrays deny `manager` and `viewer` scoped location access.
- Owner/admin memberships do not need assignment arrays.

Current limitations:

- Existing user-owned location checks still run first, so S2-10.1 preserves current single-user owner success behavior but does not yet enable shared cross-user access to another user's imported locations.
- Unbound imported Google locations are not auto-bound and fail closed for scoped operations.
- `GET /api/v1/locations` still lists the authenticated user's imported Google locations for current binding/selection flows; the destructive location delete path requires owner/admin membership after canonical scope resolution.
- `GET /api/v1/posts` without a `locationId` remains the existing user-owned aggregate view. The location-scoped list path is membership-aware.
- Google OAuth, provider connection, account listing, location import, and reconcile behavior are unchanged.
- Workspace/member management APIs, invite flows, billing/entitlements, frontend workspace/member UI, and Phase 2 providers remain follow-ups.

## S2-10.2 GBP Membership Smoke

S2-10.2 is complete. It verified S2-10.1 against the live local API/Mongo environment and recorded proof in `docs/proof/s2-10-2-gbp-membership-smoke.md`.

The smoke confirmed:

- existing owner/member GBP location-bound reads and mutations still work
- stale or mismatched location scope fails closed
- app auth remains preserved after stale-location denial and provider status checks
- report snapshot generation remains metadata-only in persistence
- no frontend workspace/member UI, invite APIs, member-management APIs, billing, entitlements, Phase 2 providers, or destructive scripts were added

## S2-11 New Organization Owner Membership

S2-11 is complete. New organization creation now creates or preserves an `organization_members` record for the authenticated creator after the brand-new org is written and before the route returns success.

New owner membership documents use:

- `organization_id`: the newly created organization id
- `user_id`: the authenticated `req.user.user_id`
- `role`: `owner`
- `status`: `active`
- stable generated `id`
- `created_at` and `updated_at`

The helper is idempotent by `{ organization_id, user_id }`. If a membership already exists, it does not duplicate the record and does not downgrade or overwrite the existing role/status. Existing organization update paths still require active `owner` or `admin` membership from S2-10 before mutation.

If membership creation fails and no membership exists, org creation returns an error instead of silently returning success. This avoids presenting a newly created org as successful while membership-aware routes would make it inaccessible.

S2-11 does not add member-management APIs, invite APIs, frontend workspace/member UI, RBAC middleware, billing/entitlements, auth/JWT changes, provider auth changes, Phase 2 providers, Google location binding changes, or any behavior that makes `location_org_map` canonical.

## S2-11.1 New Organization Owner Membership Smoke

S2-11.1 is complete. It verified S2-11 against the live local API/Mongo environment and recorded proof in `docs/proof/s2-11-1-new-org-owner-membership-smoke.md`.

The smoke confirmed:

- authenticated org creation returns success
- created orgs keep `user_id` and `owner_user_id` on the authenticated creator
- exactly one owner membership is created for `{ organization_id, user_id }`
- repeat org upsert does not duplicate or downgrade the membership
- the created org appears in org listing
- the existing org update path accepts the creator because owner membership exists

## S2-12 Read-Only Member Listing

S2-12 is complete. It added a read-only authenticated endpoint under the existing organization route:

```text
GET /api/v1/orgs/:orgId/members
```

Access behavior:

- requires app authentication
- requires explicit `orgId` from the URL
- requires an active `organization_members` record for the requested organization and authenticated `req.user.user_id`
- allows active `owner`, `admin`, and `manager` memberships
- denies `viewer`, `member`, `invited`, `disabled`, and missing memberships
- does not rely on JWT role, active frontend state, `location_org_map`, or inferred organization scope

The route checks active membership and role before confirming organization existence. This keeps missing/non-member requests fail-closed with `403`; if an allowed membership exists for a missing organization, the route returns `404`.

Response rows are sanitized and limited to:

- `id`
- `organization_id`
- `user_id`
- `role`
- `status`
- `assigned_client_ids`
- `assigned_location_ids`
- `invited_by_user_id` when present
- `created_at`
- `updated_at`

The response intentionally omits Mongo `_id`, email, password fields, tokens, secrets, OAuth/provider payloads, and raw user records.

Pagination and sort behavior:

- default limit: `50`
- max limit: `100`
- no cursor/skip yet
- deterministic sort: role priority `owner`, `admin`, `manager`, `member`, `viewer`; then status priority `active`, `invited`, `disabled`; then `created_at` ascending; then `id`

S2-12 does not add member creation APIs, invite APIs, role update APIs, remove/disable APIs, frontend workspace/member UI, RBAC middleware, billing/entitlements, auth/JWT changes, provider auth changes, Phase 2 providers, Google location binding changes, report/location behavior changes, or any behavior that makes `location_org_map` canonical.

## S2-12.1 Read-Only Member Listing Smoke

S2-12.1 is complete. It verified S2-12 against the live local API/Mongo environment and recorded proof in `docs/proof/s2-12-1-read-only-member-listing-smoke.md`.

The smoke confirmed:

- active owner membership can call `GET /api/v1/orgs/:orgId/members`
- the response includes the expected membership rows
- the response is bounded and sorted by the documented contract
- rows omit Mongo `_id`, email, password fields, tokens, secrets, OAuth/provider payloads, and raw user records
- a harmless non-existent org request fails closed with `403`

Live role-denial fixture coverage was skipped because no safe existing viewer/member/invited/disabled fixture was available; unit tests cover those denial cases.

## S2-13 Foundation Proof Pack

S2-13 is complete. It produced a docs-only proof pack and hardening audit for the Sprint 2 workspace/member foundation in `docs/proof/sprint-2-workspace-member-foundation-proof-pack.md`.

The proof pack summarizes completed tasks, current implementation facts, route/access behavior, security verification, test results, explicit non-goals, remaining risks, and the next recommended task. It did not add member-management APIs, invite APIs, frontend workspace/member UI, RBAC middleware, auth/JWT changes, provider auth changes, billing/entitlements, Phase 2 providers, report/location behavior changes, Google location binding changes, or make `location_org_map` canonical.

## S2-14 Member-Management Design Handoff

S2-14 is complete. It produced a docs-only member-management API contract and fixture strategy in `docs/architecture/member-management-api-contract.md`.

Current state remains unchanged:

- `organization_members` is canonical for workspace membership.
- `GET /api/v1/orgs/:orgId/members` is still read-only.
- No member creation APIs, invite APIs, role update APIs, remove/disable APIs, frontend workspace/member UI, auth/JWT changes, provider auth changes, billing/entitlements, Phase 2 providers, report/location behavior changes, Google location binding changes, or `location_org_map` canonical behavior have been implemented.

Planned, not implemented, future endpoints:

- `POST /api/v1/orgs/:orgId/members`
- `PATCH /api/v1/orgs/:orgId/members/:memberId`
- `POST /api/v1/orgs/:orgId/members/:memberId/disable`
- future/not Sprint 2: `POST /api/v1/orgs/:orgId/invitations`

The S2-14 contract chooses direct member management by existing `user_id` as the next implementable path. Email invitation delivery is documented as future/not implemented until invite tokens, expiry, acceptance, resend, cancellation, delivery, and safe email display rules are designed.

The handoff requires future implementation to preserve last active owner protection, validate manager/viewer assignment ids against canonical clients and locations in the requested organization, never trust JWT role for workspace authorization, never expose secrets or raw user records, and never use `location_org_map` for membership authorization.

## S2-15 Controlled Membership Fixtures

S2-15 is complete. It adds a local fixture seed/audit workflow for repeatable owner/admin/manager/viewer/member/invited/disabled membership verification without changing runtime routes.

The fixture workflow uses:

- script: `npm run -w @parametrics/api seed:organization-members:s2-15`
- default mode: dry-run
- apply mode: explicit `-- --apply` only
- organization id/name/slug prefix: `s2-15-fixture-`
- membership id prefix: `s2-15-member-`
- user id prefix: `s2-15-user-`

The dataset plans one fixture organization and seven memberships:

- active owner
- active admin
- active manager with fixture client/location assignments
- active viewer with fixture client/location assignments
- active member
- invited member
- disabled viewer

The workflow is non-destructive by contract. It performs no deletes, creates no user records, does not touch Beetle/current working organizations, does not use or modify `location_org_map`, and only mutates records with the exact fixture prefixes when apply mode is explicitly requested.

Dry-run reports existing fixture state, planned insert/update counts, role/status counts, planned ids, and conflict counts. If a non-fixture record already exists for a planned `{ organization_id, user_id }`, the workflow fails safely and performs no writes. Post-apply dry-run should report zero remaining backfillable fixture memberships.

S2-15.2 applied the controlled fixture set. The post-apply dry-run reports one existing fixture organization, seven existing fixture memberships, zero backfillable memberships, and zero conflicts. Live aggregate verification found zero fixture references in `location_org_map`.

S2-15 does not add member-management APIs, invite APIs, role update APIs, remove/disable APIs, frontend workspace/member UI, auth/JWT changes, provider auth changes, report/location behavior changes, billing/entitlements, Phase 2 providers, Google location binding changes, or make `location_org_map` canonical.

## S2-16 Direct Member-Management API

S2-16 is complete. It implements direct member-management APIs for existing `user_id` based memberships under the authenticated organization router:

```text
POST /api/v1/orgs/:orgId/members
PATCH /api/v1/orgs/:orgId/members/:memberId
POST /api/v1/orgs/:orgId/members/:memberId/disable
```

This implementation is direct membership management only. It does not add email invitation delivery, invitation acceptance tokens, invite resend/cancel behavior, frontend workspace/member UI, provider auth changes, or auth/JWT middleware changes.

Access behavior:

- all routes require app authentication
- all workspace authorization loads active `organization_members` membership for the requested `orgId` and authenticated `req.user.user_id`
- JWT role is not trusted for workspace authorization
- `location_org_map` is not used for membership authorization
- `owner` can create/update/disable all supported roles subject to last-owner protection
- `admin` can create/update/disable `manager`, `member`, and `viewer` only
- `manager`, `viewer`, `member`, `invited`, `disabled`, and missing memberships cannot manage members

Create behavior:

- direct create accepts `user_id`, optional `role`, optional `status`, and assignment arrays
- `role` defaults to `viewer`
- `status` defaults to `active`
- direct create allows `active` and `disabled`; `invited` remains reserved for future invitation flow design
- create is idempotent by `{ organization_id, user_id }`; if a membership exists, it returns the existing sanitized member with `created: false` and does not downgrade or overwrite it

Patch/disable behavior:

- patch only accepts `role`, `status`, `assigned_client_ids`, and `assigned_location_ids`
- identical patch returns the sanitized member with `updated: false`
- disable never deletes membership documents
- disabling an already disabled member returns the sanitized member with `disabled: false`

Last-owner protection:

- active owner count is checked before any patch or disable that would make an active owner no longer an active owner
- if the target is the final active owner, the operation fails with `last_owner_required`

Assignment validation:

- `manager` and `viewer` may have `assigned_client_ids`, `assigned_location_ids`, or both
- empty assignment arrays are allowed and mean no scoped GBP access
- non-empty `assigned_client_ids` must match canonical `clients.id` rows with `clients.organization_id === orgId`
- non-empty `assigned_location_ids` must match canonical `locations.id` rows with `locations.organization_id === orgId`
- `owner`, `admin`, and `member` persist empty assignment arrays; non-empty assignments for those roles are rejected
- no assignment validation uses `location_org_map`, and no imported Google locations are auto-bound

Responses return sanitized membership rows only. They omit Mongo `_id`, email, password fields, tokens, secrets, OAuth/provider payloads, and raw user records.

Audit events are written best-effort through the existing audit service:

- `organization.member.create`
- `organization.member.update`
- `organization.member.disable`

Audit metadata is compact and contains ids, roles/statuses, assignment counts, operation outcome flags, and optional short disable reason only.

## S2-16.1 Direct Member-Management API Smoke

S2-16.1 is complete. It verified S2-16 against the live local API and live MongoDB using only the controlled S2-15 fixture organization (`s2-15-fixture-org`) and the `s2-15-user-*` requester / `s2-16-smoke-user-*` target prefix scope, and recorded proof in `docs/proof/s2-16-1-member-management-api-smoke.md`.

The smoke confirmed:

- `GET /api/v1/health` returns 200 with the API running as a single-process API only.
- owner positive flow (create viewer, patch to manager with empty assignments, repeat patch no-op, disable) returns 200 with sanitized membership rows.
- duplicate owner create returns `created: false`; disabling an already-disabled member returns `disabled: false`; identical patch returns `updated: false`.
- admin can create `manager`/`member`/`viewer` targets and is denied (403) when creating `owner`/`admin` and when attempting to patch or disable fixture owner/admin memberships.
- manager, viewer, and member fixture requesters are denied (403, `organization_role_required`) for create, patch, and disable; invited and disabled fixture requesters are denied (403, `organization_membership_required`).
- response membership rows omit Mongo `_id`, email, password, token, secret, OAuth, and provider keys; no JWTs/tokens/secrets/emails/raw user records were printed in proof output.
- no Beetle/current working organization was touched; zero `location_org_map` references existed for fixture or smoke prefixes after the run.

Skipped live cases (documented in the proof): live last-owner mutation against the fixture owner was avoided to preserve canonical fixture state; non-empty assignment id validation was not exercised live because the fixture organization has no client/location records. Both are covered by the existing unit tests in `apps/api/src/services/organizationMembers.test.js`.

A thin Claude Code governance adapter was also added during S2-16.1 (`CLAUDE.md` and `docs/claude-code/README.md`). The existing `docs/codex/*` workflow remains the source of truth.

## S2-17 Frontend Member Management UI

S2-17 is complete. It added a minimal authenticated frontend page at `/organization-members` that wires the verified member-management APIs through the existing `apiClient.api()` wrapper:

- `GET /api/v1/orgs` — sources the organization selector.
- `GET /api/v1/orgs/:orgId/members` — list sanitized member rows.
- `POST /api/v1/orgs/:orgId/members` — direct create by `user_id`.
- `PATCH /api/v1/orgs/:orgId/members/:memberId` — inline edit panel for role/status/assignments.
- `POST /api/v1/orgs/:orgId/members/:memberId/disable` — disable action with a `window.confirm()` step.

Direct-only limitation: the UI explicitly states that membership is created by existing app `user_id` only, and that email invitations are not available yet. Direct create supports `active` and `disabled` statuses only, matching the backend contract.

Sanitization preserved: the UI consumes only the documented sanitized backend response shape and never renders emails or raw user records. Backend `error.code` and `error.message` values are surfaced verbatim in non-destructive alert/status regions when a denial occurs, so operators see the canonical reason (for example `member_role_not_allowed`, `organization_role_required`, `last_owner_required`).

Auth preservation: the page reuses the existing `api()` client; app-auth 401 handling, Google reauth banner handling, and `active_location_id` clearing on location-bound 404s are unchanged. Member-management 403 and 404 responses do not clear app auth.

Out of scope for S2-17:

- backend code changes
- backend routes
- email invitations or invitation acceptance/token flows
- billing/entitlements
- Phase 2 providers
- GBP location binding behavior
- report/location/GBP frontend or backend behavior changes
- `location_org_map` canonicality
- dependency installs
- React component-render tests (no testing-library is installed); pure-helper tests cover CSV parsing, role-assignment gating, error formatting, and date formatting

Live browser smoke remains a future follow-up. Sprint 2 API behavior coverage is already provided by S2-16.1.

## S2-17.1 Frontend Member UI Browser Smoke

S2-17.1 is complete. It smoke-tested S2-17 against a local API + web dev-server pair from the headless Claude Code shell and recorded proof in `docs/proof/s2-17-1-workspace-member-ui-browser-smoke.md`.

The smoke confirmed:

- `GET /api/v1/health` returns 200; web dev server returns 200 at `/`; `GET /organization-members` returns 200 and serves the SPA shell.
- The dev-served `OrganizationMembers.jsx` module contains the documented UX copy strings: direct user_id-based membership, email invitations are not available yet, invited status requires an invitation flow that is not implemented yet, and sanitized rows only.
- The dev-served `AppShell.jsx` module contains the `Members` nav item targeting `/organization-members`.
- The exact API endpoints the page calls behave correctly against the S2-15 fixture organization (`s2-15-fixture-org`): list 200 with sanitized rows (no unexpected keys); create 200 with `created: true` for a new `s2-17-smoke-user-browser-1` target; duplicate create 200 with `created: false`; patch role to manager 200 with `updated: true`; disable 200 with `disabled: true`; repeat disable 200 with `disabled: false`; manager-requester denial returns 403 with the compact `error.code = organization_role_required` envelope that the page's `describeBackendError` helper renders.
- No backend or frontend source files were modified; only docs/proof updates were added.
- No JWTs, OAuth tokens, secrets, emails, passwords, or raw user records were printed in the smoke output or this proof.

Skipped live cases (documented in the proof):

- Interactive button clicks, on-screen text rendering, and the disable `window.confirm()` modal were not exercised because no interactive browser session was available in the execution environment. A human-driven browser pass remains a recommended follow-up.

Smoke membership: `s2-17-smoke-user-browser-1` remains in the fixture organization with `role: manager` and `status: disabled` after the run, consistent with the S2-15/S2-16.1 non-destructive convention.

## Sprint 2 / Phase 1 Closeout (S2-18)

S2-18 produced a Sprint 2 / Phase 1 closeout proof pack (`docs/proof/sprint-2-closeout-proof-pack.md`). It is documentation/audit only and does not change runtime behavior.

The closeout records Sprint 2 as Pass (pending GPT verification) on the basis that the report foundation (S2-01..S2-06.1) and the workspace/member foundation (S2-07..S2-17.1) are implemented within scope, with live smoke proofs and sanitized, member-aware authorization across the org/report/GBP location-bound surfaces. Limitations explicitly carried forward include direct-`user_id`-only membership (no email invitations), synchronous base64-only report generation (no queue/storage/history UI/email scheduling), no visual click-driven UI smoke, no safe delete route for fixture or smoke memberships, and the existing owned-location guard still gating cross-user shared Google location access.

Phase 2 integrations remain blocked until the closeout is explicitly accepted. Recommended next tasks are conservative and phase-aware: S2-18.1 optional manual browser smoke for `/organization-members`, S2-19 API `npm test` script consolidation, S2-20 report history/listing UI or report storage design, and S2-21 member invite contract/design.
