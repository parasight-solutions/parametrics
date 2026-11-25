# Legacy UI Authentication and Logout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the legacy UI logout deterministically confirm the existing server logout before clearing local authentication state, while preventing stale authentication operations from restoring an obsolete user.

**Architecture:** Keep the cookie-session API and routing unchanged. Add a small operation-generation coordinator to the legacy AuthProvider, expose logout progress/error state, and make AppShell's existing Logout action render that state. Test the transition logic independently and the real Account > Logout interaction with a mounted React integration test.

**Tech Stack:** React 19, React Router 7, native Fetch, Vitest, React Testing Library with jsdom.

**Spec:** `docs/superpowers/specs/2026-11-25-legacy-ui-auth-logout-design.md`

## Global Constraints

- Modify only the legacy frontend under `apps/web`, its workspace dependencies, tests, and task documentation.
- Do not modify `apps/api`, `apps/client`, or `feat/automatic-google-post-sync`.
- Preserve credentialed cookie authentication and the bodyless HTTP 204 logout contract.
- Do not store authentication credentials in browser storage.
- Keep the existing Account menu and Logout action; do not redesign the UI.
- Leave all changes uncommitted and unpushed for review.

## Review Focus

- A session restoration that resolves after logout starts must not restore the old user; Task 2 pins this race.
- A second Logout click during an in-flight request must not issue another request; Task 2 pins repeated interaction.
- A failed logout must retain the authenticated user and cached state while showing a safe retry path; Task 2 pins this behavior.
- Switching from User A to User B must clear User A's persisted UI state before installing User B; Task 2 pins account switching.
- Component unmount during restoration or logout must not update React state; Task 2 pins cleanup behavior.

---

### Task 1: Deterministic legacy authentication transitions

**Files:**
- Create: `apps/web/src/context/authOperations.js`
- Create: `apps/web/src/context/authOperations.test.js`

**Interfaces:**
- Produces: `createAuthOperationTracker()` with `begin(): number`, `isCurrent(generation): boolean`, and `invalidate(): number`

- [ ] **Step 1: Write failing operation-tracker tests**

Test that generations are monotonically increasing, only the latest generation is current, and invalidate makes every previously captured generation stale.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -w @parametrics/web -- --run src/context/authOperations.test.js`

Expected: FAIL because the operation tracker and deterministic transitions do not exist.

- [ ] **Step 3: Implement `createAuthOperationTracker()`**

Use a closure-held integer generation. No timers, global state, or persisted generation values.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -w @parametrics/web -- --run src/context/authOperations.test.js`

Expected: PASS.

### Task 2: Real Logout interaction and feedback

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package.json` (root-resolved jsdom test environment for the workspace Vitest binary)
- Modify: `package-lock.json`
- Modify: `apps/web/src/context/AuthContext.jsx`
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/components/AppShell.jsx`
- Create: `apps/web/src/context/AuthContext.integration.test.jsx`
- Modify: `apps/web/src/apiClient.test.js`

**Interfaces:**
- Consumes: Task 1's `createAuthOperationTracker()`
- Produces from AuthContext: existing auth fields plus `logoutLoading: boolean`, `logoutError: string`, and `clearLogoutError(): void`
- Produces: existing Logout button with in-flight disabling and safe inline retry feedback

- [ ] **Step 1: Add legacy-only React integration test dependencies**

Add compatible dev dependencies for `@testing-library/react` and `@testing-library/user-event` to the legacy workspace. Add the Node 20-compatible `jsdom` environment where the root-installed Vitest binary can resolve it. Do not change runtime dependencies.

- [ ] **Step 2: Write the mounted failing interaction tests**

Mount AuthProvider, App, and the real AppShell route. Assert opening Account and clicking Logout calls exactly `/auth/logout` with method POST and credentials include; a 204 makes the protected route render Login and clears user-scoped storage; a pending request disables repeat clicks; failure retains the protected route and displays the safe message; unmount/stale restore produces no state update; login/account switching invalidates older completions and clears prior user-scoped state.

- [ ] **Step 3: Add Fetch-boundary regression assertions**

Pin HTTP 204 as `null`, credential inclusion, application-auth versus Google-reauth distinction, and a failed logout's standardized/network envelope.

- [ ] **Step 4: Run mounted and boundary tests and verify RED**

Run: `npm test -w @parametrics/web -- --run src/context/AuthContext.integration.test.jsx src/apiClient.test.js`

Expected: FAIL because logout state/feedback and duplicate-click protection are absent.

- [ ] **Step 5: Integrate deterministic operations and wire AppShell state**

Use Task 1's tracker in AuthProvider. Each login, logout, restore, and auth-expiry transition begins or invalidates a generation; async completions update state only while current and mounted. Logout failure retains the user and exposes `Logout failed. Please try again.`.

Read logout state from `useAuth()` in App and pass it with the existing callback. Disable the Logout button and label it `Logging out…` while pending. Render the safe error near the Account control with an accessible alert and clear it on retry.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npm test -w @parametrics/web -- --run src/context/AuthContext.integration.test.jsx src/apiClient.test.js`

Expected: PASS.

### Task 3: Regression verification and documentation

**Files:**
- Modify: canonical ParaMetrics Google Drive PRD
- Modify: `docs/superpowers/specs/2026-11-25-legacy-ui-auth-logout-design.md` only if verified implementation details differ

**Interfaces:**
- Consumes: Tasks 1 and 2 behavior and test evidence
- Produces: review-ready uncommitted legacy frontend patch and verified documentation

- [ ] **Step 1: Run the complete legacy frontend verification**

Run:

```text
npm test -w @parametrics/web -- --run
npm run lint -w @parametrics/web
npm run build -w @parametrics/web
git diff --check
```

Expected: all commands pass.

- [ ] **Step 2: Verify restricted scope**

Run: `git status --short && git diff --name-only`

Expected: implementation changes are limited to `apps/web`, `package-lock.json`, this task's spec/plan, and the external canonical PRD; no `apps/api` or `apps/client` changes.

- [ ] **Step 3: Perform browser verification when the local backend and a test account are available**

Verify login, protected route, Account > Logout, /login transition, refresh remains unauthenticated, and fresh login. If unavailable, record browser verification as pending and provide exact manual steps.

- [ ] **Step 4: Update the canonical Google Drive PRD**

Record the evidenced root cause, exact files, deterministic transition behavior, safe logout failure behavior, test counts, browser status, deployment note, and legacy-frontend-only rollback. Do not claim unexecuted browser results.

- [ ] **Step 5: Confirm branch invariants**

Run: `git branch --show-current && git rev-parse HEAD && git rev-parse feat/automatic-google-post-sync`

Expected: current branch remains `refactor/standardize-api-responses`, starting SHA remains `5ed7835b9c933e5501f263d3a6a823f3c3072e88`, and Phase 3 is unchanged.
