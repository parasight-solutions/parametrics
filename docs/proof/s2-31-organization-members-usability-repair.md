# S2-31 Organization Members Usability Repair Proof Pack

Status: COMPLETE (pending GPT verification)

Task: S2-31 (Phase 1 / Sprint 2 — Workspace Member Usability Repair).

## 1. Scope And Decision

The Organization Members UI was technically functional but unusable: it required
admins to already know an internal `user_id`, and the member list showed only raw
user ids and membership ids with no human-friendly names. S2-31 repairs usability
by adding a safe read-only user lookup/search endpoint and safe display names
(masked emails) in both the candidate search and the member list.

This task changed backend org/member route + service, the frontend Organization
Members page + helper, their tests, and docs/proof only. It did not change
auth/JWT behavior, Google provider auth, report APIs, or add invitations/emails,
and installed no dependencies.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pass. See "GPT Verification" at the end of this proof.

## 2. Docs Read

- `CLAUDE.md`, `docs/claude-code/README.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-2-closeout-proof-pack.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`
- `docs/architecture/workspace-members.md`
- `docs/architecture/member-management-api-contract.md`
- `docs/runtime/processes.md`
- `apps/api/src/routes/orgs.js`, `apps/api/src/routes/orgs.test.js`
- `apps/api/src/services/organizationMembers.js`, `apps/api/src/services/organizationMembers.test.js`
- `apps/web/src/pages/OrganizationMembers.jsx`
- `apps/web/src/lib/memberManagement.js`, `apps/web/src/lib/memberManagement.test.js`

Also inspected to determine the real user shape: `apps/api/src/routes/auth.js`,
`apps/api/src/routes/auth.google.js`, `apps/api/src/scripts/admin.reset.js`,
`apps/api/src/scripts/seed.mongo.js`, `apps/api/src/startup/ensureIndexes.js`,
`apps/api/src/services/organizationAccess.js`, `apps/api/src/lib/mongo.js`,
`apps/web/src/apiClient.js`.

## 3. Files Changed

- `apps/api/src/services/organizationMembers.js` — added safe user-lookup helpers
  and the `searchMemberCandidates` service.
- `apps/api/src/routes/orgs.js` — added the `GET /api/v1/orgs/:orgId/member-candidates`
  route + `listMemberCandidatesForUser` wrapper, and enriched
  `listOrganizationMembersForUser` with optional safe nested `user` display info.
- `apps/api/src/services/organizationMembers.test.js` — 10 new tests.
- `apps/api/src/routes/orgs.test.js` — 6 new tests.
- `apps/web/src/lib/memberManagement.js` — `searchMemberCandidates`, `maskEmail`,
  `normalizeCandidateRow`, `normalizeMemberRow`, candidate query helpers; member
  listing now normalizes rows.
- `apps/web/src/lib/memberManagement.test.js` — 10 new helper tests.
- `apps/web/src/pages/OrganizationMembers.jsx` — search UI, candidate rows,
  display-name-first member list, advanced manual `user_id` fallback.
- `docs/architecture/workspace-members.md` — S2-31 section.
- `docs/backlog/sprint-2-workspace-member-foundation.md` — S2-31 note.
- `docs/codex/sprint-2-phase-1-guardrails.md` — S2-31 completion entry.
- `docs/proof/s2-31-organization-members-usability-repair.md` — this proof doc.

No `apps/api/package.json`, `apps/web/package.json`, or `package-lock.json`
changes. No dependencies installed.

## 4. Inspected User Collection / Fields

Collection: `users`, accessed through `col("users")` in
`apps/api/src/lib/mongo.js`. Confirmed fields across `auth.js`,
`auth.google.js`, `admin.reset.js`, `seed.mongo.js`, and `ensureIndexes.js`:

| Field | Notes | Safe to display? |
| --- | --- | --- |
| `id` | string UUID; equals JWT `user_id` and `organization_members.user_id` | yes (as `user_id`) |
| `email` | login + Google identity | only masked |
| `normalized_email` | lowercase email index | never (used for matching only) |
| `password` / `password_hash` | bcrypt hash (local users) | never |
| `full_name` | set by Google OIDC from the id-token `name` | yes (as `display_name`) |
| `name` | not the primary field, handled defensively if ever present | yes |
| `role` | e.g. `individual`, `admin`, `super_admin` | not exposed by candidate search |
| `status` | e.g. `active`; used to exclude non-active users | not exposed |
| `oauth_provider` / `oauth_sub` | Google identity | never |
| `created_at` / `updated_at` | timestamps | not exposed |
| `_id` | Mongo id | never |

Important finding: the real display field is **`full_name`** (not
`first_name`/`last_name`). `display_name` is derived defensively as
`full_name` → `name` → email local-part → `User <short id>` (superseded in S2-31.1: the email local-part step was removed; see the S2-31.1 addendum). Indexes:
unique `email`, unique `normalized_email`, unique `oauth_provider+oauth_sub`.

## 5. Candidate Search Endpoint Behavior

`GET /api/v1/orgs/:orgId/member-candidates?search=<query>&limit=<n>`

- Requires app authentication (existing `authenticate` middleware).
- Authorization via `organization_members` only (`requireOrganizationRole` with
  `allowedRoles = ["owner", "admin"]`). Denies `manager`/`viewer`/`member` with
  `403 organization_role_required`; denies `invited`/`disabled`/missing with
  `403 organization_membership_required`. JWT `role` and `location_org_map` are
  never used. Authorization is checked before organization existence.
- Search: term `>= 2` chars does a case-insensitive contains match over
  `id`, `email`, `normalized_email`, and `full_name`; a shorter term only matches
  an exact `user_id`. Empty search ⇒ `400 bad_request`.
- `limit` default `10`, max `25`.
- Excludes disabled/deleted users: `deleted !== true`, `disabled !== true`, and
  `status` not in `["disabled","deleted","suspended","inactive","banned"]`. Users
  with no `status` field remain eligible. The Mongo query enforces this and a
  JS-side filter re-applies it defensively.
- Marks `already_member` and `membership_role` from the org's `organization_members`
  rows (prefers an active membership when several exist).

Safe response shape:

```json
{
  "users": [
    {
      "user_id": "…",
      "display_name": "Jane Doe",
      "email_masked": "j***@company.com",
      "already_member": true,
      "membership_role": "manager"
    }
  ]
}
```

## 6. Member List Display Enhancement

`GET /api/v1/orgs/:orgId/members` is unchanged in contract and still returns the
existing sanitized member fields. It now additionally attaches an optional
sanitized nested object per member when the user document is available:

```json
{ "user": { "display_name": "Jane Doe", "email_masked": "j***@company.com" } }
```

Members whose `user_id` has no matching user document (for example synthetic
fixture ids) keep the original shape with no `user` field. Enrichment is skipped
entirely when no users collection is available, preserving backward
compatibility with existing callers/tests. `create`/`update`/`disable` contracts
are unchanged.

## 7. Frontend UX Behavior

- Heading/subtitle no longer imply that admins must know an internal id: the page
  subtitle is "Search for an existing user to add them to this workspace."
- A "Search existing user" form (explicit Search button) with loading, empty, and
  error states. Candidate rows show `display_name`, `email_masked`, the `user_id`
  as a secondary technical detail, and an "already a member" badge with role.
- Selecting a candidate fills the target `user_id`; the field is read-only by
  default with an "Advanced: enter user_id manually" toggle as a fallback.
- The member list shows `display_name` as the primary label, `email_masked` when
  available, `user id` as a secondary technical detail, and the membership id
  clearly labeled "membership id". Raw emails, tokens, secrets, provider
  payloads, and raw records are never displayed.
- Backend `error.code: error.message` envelopes continue to surface verbatim;
  app-auth/Google-reauth handling via the existing `api()` client is unchanged.

## 8. Sanitization / No-Secret Behavior

- The candidate service projects only safe user fields and builds each row via
  `sanitizeMemberCandidate`, which emits only `user_id`, `display_name`,
  `email_masked`, `already_member`, `membership_role`. `_id`, `password`,
  `normalized_email`, `oauth_*`, tokens, and raw records are never returned.
- Emails are always masked (`maskEmail`): only the first local character plus the
  domain are shown (`j***@company.com`); a raw email is never returned to the
  client.
- Member listing enrichment exposes only `display_name` + `email_masked`.
- Backend and frontend unit tests assert via `JSON.stringify` scans that raw
  emails, passwords, and Mongo `_id` never appear in serialized output.

## 9. Tests / Build / Checks

```bash
node --check apps/api/src/services/organizationMembers.js
node --check apps/api/src/routes/orgs.js
node --check apps/api/src/services/organizationMembers.test.js
node --check apps/api/src/routes/orgs.test.js
node --check apps/web/src/lib/memberManagement.js
node --check apps/web/src/lib/memberManagement.test.js
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --name-only -- apps/api/package.json apps/web/package.json package-lock.json
git diff --check
```

Outcomes:

- `node --check` of every changed JS file: OK.
- `cd apps/api && npm test`: `tests 219 / pass 219 / fail 0 / skipped 0`
  (was 203; +16 — 6 in `orgs.test.js`, 10 in `organizationMembers.test.js`).
- `cd apps/web && npm test -- --run`: `Test Files 5 passed (5) / Tests 59 passed (59)`
  (was 49; +10 new helper tests).
- `cd apps/web && npm run build`: success, `288 modules transformed`; pre-existing
  Browserslist data-age warning unchanged.
- `git diff --name-only -- apps/api/package.json apps/web/package.json package-lock.json`:
  empty.
- `git diff --check`: clean.

New backend tests cover: candidate search returns sanitized rows with correct
`already_member`/`membership_role`; owner/admin allowed; manager/viewer/member
denied; missing/invited/disabled denied; empty search rejected; disabled/deleted
users excluded; member listing enrichment with and without a user document; plus
unit tests for `maskEmail`, `deriveUserDisplayName`, `buildUserPublicProfile`,
`normalizeCandidateLimit`, `buildMemberCandidateQuery`, and
`sanitizeMemberCandidate`. New frontend tests cover `clampCandidateLimit`,
`buildCandidateQuery`, `maskEmail` (no leak), `normalizeCandidateRow`, and
`normalizeMemberRow` (with/without nested user).

## 10. Explicit Non-Goals

S2-31 did not: implement email invitations or send emails; add invitation token
issuance/acceptance/resend/cancel; change auth/JWT behavior; change Google
provider auth; add Phase 2 providers; change report APIs; change the
create/update/disable member contracts; use JWT role or `location_org_map` for
authorization; auto-bind Google locations; install dependencies; commit; or push.

## 11. Remaining Risks

- Candidate search reads the `users` collection directly. There is no dedicated
  text index for `full_name`; the case-insensitive regex contains-match relies on
  the bounded `limit` (default 10, max 25) and a per-request fetch cap. For very
  large user collections an index on `full_name` would help; not in scope here.
- `already_member` is computed from up to 1000 scanned memberships per org
  (`MEMBER_CANDIDATE_MEMBERSHIP_SCAN_LIMIT`); organizations beyond that size could
  under-flag, which is far above realistic membership counts for this app.
- Disabled/deleted exclusion keys off `status` plus `deleted`/`disabled` boolean
  flags; if a future user lifecycle introduces a different inactive flag it must
  be added to `NON_ACTIVE_USER_STATUSES`.
- The frontend search uses an explicit Search button (no debounce) for
  deterministic behavior; rapid typing does not auto-query.
- No interactive browser click-through smoke was run in this environment; behavior
  is covered by backend route/service tests and frontend helper tests.
- Pre-existing Browserslist build warning is unchanged.

## 12. Ready For GPT Verification

Superseded by the S2-31-fix addendum below. At original S2-31 time the counts were
API `219` and web `59`; an earlier version of this line said "web tests (72)",
which was incorrect for S2-31 (59 was the real count then). Current counts after
S2-31-fix are API `231` and web `72` — see "Verification status (S2-31-fix)".

## S2-31-fix Addendum (404 + Fake-User + UI Repair)

S2-31 was not accepted: the live API returned Express `404 Cannot GET` for
`GET /api/v1/orgs/9658a8f2-…/member-candidates?search=mahesh&limit=10`, a fresh
API start hit `EADDRINUSE :::5050`, the UI let "mahesh" look addable, the Add
Member layout was misaligned, and assigned client/location fields and raw ids
were confusing.

### Root cause of the 404

Not a mounting/order bug. `apps/api/src/server.js:68` mounts `orgsRouter` at
`/api/v1/orgs`; `apps/api/src/routes/orgs.js:605` defines
`GET /:orgId/member-candidates` ahead of `GET /:orgId/members` (619), and no
generic `/:orgId/:x` GET route exists that could shadow it. The route, its
service, and its tests exist only in uncommitted working-tree changes (last
commits `b5ee739`, `e34be7b`, `4e4c5b7` do not touch orgs/members), and the API
runs as plain `node src/server.js` with no file watcher. The browser therefore hit
a stale API process started before the route was added. That same stale process
held port 5050, which explains the `EADDRINUSE :::5050` on the fresh start.

By the time this fix ran, nothing was listening on 5050 or 5051 and no
ParaMetrics API process existed. Ports 5173/5174 were held by Vite processes whose
cwd is `/var/www/html/calm-pm/frontend` (a different project). They were not
touched.

Structural protection (tests in `apps/api/src/routes/orgs.test.js`):

- A router-stack test asserts `member-candidates` is registered before
  `/:orgId/members`.
- A shadowing test asserts the first GET layer whose matcher accepts
  `/9658a8f2-…/member-candidates` is the candidate route itself.
- An HTTP test mounts the real orgs router under `/api/v1/orgs` on an ephemeral
  port and asserts an unauthenticated request returns `401 unauthorized`, not
  Express `Cannot GET`.

### Live smoke (completed, against local MongoDB)

Runtime handling:

- `ss`/`ps` were inspected first. 5050 and 5051 were free; 5173/5174 belong to
  `/var/www/html/calm-pm/frontend` and were left alone.
- The API only was started from the current tree with `PORT=5051`
  (`server.js:81` reads `process.env.PORT`). No worker and no scheduler were
  started. After the smoke the process (cwd `/var/www/html/parametrics/apps/api`)
  was stopped, and 5050/5051 were confirmed free.
- The configured `MONGODB_URI` Atlas SRV host returned `querySrv ENOTFOUND` from
  this host, even outside the sandbox, while general DNS worked. The API therefore
  exited at startup on the first attempt.
- The smoke instead used `MONGODB_URI=mongodb://127.0.0.1:27017`,
  `MONGO_DB=parametrics` (a local mongod). The env loader only fills missing
  values, so the explicit override applied.
- The local DB has no copy of org `9658a8f2-…` (0 orgs, 0 member rows) and has 1
  user.
- A short-lived (10 min) JWT was minted with `signJwt({ user_id: <synthetic smoke
  owner> })`. Its role was the default `individual`. The token was never printed.

Phase 1 used the exact target URL, org `9658a8f2-9f08-45a3-ad58-24de3a34a68e`:

| Call | Result |
| --- | --- |
| unauth `GET …/member-candidates?search=mahesh&limit=10` | `401 unauthorized`, no Express "Cannot GET" |
| auth `GET …/member-candidates?search=mahesh&limit=10` | `403 organization_membership_required`. The route was reached; the smoke user has no local membership. |
| auth `POST …/members {user_id:"definitely-not-real-s2-31-user"}` | `404 not_found`: app JSON "org not found", because the org is absent locally. Not Express. |
| target org member rows | before `0`, after `0` |

Phase 2 used a temporary local fixture: org `s2-31-fix-smoke-org` plus one active
owner membership for the synthetic smoke user. A pre-check confirmed both ids were
unused.

| Call | Result |
| --- | --- |
| owner `GET member-candidates?search=mahesh` | `200`, 0 rows (no local user matches "mahesh") |
| owner `GET member-candidates?search=definitely-not-real` | `200`, 0 rows |
| owner `GET member-candidates?search=<local user's exact id>` (id not printed) | `200`, 1 row. Keys were exactly `already_member, display_name, email_masked, membership_role, user_id`. `email_masked` contains `***`. No `_id`/`password`/`normalized_email`/`email`/oauth keys. |
| owner `POST members {user_id:"definitely-not-real-s2-31-user"}` | `404 user_not_found`. Fixture member rows before `1`, after `1`; rows with this user_id anywhere `0`. |
| owner `POST members {user_id:"mahesh"}` | `404 user_not_found`. Fixture member rows before `1`, after `1`; rows with this user_id anywhere `0`. |
| owner `GET members` | `200`, 1 row. Member fields unchanged; no `user` key, because the synthetic owner has no user doc (backward-compatible path). |

Cleanup and invariants:

- The fixture memberships and fixture org were deleted (1 + 1 per run, 0
  remaining).
- `location_org_map` count was `0` before and `0` after.
- Authorization came from `organization_members` only.

Not covered live:

- The real org `9658a8f2-…` data lives in the unreachable Atlas cluster, so a
  200 candidate search against that org's real members was not run.
- No interactive browser click-through was run.

To re-run against the real DB once Atlas resolves, from `apps/api`:

```bash
ss -ltnp | grep -E ':5050|:5051' || true
PORT=5051 node src/server.js        # API only; no worker/scheduler
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:5051/api/v1/orgs/9658a8f2-9f08-45a3-ad58-24de3a34a68e/member-candidates?search=mahesh&limit=10"
# expect 401 (not 404). Then repeat with a locally minted owner JWT
# (signJwt from src/lib/jwt.js, never printed): expect 200 or 403, and
# POST {"user_id":"definitely-not-real-s2-31-user"} → 404 user_not_found with no new row.
```

### Fake-user prevention (backend)

`createOrganizationMember` (`organizationMembers.js:545-559`) validates the target
against the `users` collection whenever one is available. The orgs route wrapper
always resolves and passes it at runtime (`orgs.js:375`).

- A missing user returns `404 user_not_found`. The message is generic and does
  not echo the id.
- A user that is `deleted: true`, `disabled: true`, or has a non-active `status`
  (disabled/deleted/suspended/inactive/banned) returns `400 invalid_user_id`.
- Validation runs before any insert. Tests assert that the membership row count
  is unchanged for `"mahesh"` and `"definitely-not-real-s2-31-user"`.
- Assignment ids remain rejected (`409 assignment_scope_invalid`) for
  owner/admin/member (test added).

### Fake-user prevention (frontend)

The add flow is now driven by pure helpers in `memberManagement.js`, all
unit-tested:

- `initialAddSelection`, `editCandidateQuery`, `selectCandidateForAdd`,
  `clearSelectedCandidate`, `toggleManualUserIdMode`, `editManualUserId`
- `resolveCreateTargetUserId`, `canSubmitMemberCreate`,
  `buildCreateMemberPayload`

How the flow behaves:

- The target `user_id` comes only from a selected candidate, or from the explicit
  advanced manual field. Typed search text is never an input to it.
- Editing the search box clears the selected candidate.
- Add member stays disabled until a candidate is selected. With "Advanced: enter
  user_id manually" on, it needs a non-empty manual id instead.
- Toggling manual mode clears both the selection and the manual id.
- Candidates that are `already_member` cannot be selected, and the Add button
  stays disabled for them.
- The manual field explains: "Use only if you know the exact existing app
  user_id. The server checks that this user exists and is active; unknown ids are
  rejected."
- Errors and success are now separate states. Search start, search failure,
  search edit, selection, and org change all clear both.
- The success message appears only after a successful create response that
  carries a `member`. It names the member and role ("Member added: <name> as
  <role>."). `created:false` shows "already a member … No changes made."

### UI layout

- **Search row:** the label sits above a `flex items-center` row. The input and
  the Search button are both `h-10`.
- **Shared classes:** primary, secondary, and small buttons, and the inputs, use
  shared class constants so heights match.
- **Organization selector:** the select and the Refresh buttons now sit on one
  aligned row, with the organization ID shown below as a muted "technical" line.
- **Order:**
  1. "1. Find an existing user" (search)
  2. Candidate results (the selected row is highlighted)
  3. "2. User to add" card: either the selected user (name, masked email, muted
     User ID, Clear button), the dashed "No user selected" placeholder, or the
     amber advanced manual field
  4. Role / Status
  5. Optional scope fieldset
  6. Add member, with an inline hint explaining why it is disabled
- **Empty search:** "No matching users found" now explains that the person must
  sign in to ParaMetrics once before they can be added.

### Assigned client/location fields

- The fields appear only when the role is `manager` or `viewer`, inside a
  "Scope (optional, <role> only)" fieldset with the exact helper copy "Optional
  advanced scope. Leave blank unless you know the client/location IDs." The edit
  form uses the same copy.
- Owner, admin, and member never see the fields.
- `buildCreateMemberPayload` sends assignment arrays only for manager/viewer.
- The backend still rejects assignments for unsupported roles.
- No dropdowns were built.

### Member list / disable

- Each row shows `display_name` as the bold primary label. The fallback is
  "Unnamed user"; the raw user id is never the primary label.
- Below it: the masked email, or a muted "No profile email on file".
- Then added/updated dates and scope counts.
- Then a muted technical line: "User ID (technical): …" and "Membership ID
  (technical): …".
- Disable asks `window.confirm(buildDisableConfirmMessage(member))`, which names
  the display name and user ID and states that the membership is not deleted.
- The Disable button is disabled and reads "Disabled" for already disabled
  members, and the handler also short-circuits for them.

### Files changed (S2-31-fix, cumulative in working tree)

- `apps/api/src/services/organizationMembers.js`: target-user validation on
  create; `isActiveUserAccount`.
- `apps/api/src/routes/orgs.js`: passes the resolved `users` collection into
  create.
- `apps/api/src/routes/orgs.test.js`: registration, shadowing, and
  unauthenticated-401 HTTP tests; fake-id, inactive-flag, and
  unsupported-role-assignment create tests.
- `apps/api/src/services/organizationMembers.test.js`: `isActiveUserAccount` and
  service create-validation tests.
- `apps/web/src/lib/memberManagement.js`: add-selection helpers, payload builder,
  display label, and disable-confirm message.
- `apps/web/src/lib/memberManagement.test.js`: tests for those helpers.
- `apps/web/src/pages/OrganizationMembers.jsx`: selection-required flow, layout,
  scope fieldset, and member row display.
- Docs: this proof, `docs/architecture/workspace-members.md`,
  `docs/backlog/sprint-2-workspace-member-foundation.md`,
  `docs/codex/sprint-2-phase-1-guardrails.md`.

### Verification status (S2-31-fix)

- `node --check` passed for all six changed JS files (api routes/services + tests,
  web lib + test). The `.jsx` page is verified by the Vite build.
- `cd apps/api && npm test`: `tests 231 / pass 231 / fail 0 / skipped 0`. The
  history is 219 → 226 → 231:
  - S2-31-fix pass 1 added 7: 4 in `orgs.test.js`, 3 in
    `organizationMembers.test.js`. (An earlier note listed only "4 + 3 = 6"
    items. The correct total is 7.)
  - This pass added 5 in `orgs.test.js`: shadowing, unauthenticated-401 over
    HTTP, fake ids, inactive flags, and unsupported-role assignments.
- `cd apps/web && npm test -- --run`: `Test Files 5 passed (5) / Tests 72 passed (72)`
  (was 59; +13 add-selection/payload/display/confirm tests).
- `cd apps/web && npm run build`: success, `288 modules transformed`; the
  pre-existing Browserslist data-age warning is unchanged.
- `git diff --name-only -- apps/api/package.json apps/web/package.json package-lock.json`:
  empty (no dependency changes).
- `git diff --check`: clean.
- `git status --short`: the 10 modified files above plus this untracked proof
  file; nothing unrelated.

### Remaining risks (S2-31-fix)

- A live 200 against the real org `9658a8f2-…` is unverified because the
  configured Atlas SRV host does not resolve from this machine. Route mount, auth,
  fake-user rejection, and the response shape were verified live against local
  MongoDB.
- No interactive browser click-through was run. UI behavior is covered by helper
  unit tests and a successful build only. A human should eyeball the layout once.
- The user's previously running stale API must be restarted onto the current tree
  before re-testing in the browser. The `node src/server.js` scripts have no file
  watcher.
- Create validation is skipped only when a caller injects collections without a
  `users` collection (unit-test context); the runtime path always validates.

## S2-31.1 Addendum (UX Polish + Browser Verification)

### Context and root cause recap

The S2-31 live `404 Cannot GET …/member-candidates` came from a stale API process
that had been started before the uncommitted route existed. `node src/server.js`
has no file watcher, and that same process held port 5050 (`EADDRINUSE`). The code
mount was always correct: `server.js:68` → `orgs.js:605`. This is guarded by the
registration, shadowing, and unauthenticated-401 HTTP tests from S2-31-fix.
**Lesson:** restart the API onto the current tree before any live check.

### UX issues found (from the user screenshot and review)

1. The Add Member form still felt technical: raw `user_id` was visible and there
   was no clear step order.
2. The search → select → role → add hierarchy was unclear.
3. Technical IDs (user ID, membership ID) dominated each member row.
4. The assigned client/location fields were confusing, and nothing said that
   owner/admin/member do not need them.
5. Button heights were inconsistent (`h-10` vs `h-8`, plus `py-2` selects in the
   edit form).
6. Success and error states needed to be unambiguous.

### Fixes made

Add a member (`apps/web/src/pages/OrganizationMembers.jsx`) now has four numbered
steps: **1 Search existing user**, **2 Select user**, **3 Choose role**, **4 Add
member**.

- **Step 1: search.** The input and Search button sit on one row, both `h-10`.
  A search failure shows "Search failed: …" (`candidate-search-error`) and clears
  any earlier success message.
- **Step 2: select.**
  - Each candidate is a full-width selectable row button with a hover state, a
    selected ring, `aria-pressed`, and a Select / Selected pill.
  - Already-member rows are greyed out, `disabled`, and labelled "Already a member
    · <role>".
  - Rows show the name and masked email only; there is no raw ID.
  - A "Selected: <name> · <masked email>" bar has a Clear button.
  - Manual entry is a collapsed **"▸ Advanced: enter user_id manually"**
    disclosure, closed by default. Its panel says to use it only with an exact
    existing app user_id and that the server rejects unknown ids.
- **Step 3: choose role.**
  - Role and Status selects.
  - For manager/viewer only, a fieldset titled **"Optional advanced scope"** with
    the helper text "Leave blank unless this member should only access specific
    clients or locations." and Client IDs / Location IDs inputs. Their
    placeholder reads "Leave blank for full access".
  - For owner/admin/member: "Owner, admin, and member roles do not need client or
    location assignments." The edit form uses the same copy.
- **Step 4: add member.**
  - The Add member button is disabled until a candidate is selected, or until
    Advanced mode is open with a non-empty user_id.
  - Inline hint text explains why it is disabled, or shows "Adds <name> as
    <role>."
  - On success: "<Name> was added as <role>." (`create-success`, green).
  - On failure: "Not added: <code>: <message>" (`create-error`, amber).
- **Buttons.** One shared `h-10` button base for primary and secondary buttons,
  and row actions. Edit-form inputs and selects use the shared `h-10` input class.

Member list:

- **Row content:** the display name, or "Unnamed user", is primary. Then come the
  role and status badges, the masked email, and added/updated dates with scope
  counts.
- **Technical IDs:** user ID and membership ID moved into a collapsed muted
  **"▸ Technical details"** `<details>` element.
- **Disable:** the confirm text is exactly "Disable membership for <display name
  or user id>? This does not delete the user." (`buildDisableConfirmMessage`).
  Disabled members show a greyed, disabled **Disabled** button.

Helpers (`apps/web/src/lib/memberManagement.js`): `buildDisableConfirmMessage`
was reworded, and `memberConfirmName` and `buildMemberAddedMessage` were added.
All are unit-tested.

**Backend privacy fix (one function).** Agent B's audit found that
`deriveUserDisplayName` fell back to the email local part for users with no
`full_name`/`name`. Shown next to `email_masked` (`j***@company.com`), that
reconstructed the raw email for owner/admin/manager viewers. That breaks the
"no raw emails" hard requirement, so the fallback was removed. Nameless users now
show `User <first 8 of id>`.

This is the only backend change in S2-31.1. Its test was updated, and a new test
asserts that a nameless profile cannot be combined to rebuild the email.
`organizationMembers.js` was edited for privacy, not for fake-user validation.
That is a judgment call against the task's narrow allowance for this file, and it
is flagged here for GPT.

### Backend safety re-confirmed (read-only audit + tests)

- **Candidate endpoint access:** owner/admin only, via `organization_members`
  (`orgs.js:21, 290-298` → `organizationAccess.js`). Manager/viewer/member get
  `403 organization_role_required`; missing/invited/disabled memberships get
  `403 organization_membership_required`. There is no JWT-role check (no
  `req.user.role` in member routes).
- **location_org_map:** used only by `/bind-location` as a legacy write, never for
  auth.
- **Create checks:** create rejects missing users (`404 user_not_found`) and
  non-active users (`400 invalid_user_id`) before any insert. On the runtime
  route path the `users` collection is always resolved.
- **PATCH:** cannot change `user_id`.
- **Responses:** candidate rows are built field by field from a fixed projection.
  Member enrichment adds only `{display_name, email_masked}`. Responses never
  contain `_id`, password, `normalized_email`, raw email, OAuth data, or tokens.
- **Error messages and audit:** error messages are fixed strings that never echo
  the submitted id. Audit metadata holds ids, roles, statuses, and counts only.
- **Search input:** the search regex is escaped and the term is capped at 200
  characters. Limits are bounded: candidates 10 by default, 25 max; at most 200
  users fetched.

### Browser verification (Playwright, completed)

**Tooling.** Playwright 1.63.0 was already present in the local npx cache
(`~/.npm/_npx/…/node_modules/playwright`), with cached Chromium headless shell
build 1243 (Chromium 153). Nothing was installed and no `package.json` changed.
The script lives outside the repo, in the session scratchpad.

**Runtime handling.**

- First inspection with `ss -ltnp` / `ps`: 5173/5174 belonged to Vite processes
  with cwd `/var/www/html/calm-pm/frontend`, another project, and were left alone.
  5050, 5051, and 5175 were free.
- API: `MONGODB_URI=mongodb://127.0.0.1:27017 MONGO_DB=parametrics PORT=5051 node
  src/server.js` (API only; no worker or scheduler). The configured Atlas SRV host
  still returns `ENOTFOUND` from this machine, so local MongoDB was used.
- Web: `VITE_API_BASE_URL=http://127.0.0.1:5051 VITE_API_PORT=5051
  VITE_WEB_PORT=5175 npx vite --host 127.0.0.1 --port 5175 --strictPort`.
  Local-environment CORS allows localhost origins.
- Shutdown: both processes were stopped after verification, each checked to have
  a cwd under `/var/www/html/parametrics`. The orphaned Vite child (PID 225140)
  was stopped separately after the same check. 5050, 5051, and 5175 were free
  afterwards, and calm-pm's 5173/5174 were untouched.

**Fixtures.** Temporary, prefixed `s2-31-1-ui-*`, in local MongoDB. A pre-check
confirmed none existed, and they were deleted at the end (3 memberships, 1 org,
5 users; 0 remaining):

- 1 org with an owner membership.
- An active candidate.
- An already-member user (viewer).
- A nameless user with an email only.
- A `disabled: true` user.

Fixture emails use the reserved `example.test` domain and were never printed.
The owner JWT (10-minute expiry, role default `individual`) was minted with
`signJwt` and injected into `localStorage.token` via `addInitScript`. It was
never printed. `location_org_map` count was 0 before and 0 after.

**Result: `SUMMARY 32/32 passed`.**

| # | Check | Result |
| --- | --- | --- |
| 1 | `/organization-members` loads (authenticated) | PASS |
| 2 | Members nav active (`bg-gray-900` active class; AppShell has no `aria-current`) | PASS |
| 3 | 4 step headings in order: Search existing user → Select user → Choose role → Add member | PASS |
| 4 | Advanced manual entry hidden by default; toggle visible | PASS |
| 5 | Add member disabled before selecting a candidate | PASS |
| 6 | Search input and button aligned (both y=458.5, h=40) | PASS |
| 7 | Typed search text alone does not enable Add | PASS |
| 8 | Search results render (3 rows for "mahesh") | PASS |
| 9 | `disabled: true` account not offered | PASS |
| 10 | Already-member row visibly disabled and not selectable | PASS |
| 11 | Nameless user shows `User <id8>` with no email local part | PASS |
| 12 | Clicking a row selects it (`aria-pressed=true`) and enables Add | PASS |
| 13 | Editing search clears the selection and disables Add | PASS |
| 14 | Scope fields visible only for manager/viewer (owner/admin/member false) | PASS |
| 15 | Scope helper text exact | PASS |
| 16 | Owner/admin/member show the "do not need … assignments" copy | PASS |
| 17 | Success text exactly "Mahesh Smoke Candidate was added as manager." | PASS |
| 18 | No error shown alongside success | PASS |
| 19 | Exactly one membership row created | PASS |
| 20 | Simulated search 500 shows "Search failed" and no success message | PASS |
| 21 | Advanced panel opens on demand; Add still disabled until an id is entered | PASS |
| 22 | Fake manual `definitely-not-real-s2-31-user` shows "Not added: user_not_found: target user does not exist", no success | PASS |
| 23 | No membership created for the fake id (org count unchanged; 0 rows anywhere) | PASS |
| 24 | Member list shows display names | PASS |
| 25 | Member list shows masked emails only | PASS |
| 26 | Technical IDs collapsed by default | PASS |
| 27 | Technical IDs available on expand | PASS |
| 28 | Disable confirm exactly "Disable membership for Mahesh Smoke Candidate? This does not delete the user." | PASS |
| 29 | Disabled member shows a disabled "Disabled" button | PASS |
| 30 | No raw fixture email anywhere in page HTML | PASS |
| 31 | Only the 2 intentional negative-test requests failed (simulated `GET member-candidates 500`, `POST members 404`) | PASS |
| 32 | Console errors only from those 2 intentional requests | PASS |

**Note on the first run.** It scored 31/32. A blunt "no console errors" check
counted the browser's resource-load log lines from the two intentional negative
tests (rows 20 and 22). The check was tightened to assert the exact set of failed
requests, and the full script was re-run at 32/32.

**Screenshots.** Desktop at 1280 px (add card and full page) and mobile at 390 px
full page were captured to the session scratchpad and reviewed visually.

- **Desktop:** aligned search row, highlighted selected row, greyed
  already-member row, collapsed technical details, Disabled button state.
- **Mobile:** layout reflows with no overflow.
- **Full-page capture artifact:** the sticky AppShell header appears mid-image.
  This is not a layout bug.

Screenshots were not added to the repo; there is no `docs/proof` asset
convention.

### Commands / checks (S2-31.1)

```bash
ss -ltnp | grep -E ':5050|:5051|:5173|:5174|:5175' || true
ps aux | grep -E 'node src/server.js|vite|npm run.*dev' | grep -v grep || true
node --check apps/api/src/services/organizationMembers.js
node --check apps/api/src/services/organizationMembers.test.js
node --check apps/api/src/routes/orgs.js
node --check apps/api/src/routes/orgs.test.js
node --check apps/web/src/lib/memberManagement.js
node --check apps/web/src/lib/memberManagement.test.js
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
node <scratchpad>/ui_verify.mjs        # Playwright pass described above
git diff --name-only -- apps/api/package.json apps/web/package.json package-lock.json
git diff --check
```

Outcomes:

- `node --check` OK on all six JS files. The `.jsx` page is verified by the
  build.
- API: `tests 232 / pass 232 / fail 0 / skipped 0` (was 231; +1 nameless-profile
  privacy test, plus 1 updated display-name test).
- Web: `Test Files 5 passed (5) / Tests 74 passed (74)` (was 72; +2 net). The
  disable-confirm test was rewritten to the exact wording, and tests were added
  for the user-id fallback and the member-added message.
- Build: `288 modules transformed`, success. The pre-existing Browserslist
  data-age warning is unchanged.
- Package diff: empty. `git diff --check`: clean.
- `git status --short`: the same 10 modified files plus this untracked proof;
  nothing unrelated.

### Files changed (S2-31.1)

- `apps/web/src/pages/OrganizationMembers.jsx`: 4-step add flow, selectable
  candidate rows, collapsed Advanced manual entry, Optional advanced scope panel
  and no-assignment copy, unified button and input heights, success/error states,
  member rows with collapsed Technical details, Disabled state.
- `apps/web/src/lib/memberManagement.js` and `.test.js`: confirm and added
  message helpers, with tests.
- `apps/api/src/services/organizationMembers.js` and `.test.js`: removed the
  email local-part display fallback (privacy), with tests.
- Docs: this addendum; `docs/architecture/workspace-members.md` (display-name
  derivation corrected, plus the **Product UX Lessons** note); backlog and
  guardrails S2-31.1 lines.
- `orgs.js` / `orgs.test.js`: no S2-31.1 change. No real route bug remains.

### Remaining risks (S2-31.1)

- **Real org data unverified.** The real org `9658a8f2-…` lives in the Atlas
  cluster, whose SRV host does not resolve from this machine. Browser and API
  verification used local MongoDB fixtures. A final look against real data
  should happen once Atlas resolves; restart the API first.
- **Existing nameless users change label.** They now show `User <id8>` instead of
  the email local part. This is intentional for privacy, but it changes labels.
- **PATCH reactivation.** PATCH can set a disabled membership back to `active`
  without re-checking that the user account is still active. This predates
  S2-31, is out of scope, and is noted for a future task.
- **Name-only users unreachable by search.** The candidate DB query `$or` omits
  `name` while the in-memory filter checks it, so users matching only on `name`
  are not returned. This is harmless and out of scope.
- **No `aria-current` on nav.** `AppShell.jsx` is not in the allowed file list,
  so the active nav state is asserted by its CSS class.

## S2-31.2 Addendum (Local Review Login Fix + UX Challenge)

S2-31.1 was committed as `f271b02`. The user then tried a local browser review:

- API on 5051 with local MongoDB, web on 5175.
- They logged in at `/login` as the hand-seeded `review-owner@example.com`.
- They got "Login failed."

### Diagnosis (evidence, no secrets printed)

Running processes, inspected but not modified:

| Process | PID | cwd | Relevant env |
| --- | --- | --- | --- |
| API `node src/server.js` | 344544 | `/var/www/html/parametrics/apps/api` | `PORT=5051`, `MONGODB_URI=mongodb://127.0.0.1:27017/parametrics` |
| Vite | 356988 | `/var/www/html/parametrics/apps/web` | `VITE_API_BASE_URL=http://127.0.0.1:5051` |

Other listeners on 5173/5174 belong to `/var/www/html/calm-pm/frontend` and were
left alone. The API started after the last API code change, so it was not stale.

1. **Web → API wiring was correct.** In a Playwright capture, the login form
   POSTs to `http://127.0.0.1:5051/api/v1/auth/login`. CORS returns
   `access-control-allow-origin: http://127.0.0.1:5175`.
2. **The API login works for the seeded user.** A direct
   `curl -X POST :5051/api/v1/auth/login` with the UI's payload
   (`{email, password}`) returned `200` with keys `token, user` (token not
   printed). A browser login through the form then redirected to `/`.
3. **`auth.js` expectations.** `POST /api/v1/auth/login`, body `{ email, password }`.
   - Lookup: `normalized_email` first, then a case-insensitive `email` match.
   - Requires a `password` field and runs `bcrypt.compare(password, user.password)`.
   - No status check.
   - The seeded user matches exactly: `normalized_email` set, `password` is a
     60-char `$2a$` bcrypt hash that matches `Review123!`, and `password_hash` is
     identical. **No auth.js bug.**
4. **Audit log for `auth.login`** (reasons and booleans only):
   - 09:22:52Z and 09:23:27Z: `invalid_credentials`, user not found. The email
     was the login form's **prefilled default `admin@example.com`**, and no such
     local user exists.
   - 09:23:20Z: `invalid_credentials`, user not found (a different, non-local
     email).
   - 10:25:56Z: the review owner **was found** (`target_id` set), but bcrypt
     compare failed. The user doc was created at 10:25:34Z and never updated
     afterwards, and its hash matches `Review123!`. So the password submitted at
     10:25:56Z was not `Review123!`.
   - `Login.jsx` pre-fills a masked default password (`Admin@123456`). The most
     likely cause is that the prefilled password was left in place or typed into.
     It cannot be proven exactly, because the submitted password is never logged
     (correctly).
5. **Second, independent blocker.** The hand seed wrote the review org to an
   **`organizations`** collection. The app reads **`orgs`**, which was empty. So
   even a successful login would have shown "No organizations available", and
   members/candidates would have returned `404 org not found`. There were also no
   "Mahesh" candidates beyond one hand-seeded user.
6. **Related latent issue (not changed).** `apps/api/src/scripts/seed.mongo.js`
   writes only `password_hash`, but `auth.js` reads `password`, so users created
   by that script can never log in with a password. This is a plausible origin
   for hand-rolled seeds getting the shape wrong.

### Root cause

- **Not an app auth bug.** The local review setup was not auth- and app-compatible:
  the org was in the wrong collection, no reliable fixture existed, and no login
  had been verified.
- **The specific "Login failed."** It is explained by a password mismatch at
  submit time. The login form's prefilled default credentials (`Login.jsx`) are
  the likely trap.
- **Login.jsx untouched.** It is outside this task's allowed files, so it was not
  changed; it is recommended as a follow-up (remove the prefilled credentials).

### Fix made (setup only; no auth code change)

New **`apps/api/src/scripts/seed.local-review.s2-31.js`** (local/dev review only,
no new dependencies; uses the existing `bcryptjs`, `lib/mongo.js`, and
`startup/env.js`).

- **Modes:** dry run by default, `--apply` (create or reset), `--cleanup`
  (remove).
- **Guards:**
  - Refuses `NODE_ENV=production`.
  - Refuses any non-local Mongo host. Verified: with the default `.env` Atlas URI
    it prints "refusing to run against non-local MongoDB host ((srv))" and writes
    nothing.
  - Touches only `s2-31-review-*` ids.
  - Aborts if a fixture email belongs to another user id.
  - Never prints hashes, tokens, or raw docs.
- **Creates or resets:**
  - Owner `review-owner@example.com` (`password` and `password_hash` = bcrypt of
    the fixture password, `status: active`).
  - Org `s2-31-review-org` in **`orgs`**.
  - Memberships: owner (Review Owner), manager (Priya Manager), viewer (Mahesh
    Existing).
  - Candidates Mahesh Kumar and Maheshwari Rao.
  - A `disabled: true` "Mahesh Disabled", which must never be offered.
  - It removes the stray `organizations` doc with that exact id.
- **Idempotent.** A re-apply resets the review org to the fixture membership set,
  removing rows added during a review. Verified: running `--apply` twice gave
  identical state.
- A pre-existing hand-seeded `s2-31-review-candidate` ("Mahesh Review User") is
  left in place by `--apply` and removed by `--cleanup` (prefix match).

Usage, from `apps/api`:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/parametrics node src/scripts/seed.local-review.s2-31.js           # dry run
MONGODB_URI=mongodb://127.0.0.1:27017/parametrics node src/scripts/seed.local-review.s2-31.js --apply   # create/reset
MONGODB_URI=mongodb://127.0.0.1:27017/parametrics node src/scripts/seed.local-review.s2-31.js --cleanup # remove
```

**Local review login.** Email `review-owner@example.com`, password `Review123!`.
This is a fixture-only credential on the reserved `example.com` domain, created
only by the local-guarded seed. It is not a secret; never reuse it outside local
review. **Clear the prefilled fields on `/login` before typing.**

### UX challenge (after login worked)

| Question | Finding | Change (allowed files only) |
| --- | --- | --- |
| Is the add flow obvious without internal IDs? | Mostly, but roles had no meaning attached. | Plain-language role hint under the role picker (`describeRole`). It describes only behavior the backend enforces today. |
| Are assignment fields hidden except manager/viewer? | Yes, but the default role `viewer` showed the ID inputs expanded on first load, and the placeholder "Leave blank for full access" asserted an unverified access semantic. | The scope panel is now a collapsed `<details>` "Optional advanced scope (not needed for most members)" containing the required helper copy. It shows "(IDs entered)" when values exist. The placeholder is now "Optional". |
| Are technical IDs secondary? | Yes (collapsed "Technical details"). Member rows still showed "Scope: clients 0 · locations 0" on owner/admin/member, where scope doesn't apply. The list header was developer copy. | The scope line appears only for manager/viewer ("No client/location limits set" or "Limited to N clients and M locations"). The header now shows the member count. |
| Are errors/success clear? Any trap? | The owner's own row offered **Disable**, which is self-lockout bait; the backend only blocks the *last* owner. | A **You** badge on your own row. Disable on your own row is disabled ("You can't disable your own membership"), and the handler also guards it. The current user id comes from the stored login user or the JWT `user_id` claim; it is a UI hint only, and the API still enforces access. |
| Is the search button aligned? Is mobile OK? | Aligned (y and height identical). On mobile the search placeholder truncated ("jane@comp…"). | The placeholder is now "Name or email". Mobile reviewed: no overflow or truncation. |
| Out of scope (reported, not changed) | `Login.jsx` prefilled credentials. AppShell nav is `hidden md:flex`, so mobile has no Members link. AppShell has no `aria-current`. | Recommended follow-ups. |

New helpers in `memberManagement.js`, all unit-tested:

- `describeRole`
- `memberScopeSummary` (never lists raw ids)
- `decodeJwtUserId` (unverified, UI-only)
- `resolveCurrentUserId`
- `isCurrentUserMember`

### Browser verification (Playwright through the real login form)

Playwright 1.63.0 from the existing npx cache; nothing installed. It ran against
**the user's own running stack** (API 5051 PID 344544, Vite 5175 PID 356988),
which is exactly what the user reviews. Vite HMR served the working-tree page.
No token injection was used: the browser logs in through `/login`.

The first pass, before the UX changes, scored 25/25. One of those lines was an
informational placeholder, which was replaced with real assertions. The final
pass, after the UX changes and a seed reset, scored **31/31**:

- **Login and navigation:**
  - Login works through the form, calls `http://127.0.0.1:5051/api/v1/auth/login`,
    and redirects.
  - `/organization-members` loads via the nav, Members nav is active, and the
    review org is selected.
- **Member list:**
  - It shows Review Owner / Priya Manager / Mahesh Existing.
  - The own row has the **You** badge, with Disable blocked.
  - The scope line appears only on manager/viewer rows.
- **Add form initial state:**
  - Add member is disabled before selection.
  - Advanced manual entry is hidden.
  - Search input and button are aligned (y 458.5/458.5, h 40/40).
- **Search and select:**
  - "Mahesh" returns 4 rows. The disabled account is not offered, and the
    already-member row is disabled.
  - Add stays disabled after a search without selection.
  - Selecting Mahesh Kumar enables Add.
- **Role and scope:**
  - The scope panel is collapsed by default, with ID inputs hidden.
  - It expands to show the exact helper text.
  - Role help is shown and updates per role.
  - Scope fields appear only for manager/viewer (`{"owner":false,"admin":false,"member":false,"manager":true,"viewer":true}`).
- **Add and reject:**
  - Add shows "Mahesh Kumar was added as viewer." and exactly one row is
    created.
  - Fake manual `definitely-not-real-s2-31-user` shows "Not added:
    user_not_found: target user does not exist", and no row is created.
- **Disable:**
  - The confirm text is exactly "Disable membership for Mahesh Kumar? This does
    not delete the user."
  - Cancel leaves the member active. Accept shows the Disabled state.
- **Hygiene:**
  - No raw fixture email appears in the page HTML.
  - The only failed API call was the intentional fake-add `404`.
- **Note:** the login form is prefilled with default credentials
  (`Login.jsx`, out of scope).

Screenshots were reviewed for desktop (1280 px, search results and full page)
and mobile (390 px full page). They are stored in the session scratchpad, not the
repo. Afterwards `--apply` was re-run, so the review org is back to its clean
fixture state (3 memberships) for the user's own review.

### Commands / checks (S2-31.2)

```bash
ss -ltnp | grep -E ':5050|:5051|:5173|:5174|:5175|:5176' || true
ps aux | grep -E 'node src/server.js|vite|npm run.*dev' | grep -v grep || true
curl -s -X POST -H 'Content-Type: application/json' http://127.0.0.1:5051/api/v1/auth/login -d '{...}'   # 200, keys token,user (token not printed)
node --check apps/api/src/scripts/seed.local-review.s2-31.js
node --check apps/web/src/lib/memberManagement.js
node --check apps/web/src/lib/memberManagement.test.js
cd apps/api && npm test
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --name-only -- apps/api/package.json apps/web/package.json package-lock.json
git diff --check
```

Outcomes:

- `node --check` OK on all three JS files; the `.jsx` page is verified by the
  build.
- API: `tests 232 / pass 232 / fail 0 / skipped 0` (unchanged; no API runtime
  code changed).
- Web: `Test Files 5 passed (5) / Tests 81 passed (81)` (was 74; +7).
- Build: `288 modules transformed`, success; the Browserslist warning is
  unchanged.
- Package diff: empty. `git diff --check`: clean.
- `git status --short` before these doc edits: `M memberManagement.js`,
  `M memberManagement.test.js`, `M OrganizationMembers.jsx`,
  `?? seed.local-review.s2-31.js`.

### Processes and cleanup

- **No processes started or stopped.** All verification used the user's
  already-running API (5051) and Vite (5175). calm-pm processes were untouched.
- **Review fixtures intentionally left in place** (reset to the clean state) so
  the user can review immediately. Remove them with `--cleanup` when done.

### Remaining risks (S2-31.2)

- **`Login.jsx` pre-fills `admin@example.com` / `Admin@123456`.** This is the
  likely trap behind the reported failure, and it is out of scope here.
  Recommended follow-up: empty defaults.
- **`seed.mongo.js` writes only `password_hash`,** so its users cannot log in via
  `auth.js`. Out of scope; recommended follow-up.
- **Mobile has no Members nav link,** and AppShell has no `aria-current`
  (`AppShell.jsx` is out of scope).
- **The "You" detection is a UI hint.** If no stored user exists and the JWT has
  no `user_id`, the badge and self-guard simply don't show. The backend
  `last_owner_required` still protects the last owner.
- **Real Atlas data is still unverified,** because the SRV host does not resolve
  from this machine.
- **No script-specific test.** The seed script has no unit test: adding one to
  `npm test` would require a `package.json` change. It was verified by running
  dry-run, guard refusal, double `--apply`, and a real browser login.

## S2-31.3 Addendum (Existing-Account Login Diagnosis + Login Prefill Fix)

The user wanted to log in with their existing real account instead of the local
review account.

### Current DB mode

The running review API (PID 344544, cwd `/var/www/html/parametrics/apps/api`,
started by the user, not modified) runs with `PORT=5051` and
`MONGODB_URI=mongodb://127.0.0.1:27017/parametrics`. That is **local MongoDB**,
not Atlas. The Vite dev server (PID 356988, port 5175) has
`VITE_API_BASE_URL=http://127.0.0.1:5051`. The calm-pm listeners on 5173/5174
were left alone.

`startup/env.js` only fills env vars that are missing or blank. It loads
`apps/api/.env.local`, then `.env`, then `apps/api/.env`. So the explicit local
`MONGODB_URI` overrides the Atlas URI configured in `.env` / `apps/api/.env`.

### Does the existing account exist locally?

No. Local `users` has 8 documents, all on `example.com`: 7 `s2-31-review-*`
fixtures plus 1 older local test user with no password. No user with the account
owner's email exists locally, and no `gmail.com` or `parasightsolutions.com` user
does either. These were checked as booleans and counts only; no addresses were
printed.

`auth.js` looks users up in whatever database the API is connected to. A real
account, with its orgs and memberships, exists only in the configured Atlas
database, so it **cannot** log in against local MongoDB unless it is copied
there. Copying the real password hash or real data locally is out of scope and
was not done.

### Atlas reachability

The configured Atlas URI (`mongodb+srv`, host `cluster0.<redacted>.mongodb.net`,
the only database host referenced in any env file) does not resolve. The cluster
id segment is redacted in this proof:

| Test | Result |
| --- | --- |
| System resolver A/AAAA (`getent hosts`) | not found |
| `dig SRV _mongodb._tcp.<host>` via system resolver | empty |
| same via `8.8.8.8` and `1.1.1.1` | empty; `8.8.8.8` returns **`status: NXDOMAIN`** |
| `dig NS mongodb.net @8.8.8.8` (parent zone) | resolves (awsdns) |
| general DNS / HTTPS from this machine | OK |

Likely cause:

- Public DNS returns NXDOMAIN for the cluster's SRV name while the parent zone
  resolves. So this is **not** a local DNS/network problem and **not** an IP
  allowlist issue: an allowlist blocks connections, not DNS.
- The most consistent explanations are that the cluster was **deleted or
  terminated**, or that the configured **hostname is wrong**, for example from a
  re-created cluster with a new id.
- A paused cluster normally keeps its DNS records, so a pause is less likely, but
  only the Atlas UI can confirm this.
- No connection was attempted beyond DNS, and no DB changes were made.

There is no staging or production API: every API/app URL in env files and docs
is localhost (`API_URL`, `APP_PUBLIC_API_BASE`, `APP_URL`, `CORS_ORIGIN*`), and
no deployed host is documented. No URL was invented.

Google sign-in is not a workaround either. `auth.google.js` finds or inserts the
user in the connected (local) DB, so it would create a new, empty local user,
not reach real data. Its redirect URI defaults to
`http://localhost:<API port>/api/v1/auth/google/callback`, which must be
registered in Google Cloud for the chosen port. It was not attempted.

### Is existing-account login possible locally right now?

**No.** The real account's data is in an Atlas cluster that does not resolve from
this machine, and there is no other deployed API. Local review login
(`review-owner@example.com`) keeps working.

### Recommended path (exact fix needed)

1. In MongoDB Atlas, check the project for the cluster:
   - If it still exists, copy its **current** connection string ("Connect →
     Drivers").
   - If it is paused, resume it.
   - If it was deleted, restore from a backup or point the app at the
     replacement cluster.
2. Put the new `mongodb+srv://…` value in `apps/api/.env` (git-ignored), or pass
   it as `MONGODB_URI=…` when starting the API. Then confirm DNS from this
   machine: `dig +short SRV _mongodb._tcp.<new-host>` must return records.
3. Ensure this machine's public IP is in the Atlas Network Access allowlist.
4. Start the API against Atlas on a free port, e.g. `PORT=5052 node
   src/server.js` from `apps/api` (API only). Start the web with
   `VITE_API_BASE_URL=http://127.0.0.1:5052 npx vite --host 127.0.0.1 --port
   5176 --strictPort`. Then log in at `http://127.0.0.1:5176/login` with the real
   email and password, typed by the user.
5. Until then, review with the local account
   (`review-owner@example.com` / `Review123!`, seeded by
   `seed.local-review.s2-31.js --apply`).

### Login UX issue (fixed)

- **Problem:** `apps/web/src/pages/Login.jsx` initialised the form with
  `admin@example.com` / `Admin@123456`, a default account that does not exist
  locally, with the masked password field already filled. The S2-31.2 audit log
  showed attempts with that default email, and the reported "Login failed." most
  likely came from this prefill.
- **Fix:** the form starts empty via an exported frozen
  `LOGIN_INITIAL_FORM = { email: "", password: "" }`. The email field is
  `type="email"` with `autoComplete="username"`; the password field has
  `autoComplete="current-password"` so password managers fill the real account.
  No auth logic changed.
- **Tests:** new `apps/web/src/pages/Login.test.js` (3 tests):
  - the initial form is empty and frozen;
  - the source contains no `Admin@123456` and no email literal passed to
    `useState`;
  - the autocomplete hints are present.
- **Browser:** the Playwright review pass on the user's 5175 now asserts that the
  login form starts empty and carries the autocomplete hints. **33/33 passed**,
  including login → Organization Members → search/select/add → fake-id rejection
  → disable confirm. The review org was reset with `--apply` afterwards.

### Secret-handling incident during this diagnosis (disclosure)

Twice, while inspecting env files, a redaction filter did not handle a quoted
value or a commented-out line. The full Atlas `MONGODB_URI`, including the DB
user's password, was echoed into the assistant's local tool output.

- It was **not** written to any file, doc, commit, or external service.
- The env files are git-ignored and were never committed (`git ls-files` and
  `git log` checked).
- Because the value appeared in a session transcript, and the password is weak,
  **rotate that Atlas database user's password** when the cluster is
  fixed or replaced.
- Env-file inspection now reads key names and booleans only.

### Security note (S2-31-finalize)

- **Exposure scope.** The Atlas credential was exposed only in the assistant's
  local tool output during S2-31.3. A later verification grep also had the
  password literal typed into its command text. Both are session-transcript
  exposures only.
- **No secret in tracked files or committed docs.** A finalize-time scan loaded
  every secret-like value from the local env files in-process. It printed only
  key names and file locations, never values, and checked them against all
  changed and new files and the full `git diff`.
  - **Not found anywhere:** the Atlas password, the full Atlas URI,
    `APP_ENC_KEY`, `JWT_SECRET`, `OPENAI_API_KEY`, the Google client secrets, and
    the encryption keys.
  - **Two false positives:** the Atlas DB username is the project name
    `parametrics`, so every hit is a path or the DB name. The local Postgres URL's
    password is a 3-letter word that occurs inside ordinary words such as
    `apps/`. Neither ever appears in a `user:pass@` credential position.
  - **Generic patterns found nothing:** credentialed `mongodb(+srv)://` strings,
    JWTs, `sk-` keys, Google `ya29.` / `1//0` tokens, private-key blocks, and
    `KEY=`/`SECRET=` assignments.
  - **Redacted:** the Atlas cluster hostname id is redacted in this proof.
- **Rotation required.** The Atlas DB user password **must be rotated before
  that cluster is used again** (resumed, restored, or replaced with a new
  connection string).
- **This proof never contains the password or the URI.**

## S2-31-finalize Addendum

### Accuracy statements (current state)

- **Local review account.** `review-owner@example.com` exists only in **local
  MongoDB** (`mongodb://127.0.0.1:27017/parametrics`). It is created by
  `apps/api/src/scripts/seed.local-review.s2-31.js --apply` and does not exist in
  Atlas or any deployed environment.
- **Real-account login** requires an API connected to the real database (Atlas).
  It cannot work against local MongoDB, which holds only `example.com` fixture
  users.
- **Atlas.** The configured Atlas SRV hostname currently returns **NXDOMAIN**
  from public DNS (8.8.8.8) while `mongodb.net` resolves. The owner must resume,
  restore, or replace the cluster and update the git-ignored connection string,
  then rotate the DB user password first (see Security note).
- **Login page.** `apps/web/src/pages/Login.jsx` no longer pre-fills
  `admin@example.com` / `Admin@123456`. The form starts empty
  (`LOGIN_INITIAL_FORM`), with `username` / `current-password` autocomplete. This
  is covered by `apps/web/src/pages/Login.test.js` (3 tests).
- **Browser verification passed.** A Playwright run through the real `/login`
  form on the user's running API 5051 + Vite 5175 (local MongoDB) scored 33/33:
  - an empty login form, login, the Organization Members page, a "Mahesh" search,
    Add disabled until selection, a successful add;
  - fake `user_id` → `user_not_found` with no row;
  - assignment fields only for manager/viewer, the exact disable confirmation,
    the self row protected;
  - no raw emails.
- **The seed script is local/dev only.** `assertLocalReviewEnvironment()` throws
  when `NODE_ENV=production` or when the Mongo host is not `127.0.0.1` /
  `localhost` / `::1`; any `mongodb+srv` URI counts as non-local. It only touches
  `s2-31-review-*` ids and aborts on email conflicts. Re-verified at finalize
  time, each run exiting `1` before any write:
  - **Default env (Atlas URI):** "refusing to run against non-local MongoDB host
    ((srv))".
  - **`mongodb+srv://example.invalid/x`:** the same refusal.
  - **`NODE_ENV=production` with a local URI:** the shared env loader's JWT
    strength check (`assertSafeJwtConfig`) refuses first.
  - **The same, plus a dummy 40-character test `JWT_SECRET`, so the script's own
    guard is reached:** "refusing to run with NODE_ENV=production".
  - **Data check:** review-org memberships stayed at 3, unchanged.

### Docs integrity incident (disclosure + correction)

While re-checking the diff at finalize time, `git diff --stat` showed
`docs/architecture/workspace-members.md` (−485) and
`docs/backlog/sprint-2-workspace-member-foundation.md` (−70) **emptied to a
single newline** in the working tree.

- **Cause:** a trailing-newline cleanup one-liner used in S2-31.2 and S2-31.3,
  `open(p,'w').write(open(p).read()…)`. It truncates the file before reading it.
- **Effect:** the S2-31.2/S2-31.3 reports were **wrong** to say those two docs
  were updated. Their additions (the S2-31.2 "local UX review needs
  auth-compatible seed + browser login" lesson, the S2-31.3 "know which DB a
  login hits / never pre-fill credentials" lesson, and the S2-31.2/.3 backlog
  follow-ups) are not in the working tree.
- **Committed state is intact.** HEAD `f271b02` still has the full committed
  versions of both files, including the S2-31.1 "Product UX Lessons".
- **Detected before commit; nothing emptied was ever committed.**
- **Restored (S2-31.4).** With explicit user authorization,
  `git restore docs/architecture/workspace-members.md
  docs/backlog/sprint-2-workspace-member-foundation.md` returned both files to
  HEAD. The result was byte-identical to HEAD: 486 and 71 lines, and an empty
  `git diff` for both.
- **Required notes re-applied safely**, with targeted Edit-tool insertions only
  and no rewrite or newline-trim commands:
  - The architecture lessons gained the "Local UX review must include
    auth-compatible seed data and verified login" and "Know which database a
    login hits, never pre-fill credentials" bullets. The stale "implemented in
    the working tree" line was corrected to cite `f271b02`.
  - The backlog gained an S2-31.2/S2-31.3 status block covering usability, the
    login prefill removal, the seed script, real-DB reachability, Atlas
    credential rotation, and the remaining follow-ups.
- **Final line-count and heading checks passed.** They are recorded in
  "S2-31.4 final checks" below.
- **Guardrails and proof** were edited by insertion only and were never
  affected.

### Commands / checks (S2-31.3)

- `ss -ltnp …` / `ps aux …` port and PID inspection.
- `/proc/<pid>/environ` for the running API/web: redacted keys only.
- `dig` / `getent` DNS tests against the Atlas host only.
- Local `users` lookups returning booleans and counts.
- `node --check` OK on: `seed.local-review.s2-31.js`, `memberManagement.js`,
  `memberManagement.test.js`, `Login.test.js`. The `.jsx` files are verified by
  the build.
- `cd apps/api && npm test`: `tests 232 / pass 232 / fail 0 / skipped 0`.
- `cd apps/web && npm test -- --run`: `Test Files 6 passed (6) / Tests 84 passed (84)`
  (was 81; +3 Login tests).
- `cd apps/web && npm run build`: `288 modules transformed`, success.
- Package diff: empty. `git diff --check`: clean.
- `git status --short`, all uncommitted:
  - From S2-31.2: `M memberManagement.js`, `M memberManagement.test.js`,
    `M OrganizationMembers.jsx`, `?? seed.local-review.s2-31.js`, and the doc
    edits.
  - New in S2-31.3: `M Login.jsx`, `?? Login.test.js`.

### Remaining risks (S2-31.3)

- **Real-account login is blocked.** It stays blocked until the Atlas cluster or
  hostname is fixed or replaced (owner action in the Atlas UI); this cannot be
  fixed from code.
- **Atlas credential rotation is recommended.** See the disclosure above.
- **Weak plaintext DB credentials.** `apps/api/.env` and `.env` hold plaintext,
  weak DB credentials; they are git-ignored. A secrets manager or at least a
  stronger password is recommended.
- **Native email validation.** `type="email"` adds browser email validation to
  the login field, which is harmless for valid emails.
- **Out of scope, still open:** `seed.mongo.js` writes only `password_hash`, and
  there is no Members link in the mobile nav.

## S2-31.4 final checks (restore + follow-up commit)

Docs restore:

- `git restore` of both truncated docs succeeded, bringing back the HEAD
  versions (486 / 71 lines).
- Notes were then re-applied with targeted edits only.
- **Final line counts:** `docs/architecture/workspace-members.md` 500
  (`+16 / −2` vs HEAD; the two removed lines are the edited "Current state" and
  "Product UX Lessons" heading lines). `docs/backlog/sprint-2-workspace-member-foundation.md`
  83 (`+12 / −0`).
- **Expected headings present:** the architecture doc has `## S2-31 Member
  Lookup And Safe Display` and `### Product UX Lessons (S2-31 through S2-31.3)`,
  including the "Local UX review must include auth-compatible seed data and
  verified login" lesson. The backlog has `## S2-31 Member Lookup Usability
  Repair` and the `S2-31.2 / S2-31.3 follow-up status` block.

Secret scan over the 10 changed or new files plus the full `git diff`:

- **Patterns checked:** `mongodb+srv://`, `://user:pass@`, `APP_ENC_KEY`,
  `JWT_SECRET`, `OPENAI_API_KEY`, `GOOGLE_*CLIENT_SECRET`, `refresh_token`,
  `access_token`, private-key markers, and env-file dumps.
- **13 hits, all classified as mentions without values.** These are key names
  and the `mongodb+srv` scheme or host mentioned without credentials.
- **2 env-dump flags:** both are the seed script's documented usage lines, which
  use the credential-free local `mongodb://127.0.0.1:27017/parametrics`.
- **Value-based scan:** real env values were loaded in-process and only labels
  were printed. The Atlas password, Atlas URI, and all key/secret values were
  not found. The only credential-adjacent matches were the project name and a
  3-letter word, never in a credential position.
- **Result: PASS**, 0 real secrets.

Checks:

- `node --check` OK on 4 JS files.
- API `232/232`.
- Web `Test Files 6 / Tests 84 passed`.
- Build `288 modules transformed`.
- Package/lock diff empty.
- `git diff --check` clean.

This is committed as a follow-up on top of `f271b02`. There is no amend and no
history rewrite.

## GPT Verification

GPT decision: Pass.

GPT verified S2-31/S2-31.1/S2-31.2/S2-31.3/S2-31.4 after the restored-doc guard,
secret scan, API tests, web tests, web build, no package/lock diff, clean diff
check, and pushed follow-up commit e22e3be. Atlas credential rotation remains a
required external security action before using Atlas again.

Commit provenance:

- `f271b02` (S2-31 through S2-31.1) was committed by the human.
- `e22e3be` (the S2-31.2 through S2-31.4 follow-up) was committed and pushed by
  Claude Code under explicit S2-31.4 user authorization.
- Neither commit was amended or rewritten.
