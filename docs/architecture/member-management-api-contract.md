# Member Management API Contract

ParaMetrics remains a Google Business Profile first operations app. This document is the S2-14 design contract for future member-management API work. It does not implement runtime behavior.

## Current Facts

`organization_members` is the canonical membership collection for workspace access.

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

Assignment fields already exist on membership documents:

- `assigned_client_ids`
- `assigned_location_ids`

Current implemented member API behavior:

- `GET /api/v1/orgs/:orgId/members` lists sanitized members for active `owner`, `admin`, and `manager` requesters.
- The read-only listing omits Mongo `_id`, email, password fields, tokens, secrets, OAuth/provider payloads, and raw user records.
- There are no member creation APIs, invite APIs, role update APIs, remove APIs, disable APIs, or frontend workspace/member UI yet.

## Design Position

Sprint 2 should implement direct member management by existing `user_id` only before email invitation delivery exists. Email invitations require separate product, security, delivery, and acceptance design, so the invitation endpoint below is documented as future/not implemented.

This contract intentionally keeps runtime behavior conservative:

- no JWT role trust for workspace authorization
- no `location_org_map` membership authorization
- no Google location auto-binding
- no raw user record exposure
- no broad RBAC middleware
- no frontend UI in this task

## Shared Response Shape

Future member mutation routes should return sanitized membership rows in the same shape as the read-only list:

```json
{
  "member": {
    "id": "membership_id",
    "organization_id": "org_id",
    "user_id": "user_id",
    "role": "manager",
    "status": "active",
    "assigned_client_ids": ["client_id"],
    "assigned_location_ids": ["location_id"],
    "invited_by_user_id": "user_id",
    "created_at": "2026-05-03T00:00:00.000Z",
    "updated_at": "2026-05-03T00:00:00.000Z"
  },
  "created": true
}
```

Rows must never include:

- Mongo `_id`
- password fields
- JWTs
- OAuth access tokens, refresh tokens, ID tokens, auth codes, or provider payloads
- encrypted secret payloads
- raw user records
- raw email fields unless a later verified invite contract explicitly allows sanitized invite email display

## Shared Error Codes

Use compact JSON errors consistent with existing routes:

```json
{
  "error": {
    "code": "organization_role_required",
    "message": "required organization role is missing"
  }
}
```

Safe codes for future implementation:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Missing/invalid `orgId`, `memberId`, `user_id`, role, status, or assignment fields. |
| 401 | `unauthorized` | Existing app authentication failed. |
| 403 | `organization_membership_required` | Requester has no active membership in the organization. |
| 403 | `organization_role_required` | Requester has active membership but not a management role. |
| 403 | `last_owner_required` | Operation would remove, disable, or downgrade the final active owner. |
| 404 | `not_found` | Target member or explicitly checked organization was not found after requester authorization passes. |
| 409 | `member_exists` | Direct create found an existing membership that should be managed with PATCH. |
| 409 | `assignment_scope_invalid` | Assignment ids do not belong to the requested organization. |
| 429 | `rate_limited` | Existing mutation rate limiting rejects the request. |
| 500 | `server_error` | Unexpected server failure. |

Missing/non-member callers should fail closed before organization existence is disclosed where practical.

## Role Rules

Requester role behavior:

- `owner`: can manage all member roles, except no operation may remove, disable, or downgrade the final active owner.
- `admin`: can create/update/disable `manager`, `member`, and `viewer` memberships. Admin cannot create, update, disable, or downgrade `owner` or `admin` memberships unless a later contract explicitly approves it.
- `manager`: cannot manage organization members in this first contract.
- `viewer`: cannot manage organization members.
- `member`: cannot manage organization members.
- `invited`, `disabled`, and missing memberships: cannot manage organization members.

Target role behavior:

- `owner` and `admin` ignore assignment arrays for access.
- `manager` and `viewer` require assignment arrays for scoped location/client behavior where route policy allows them.
- `member` is intentionally supported in vocabulary but has no current GBP/report access privileges beyond being listed as a membership role.

## Assignment Behavior

Assignments use canonical identifiers only:

- `assigned_client_ids`: `clients.id` values where `clients.organization_id === orgId`
- `assigned_location_ids`: local `locations.id` values where `locations.organization_id === orgId`

Future implementation must validate every assignment id before writing:

- reject client ids that do not exist in the requested organization
- reject location ids that do not exist in the requested organization
- reject location ids whose `client_id` does not belong to the requested organization
- do not resolve assignment scope through `location_org_map`
- do not auto-bind imported Google locations to make an assignment valid

Recommended assignment rules by target role:

- `owner`: ignore request assignment arrays and persist empty arrays, unless a later display-only convention is approved.
- `admin`: ignore request assignment arrays and persist empty arrays.
- `manager`: allow non-empty `assigned_client_ids`, non-empty `assigned_location_ids`, or both.
- `viewer`: allow non-empty `assigned_client_ids`, non-empty `assigned_location_ids`, or both.
- `member`: persist empty assignment arrays until a later member capability is designed.

For `manager` and `viewer`, empty assignment arrays should be accepted only if the product intentionally wants a no-access placeholder membership. Route authorization already treats empty assignment arrays as no scoped access.

## Last-Owner Protection

Future implementation must prevent any operation that would leave an organization without at least one active owner membership.

Protection applies to:

- disabling an owner
- changing an active owner to another role
- changing an active owner to `invited` or `disabled`
- removing owner membership if a delete/remove route is ever added

Recommended algorithm:

1. Load the target membership by `{ organization_id: orgId, id: memberId }`.
2. If the target is not `role: "owner"` and `status: "active"`, normal role rules apply.
3. If the target is an active owner and the requested change would make it no longer active owner, count active owners in the organization excluding no records.
4. If active owner count is `1`, reject with `403 last_owner_required`.
5. Apply the mutation only after the check and target update are coupled as tightly as the current Mongo setup allows.

Because there is no transaction requirement in current Sprint 2 scope, implementation should use a narrow atomic predicate where practical, then verify post-update active owner count. If the post-update verification detects a bad state, the implementation must fail loudly and restore or require manual remediation rather than silently proceeding.

## Endpoint: Create Direct Member

```text
POST /api/v1/orgs/:orgId/members
```

Purpose: create a membership for an existing app user by `user_id`. This is not an email invitation endpoint.

Allowed caller roles:

- `owner`: may create `owner`, `admin`, `manager`, `member`, or `viewer`
- `admin`: may create `manager`, `member`, or `viewer`

Denied caller roles:

- `manager`
- `viewer`
- `member`
- `invited`
- `disabled`
- missing membership

Request body:

```json
{
  "user_id": "target_user_id",
  "role": "manager",
  "assigned_client_ids": ["client_id"],
  "assigned_location_ids": ["location_id"]
}
```

Validation rules:

- `orgId` is required from the URL.
- `user_id` is required and must identify an existing local app user.
- `role` is required and must be one of `owner`, `admin`, `manager`, `member`, or `viewer`.
- Caller role must be allowed to create the requested target role.
- New direct memberships are `status: "active"`.
- `invited_by_user_id` should be omitted or null for direct active membership creation.
- Assignment arrays must be arrays of strings and should be deduped.
- Assignment ids must belong to the requested organization.
- Do not store email for direct create unless a later safe user lookup/display policy is approved.

Response body:

```json
{
  "member": {},
  "created": true
}
```

Idempotency behavior:

- Upsert key remains `{ organization_id, user_id }`.
- If no membership exists, create one.
- If an active membership exists with the same role and same assignment arrays, return it with `created: false`.
- If any membership exists with a different role, status, or assignment set, return `409 member_exists` and require `PATCH`.
- Do not silently reactivate disabled members.
- Do not silently convert invited members to active members.

Audit event:

- `organization.member.create`

Audit metadata should include:

- `organization_id`
- target `membership_id`
- target `user_id`
- target `role`
- caller membership role
- assignment counts only, not raw large payloads
- result status

## Endpoint: Update Member

```text
PATCH /api/v1/orgs/:orgId/members/:memberId
```

Purpose: update role, status, and assignment arrays for an existing membership. This endpoint should not be used as an invitation acceptance flow.

Allowed caller roles:

- `owner`: may update all member roles, subject to last-owner protection.
- `admin`: may update `manager`, `member`, and `viewer` memberships only.

Denied caller roles:

- `manager`
- `viewer`
- `member`
- `invited`
- `disabled`
- missing membership

Request body:

```json
{
  "role": "viewer",
  "status": "active",
  "assigned_client_ids": ["client_id"],
  "assigned_location_ids": ["location_id"]
}
```

Validation rules:

- `orgId` and `memberId` are required from the URL.
- At least one supported field must be present.
- `role`, if present, must be one of the supported roles.
- `status`, if present, must be one of `active`, `invited`, or `disabled`.
- Caller role must be allowed to manage both the existing target role and the requested target role.
- Assignment ids must belong to the requested organization.
- Last active owner cannot be downgraded or disabled.
- `user_id`, `organization_id`, `id`, `created_at`, and `invited_by_user_id` are not patchable in this endpoint.
- `updated_at` must be refreshed on successful mutation.

Response body:

```json
{
  "member": {},
  "updated": true
}
```

Idempotency behavior:

- Applying the same patch repeatedly should return the same sanitized member with `updated: false` or equivalent no-op metadata.
- No duplicate membership documents may be created.

Audit event:

- `organization.member.update`

Audit metadata should include:

- `organization_id`
- target `membership_id`
- target `user_id`
- before/after role and status
- before/after assignment counts
- caller membership role
- result status

## Endpoint: Disable Member

```text
POST /api/v1/orgs/:orgId/members/:memberId/disable
```

Purpose: disable a membership without deleting it.

Allowed caller roles:

- `owner`: may disable any member except where last-owner protection blocks the operation.
- `admin`: may disable `manager`, `member`, and `viewer` memberships only.

Denied caller roles:

- `manager`
- `viewer`
- `member`
- `invited`
- `disabled`
- missing membership

Request body:

```json
{
  "reason": "optional short operator note"
}
```

Validation rules:

- `orgId` and `memberId` are required from the URL.
- Target membership must exist in the requested organization.
- Caller role must be allowed to disable the target role.
- Last active owner cannot be disabled.
- Reason is optional, must be short if accepted, and must not expose secrets or raw user data.

Response body:

```json
{
  "member": {},
  "disabled": true
}
```

Idempotency behavior:

- Disabling an already disabled member should return the sanitized disabled member with `disabled: false` or equivalent no-op metadata.
- Do not delete the membership document.

Audit event:

- `organization.member.disable`

Audit metadata should include:

- `organization_id`
- target `membership_id`
- target `user_id`
- target role
- caller membership role
- compact reason if provided
- result status

## Future Endpoint: Email Invitation

```text
POST /api/v1/orgs/:orgId/invitations
```

Status: future/not implemented in Sprint 2 until email delivery, invite acceptance, token handling, and resend/expiry policy are designed.

Purpose: create an invited membership or invitation record by email.

Allowed caller roles in a future contract:

- `owner`: may invite `owner`, `admin`, `manager`, `member`, or `viewer`
- `admin`: may invite `manager`, `member`, or `viewer`

Request body in a future contract:

```json
{
  "email": "person@example.com",
  "role": "viewer",
  "assigned_client_ids": ["client_id"],
  "assigned_location_ids": ["location_id"]
}
```

Future validation requirements:

- Normalize email.
- Do not return raw email except where the invite/member display contract explicitly allows it.
- Do not print invite tokens.
- Store invite tokens hashed if tokens are introduced.
- Define expiry, resend, acceptance, and cancellation behavior before implementation.
- Do not send email from worker/scheduler until that runtime behavior is explicitly designed.

Audit event:

- `organization.invitation.create`

## Fixture Strategy

Fixture goal: safely verify owner/admin/manager/viewer/member/invited/disabled allow/deny behavior without damaging Beetle working data.

Use controlled local fixture records with obvious prefixes:

- organization name/id prefix: `s2-15-fixture-`
- membership id prefix: `s2-15-member-`
- user id prefix only if synthetic local users are created: `s2-15-user-`

Recommended approach:

1. Create or reuse a dedicated local fixture organization that is not a Beetle production-like workspace.
2. Create or reuse local fixture users that do not contain real email addresses in proof output.
3. Seed memberships for one active `owner`, `admin`, `manager`, `viewer`, `member`, plus `invited` and `disabled` cases.
4. Use direct Mongo fixture writes only through a reviewed dry-run-first script or a controlled test helper. Do not mutate real user memberships.
5. Print summarized ids and counts only.
6. Never print emails, JWTs, OAuth tokens, provider payloads, encrypted secrets, passwords, or raw user records.
7. Prefer retaining fixtures with clear prefixes for repeatable smoke tests. If cleanup exists later, only cleanup records with the exact fixture prefixes and document the action.

Smoke-test matrix:

| Scenario | Expected result |
| --- | --- |
| Owner creates/updates/disables manager/viewer/member | Allowed. |
| Owner attempts to disable/downgrade final active owner | Denied with `last_owner_required`. |
| Admin creates/updates/disables manager/viewer/member | Allowed. |
| Admin attempts to manage owner/admin | Denied with `organization_role_required`. |
| Manager attempts member mutation | Denied. |
| Viewer/member attempts member mutation | Denied. |
| Invited/disabled requester attempts member mutation | Denied. |
| Assignment id outside org | Denied with `assignment_scope_invalid` or `bad_request`. |
| Missing membership | Denied fail-closed. |

## Test Strategy

Future implementation should include:

- `node:test` helper tests for role management rules.
- `node:test` helper tests for last-owner protection.
- `node:test` helper tests for assignment validation.
- Route tests for create, patch, disable, safe errors, idempotency, and response sanitization.
- Existing org creation/listing/report/location-bound tests should remain green.
- Live smoke using controlled fixtures only.
- Frontend tests are not included until a later frontend workspace/member UI task.

## Migration And Data Impact

No migration is needed for this contract design.

Future implementation should not require schema migration for direct member management because `organization_members` already contains role, status, assignment arrays, and invite-related fields.

A fixture seed script may be useful as S2-15, but it must be safe, scoped, dry-run-first, and non-destructive by default.

## Recommended Next Tasks

- S2-15: design or implement a dry-run-first local fixture seed/audit workflow for owner/admin/manager/viewer/member/invited/disabled memberships.
- S2-16: implement member-management API routes only after S2-14 is verified and fixture strategy is accepted.

Do not start frontend workspace/member UI until the member-management API behavior and fixture coverage are verified.
