# Workspace Member Model

ParaMetrics remains a Google Business Profile first operations app. S2-07 completed the current org/user/client/location audit and defined the Phase 1 workspace/member foundation before implementation.

No workspace/member APIs, auth changes, RBAC middleware, frontend UI, billing, Phase 2 providers, or multi-channel metrics are implemented by this document.

## Current State

The current ownership model is user-owned first with canonical tenancy fields layered onto location-scoped records.

App authentication creates a JWT with:

- `user_id`
- `role`
- `email`

The auth middleware currently exposes only:

- `req.user.user_id`
- `req.user.role`

That role is app/global-ish user metadata, not a workspace role.

The main current access pattern is:

1. Authenticate the app user.
2. Filter primary records by `user_id`.
3. For location-scoped operations, load the location by `{ user_id, id, provider }`.
4. Require the location to have canonical `organization_id` and `client_id`.
5. Copy or match `organization_id`, `client_id`, and `location_id` on posts, reviews, recurrence rules, review sync state, report runs, and audit logs.

This gives good single-user isolation, but it does not yet allow multiple users to share one organization/workspace safely.

## Target State

Phase 1 should introduce a workspace/member layer while preserving current single-user behavior.

Target ownership chain:

```text
organization/workspace -> organization_members -> clients -> locations/integrations -> GBP operations/reports
```

The existing `orgs` collection can remain the physical collection for organizations/workspaces during Phase 1. Documentation and APIs may use "workspace" as product language, but code should keep a stable canonical field name: `organization_id`.

The target server-side access flow should become:

1. Authenticate the app user.
2. Verify the user has an active `organization_members` record for the requested `organization_id`.
3. Verify the membership role and optional assignment scope allow the requested action.
4. Verify any `client_id` and `location_id` belong to the organization and are in the member's allowed scope.
5. Run the existing GBP/report operation.

Client-sent `organization_id`, `client_id`, and `location_id` must be treated as requested scope only. The server must verify membership and ownership from MongoDB before reading or mutating scoped data.

## Current Collections And Fields

### `users`

Current fields discovered:

- `id`
- `email`
- `normalized_email`
- `password`
- `role`
- `status`
- `oauth_provider`
- `oauth_sub`
- `full_name`
- `created_at`
- `updated_at`

Current indexes:

- unique `email`
- unique `normalized_email`
- unique `oauth_provider + oauth_sub`

Current notes:

- Password login signs `{ user_id, role, email }`.
- Google app auth creates or updates users and signs the same app JWT shape.
- `role` currently describes broad app user role such as `admin`, `user`, or `individual`; it is not scoped to an organization/workspace.

### `orgs`

Current fields discovered:

- `id`
- `user_id`
- `owner_user_id`
- `name`
- `slug`
- `status`
- `website`
- `industry`
- `description`
- `onboarding`
- `brand`
- `created_at`
- `updated_at`

Current indexes:

- unique `user_id + id`
- `user_id + updated_at`
- `owner_user_id + updated_at`
- `id`

Current behavior:

- `GET /api/v1/orgs` lists orgs by `user_id`.
- `POST /api/v1/orgs` upserts by `{ user_id, id }` and writes both `user_id` and `owner_user_id` to the authenticated user.
- Location binding requires the org to match `{ user_id, id }`.

Conflict:

- `orgs.user_id` and `orgs.owner_user_id` currently point to the same user when created by current routes.
- Future workspace ownership should prefer `owner_user_id` for owner identity and `organization_members` for access. `orgs.user_id` should become legacy/single-user compatibility only, not the access control source.

### `clients`

Current fields discovered:

- `id`
- `organization_id`
- `name`
- `display_name`
- `status`
- `is_default`
- `created_at`
- `updated_at`

Current indexes:

- unique `id`
- unique default client per organization: `organization_id + is_default` with partial `is_default: true`
- `organization_id + updated_at`

Current behavior:

- A default client is created or reused when a location is explicitly bound to an org.
- There is no client membership or assignment collection yet.

### `locations`

Current fields discovered:

- `id`
- `user_id`
- `provider`
- `provider_account_name`
- `provider_location_name`
- `integration_id`
- `status`
- `title`
- provider metadata such as address, phone, website, maps URI, place ID, store code
- canonical `organization_id`
- canonical `client_id`
- legacy `org_id`
- `created_at`
- `updated_at`

Current indexes:

- unique `user_id + provider + provider_location_name`
- `user_id + updated_at`
- `organization_id + client_id + updated_at`
- `organization_id + provider + provider_location_name`

Current behavior:

- Google import writes provider metadata and `integration_id` but does not auto-bind `organization_id`, `client_id`, or `org_id`.
- Explicit bind writes `organization_id`, `client_id`, and legacy `org_id`.
- Current read paths generally list by `user_id` first.

### `location_org_map`

Current fields discovered:

- `user_id`
- `location_id`
- `org_id`
- `organization_id`
- `created_at`
- `updated_at`

Current indexes:

- unique `user_id + location_id`
- `org_id + updated_at`

Current behavior:

- This is legacy compatibility only.
- Bind routes still dual-write it.
- Some legacy planning code still reads it as a fallback.

Target direction:

- Keep readable during Phase 1 migrations.
- Do not use it as the canonical access source.
- Do not use it to auto-bind imported Google locations.

### `integrations`

Current fields discovered:

- `id`
- `user_id`
- `provider`
- `provider_subject`
- `provider_email`
- `active`
- `is_active`
- `needs_reauth`
- encrypted `secrets_json`
- provider token metadata
- optional `organization_id`
- optional `client_id`
- `created_at`
- `updated_at`

Current indexes:

- unique `user_id + provider + provider_subject`
- unique active Google integration per user through `user_id + provider + is_active`
- unique `id`
- `organization_id + updated_at`
- `organization_id + client_id + updated_at`

Current behavior:

- Google integrations are still user-owned by `user_id`.
- Locations reference `integration_id`.
- Future workspace support must decide whether integrations remain connected by individual users or become workspace-owned provider connections with member-level visibility.

### `posts`

Current fields discovered:

- `id`
- `user_id`
- `organization_id`
- `client_id`
- `location_id`
- `integration_id`
- provider account/location fields
- content, scheduling, AI, status, provider result/error fields
- recurrence fields when planned
- `created_at`
- `updated_at`

Current indexes:

- `created_at`
- `status + scheduled_at`
- `organization_id + client_id + location_id + created_at`
- `organization_id + status + scheduled_at`

Current behavior:

- List all posts by `user_id` when no location filter is provided.
- Location-scoped post operations require owned location and match canonical org/client/location scope.
- Workers and scheduler still pass user id for job ownership.

### `reviews`

Current fields discovered:

- `id`
- `user_id`
- `organization_id`
- `client_id`
- `location_id`
- `provider`
- `provider_review_name`
- review payload fields
- reply fields
- provider timestamps

Current indexes:

- unique `user_id + location_id + provider_review_name`
- `user_id + location_id + provider + updateTime + createTime`
- `organization_id + client_id + location_id + updateTime + createTime`

Current behavior:

- Review read/sync/reply operations require a user-owned Google location.
- Review documents are matched back to the location's canonical scope before mutation.

### `review_sync_state`

Current fields discovered:

- `id`
- `user_id`
- `organization_id`
- `client_id`
- `location_id`
- status/job cursor fields
- `created_at`
- `updated_at`

Current indexes:

- unique `user_id + location_id`
- `user_id + updated_at`
- unique `id`
- `organization_id + client_id + location_id`

Current behavior:

- Sync state is location-scoped and created through `buildLocationScopeFilter(location)`.

### `recurrence_rules`

Current fields discovered:

- `id`
- `user_id`
- `organization_id`
- `client_id`
- `location_id`
- schedule/template fields
- status/error fields
- `created_at`
- `updated_at`

Current indexes:

- `user_id + updated_at`
- `organization_id + client_id + location_id + updated_at`
- planner-local indexes also create `user_id + location_id` unique and legacy helper indexes.

Current behavior:

- Recurrence routes require a user-owned Google location.
- Rules are upserted with canonical org/client/location scope.
- Planning still has legacy fallback reads through `location_org_map`.

### `reports`

Current fields discovered:

- `id`
- `report_key`
- `name`
- `type`
- `scope`
- `organization_id`
- `client_id`
- `location_id`
- `default_formats`
- `status`
- `created_by_user_id`
- `metadata`
- `created_at`
- `updated_at`

Current indexes:

- unique `id`
- unique report key at organization/client/location scope
- `organization_id + updated_at`
- `client_id + updated_at`
- `location_id + updated_at`
- `status + updated_at`

Current behavior:

- S2 currently focuses on generation. There is no report history UI or report definition API.

### `report_runs`

Current fields discovered:

- `id`
- `report_id`
- `report_key`
- `report_type`
- `report_name`
- `status`
- `requested_formats`
- `outputs`
- `input_snapshot_summary`
- `filters`
- `organization_id`
- `client_id`
- `location_id`
- `requested_by_user_id`
- `created_at`
- `updated_at`
- `started_at`
- `completed_at`
- `error`

Current indexes:

- unique `id`
- `report_id + created_at`
- `report_key + created_at`
- `organization_id + created_at`
- `client_id + created_at`
- `location_id + created_at`
- `status + created_at`

Current behavior:

- Generation requires explicit organization scope.
- If `location_id` is present, the route verifies the request scope matches the authenticated user's owned Google location.
- It does not yet check workspace membership independent of `user_id`.

## Current Problems And Conflicts

### `orgs.user_id` vs `orgs.owner_user_id`

Both fields exist. Current routes create and query orgs by `user_id`, and also write `owner_user_id`. This works for single-user ownership but does not answer who can access the org when multiple users belong to the same workspace.

Phase 1 should:

- Treat `owner_user_id` as the seed for owner membership.
- Treat `user_id` as legacy compatibility for current routes until membership checks replace it.
- Avoid adding new access logic that depends only on `orgs.user_id`.

### One-User Ownership Assumptions

Most route filters begin with `req.user.user_id`. This is safe for current single-user data isolation but blocks collaborative workspaces.

Examples:

- org list and bind routes use `{ user_id, id }`
- locations are listed by `{ user_id, provider }`
- integrations are owned by `user_id`
- posts/reviews/recurrence lookups start from user-owned locations
- workers use `post.user_id` and `rule.user_id`

### Lack Of Membership Collection

There is no canonical way to represent:

- a second user inside an organization/workspace
- role per organization
- invite state
- member activation/deactivation
- client/location assignment scope
- who can manage workspace membership

### Role Scope Ambiguity

`users.role` and JWT `role` are not workspace roles. A user can be an app admin or individual user while also being an owner/admin/manager/viewer in a specific organization.

Workspace roles must be loaded server-side from `organization_members`; they should not be trusted from the current JWT.

### Client And Location Access Implications

Clients and locations are already canonical scope boundaries, but access is still derived from user-owned location rows. A manager assigned to one client should not automatically operate all organization locations.

Phase 1 needs a simple assignment model without overbuilding advanced RBAC.

### Legacy `location_org_map`

`location_org_map` still exists for compatibility. It can help audit legacy bindings, but it must not become the membership or authorization source.

## Proposed Canonical Model

### `organizations` / Workspaces

Use existing `orgs` collection as the current storage. Treat each org as a workspace for Phase 1.

Canonical fields:

- `id`
- `name`
- `slug`
- `status`
- `owner_user_id`
- `created_at`
- `updated_at`

Compatibility fields:

- `user_id` remains during transition for current single-user reads and legacy indexes.

### `organization_members`

New collection.

Proposed fields:

- `id`
- `organization_id`
- `user_id`
- `email`
- `role`: `owner`, `admin`, `manager`, or `viewer`
- `status`: `active`, `invited`, `disabled`
- `invited_by_user_id`
- `assigned_client_ids`
- `assigned_location_ids`
- `created_at`
- `updated_at`

Phase 1 assignment rules:

- `owner` and `admin` usually have all clients/locations in the organization.
- `manager` can operate assigned clients or locations.
- `viewer` can read assigned clients or locations.
- Empty assignment arrays for manager/viewer should mean no assigned scope, not global access.

### `clients`

Keep `clients` as the organization child collection.

Canonical fields:

- `id`
- `organization_id`
- `name`
- `display_name`
- `status`
- `is_default`
- `created_at`
- `updated_at`

### `locations` / Integrations

Keep `locations.organization_id` and `locations.client_id` as canonical location binding.

Google integrations are still user-owned today. Phase 1 should not rewrite provider auth. It should only ensure member access to a location does not bypass provider availability checks.

Possible future direction:

- workspace-owned integrations or shared provider connections
- per-member reconnect workflows

That is outside S2-07.

## Phase 1 Role Model

Keep the model intentionally small:

| Role | Meaning |
| --- | --- |
| `owner` | Created from existing org owner. Full workspace/member/client/location/report access. Can transfer ownership only in a later task if explicitly designed. |
| `admin` | Full workspace operations except irreversible ownership transfer. Can manage members, clients, locations, GBP operations, and reports. |
| `manager` | Operates assigned client/location scope. Can manage posts, reviews, recurrence, and generate reports for assigned scope. Cannot manage workspace membership. |
| `viewer` | Optional read-only role for assigned client/location scope. Can read dashboard/reviews/posts/reports where read endpoints exist, but cannot mutate or generate by default unless explicitly allowed later. |

Do not add HR, agency, billing, entitlement, or Phase 4 roles in Sprint 2.

## Proposed Permissions For Current GBP/Report Operations

| Permission | Owner | Admin | Manager | Viewer |
| --- | --- | --- | --- | --- |
| Read organization/workspace | yes | yes | assigned scope summary only | assigned scope summary only |
| Update organization/workspace | yes | yes | no | no |
| Manage workspace members | yes | yes | no | no |
| Read clients | yes | yes | assigned clients | assigned clients |
| Read locations | yes | yes | assigned clients/locations | assigned clients/locations |
| Bind location to organization/client | yes | yes | no by default | no |
| Import/reconcile Google locations | yes | yes | no by default | no |
| Read GBP dashboard metrics | yes | yes | assigned scope | assigned scope |
| Create/update/delete posts | yes | yes | assigned scope | no |
| Reply to reviews | yes | yes | assigned scope | no |
| Sync reviews | yes | yes | assigned scope | no |
| Read recurrence rules | yes | yes | assigned scope | assigned scope |
| Update/plan recurrence | yes | yes | assigned scope | no |
| Generate dashboard report | yes | yes | assigned scope | no by default |
| Read report metadata/history when added | yes | yes | assigned scope | assigned scope |

## Access Rules

General rules:

- Every organization-scoped route must verify active membership server-side.
- Every client-scoped route must verify the client belongs to the requested organization.
- Every location-scoped route must verify the location belongs to the requested organization and client.
- Client-sent scope is never authoritative.
- Existing `user_id` filters can remain during migration but should not be the final authorization model.

Role rules:

- `owner` and `admin` can manage workspace/member state.
- `owner` and `admin` can bind locations to the workspace and default client.
- `manager` can operate assigned client/location scope for current GBP work.
- `viewer` can read assigned scope only if included in the route design.
- Disabled members have no access.
- Invited members have no access until accepted/activated.

Assignment rules:

- If `assigned_location_ids` contains the location, access is allowed for manager/viewer within role permissions.
- If `assigned_client_ids` contains the location's `client_id`, access is allowed for manager/viewer within role permissions.
- If neither assignment matches, manager/viewer access is denied.
- Owner/admin assignment arrays may be empty because their role grants organization-wide access.

## Migration Strategy

S2-08 should add indexes and a safe migration, but S2-07 does not implement it.

Migration outline:

1. Create `organization_members`.
2. For each org, derive an owner user id from `owner_user_id || user_id`.
3. Create one active owner membership per organization:
   - `organization_id`: org id
   - `user_id`: derived owner
   - `email`: optional from users lookup
   - `role`: `owner`
   - `status`: `active`
4. Preserve current `orgs.user_id` and `orgs.owner_user_id`.
5. Preserve current single-user behavior while membership helpers are introduced.
6. Do not auto-bind imported Google locations.
7. Keep `location_org_map` readable and dual-written until a later cleanup task.
8. Do not backfill membership from locations alone. Locations can confirm scope, but they should not invent workspace membership.

Safety requirements:

- Dry-run by default.
- Apply requires an explicit flag.
- No destructive deletes.
- No token or secret logging.
- Report skipped orgs that lack both `owner_user_id` and `user_id`.

## Index Strategy

### `organization_members`

S2-08 adds the initial conservative index set:

- unique `id`
- unique member per organization/user: `organization_id + user_id`
- `user_id + status + updated_at`
- `organization_id + status + role + updated_at`
- `organization_id + email` partial for invited members with email, using `status: "invited"` and email string presence

S2-08 intentionally defers multikey assignment indexes on `assigned_client_ids` and `assigned_location_ids`. They can be added later only if S2-09/S2-10 helper query shapes prove they are needed.

## S2-08 Implementation

S2-08 creates the `organization_members` index foundation and a dry-run-first owner seed migration.

Migration command:

```bash
npm run -w @parametrics/api migrate:organization-members:s2-08
```

Apply mode requires an explicit flag and must be run only after dry-run proof review:

```bash
npm run -w @parametrics/api migrate:organization-members:s2-08 -- --apply
```

Migration behavior:

- Scans existing `orgs`.
- Derives the owner user id as `owner_user_id || user_id`.
- Skips orgs missing both owner fields.
- Looks up the derived user in `users` for optional email only.
- Creates one active owner membership per organization/user pair.
- Uses `role: "owner"`, `status: "active"`, null `invited_by_user_id`, and empty assignment arrays.
- Is idempotent through the unique `organization_id + user_id` index and apply-mode upsert with `$setOnInsert`.
- Counts existing memberships separately.
- Performs no writes during dry-run.

S2-08 non-goals:

- No auth/JWT changes.
- No route authorization changes.
- No membership API.
- No frontend workspace/member UI.
- No RBAC middleware.
- No billing or entitlements.
- No Phase 2 providers.
- No imported Google location auto-binding.
- No memberships inferred from locations, posts, reviews, reports, or `location_org_map`.
- No org record deletion, rewriting, or ownership field mutation.

### Existing Org/Client/Location Indexes

Useful existing indexes:

- `orgs.id`
- `orgs.owner_user_id + updated_at`
- `clients.organization_id + updated_at`
- `locations.organization_id + client_id + updated_at`
- `locations.organization_id + provider + provider_location_name`

Potential later index:

- unique or partial `orgs.slug` per owner/workspace namespace once slug behavior is intentionally designed.

### Reports

Existing report indexes already support organization/client/location lookup. Future report read/list routes should combine membership checks with these indexes rather than introducing report ownership by user id alone.

## Security Implications

- JWT `role` is insufficient for workspace authorization.
- JWT `user_id` only establishes identity, not organization access.
- Workspace role must be resolved from `organization_members` on the server.
- Client-sent `organization_id`, `client_id`, and `location_id` must be verified against database state.
- The server should not trust frontend-selected active location state.
- `location_org_map` must not grant access.
- Existing app/global admin role should not automatically mean owner of every workspace unless a separate platform-admin policy is explicitly designed.
- Audit logs should include `organization_id`, `client_id`, `location_id`, actor user id, and membership role when available.
- Provider reauth must remain separate from app auth; provider reauth should not logout the app user.

## Incremental Implementation Plan

Suggested sequence:

| Task | Goal |
| --- | --- |
| S2-08 | Create `organization_members` collection indexes and safe migration/dry-run to seed owner memberships from existing orgs. |
| S2-09 | Add membership service/read helpers that can resolve active membership and basic role/scope checks without changing route behavior yet. |
| S2-10 | Protect org/client/report read and generation paths with membership checks while preserving current single-user behavior. |
| S2-11 | Add workspace/member API for listing members, inviting/creating members, updating roles/status, and reading current workspace membership. |
| S2-12 | Add minimal frontend workspace/member UI for owner/admin member management and current workspace visibility. |

Implementation guardrail:

- Do not implement workspace/member runtime changes before this audit/design is verified.

## Non-Goals

S2 workspace/member foundation does not include:

- Billing.
- Entitlements.
- Agencies or multi-channel expansion.
- Advanced RBAC matrix.
- Phase 2 providers.
- Provider connection sharing redesign.
- Workspace switching UX beyond minimal current-workspace/member needs.
- Report queues/workers/storage/history UI.
- Destructive removal of `location_org_map`.
