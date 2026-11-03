# Cookie Session Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser bearer-JWT authentication with revocable, opaque HttpOnly cookie sessions across the API, existing web frontend, and new client frontend.

**Architecture:** A dedicated API session service creates, hashes, resolves, and revokes opaque tokens stored in MongoDB. Authentication middleware preserves the existing `req.user = { user_id, role }` contract while sourcing it from the session cookie. Both frontends restore users through `/auth/session`, send credentials automatically, and keep authenticated users only in React memory.

**Tech Stack:** Node.js 20, Express 4, MongoDB 5, React 19, React Router, Axios, Vitest, Node test runner

**Spec:** `docs/superpowers/specs/2026-11-03-cookie-session-auth-design.md`

## Global Constraints

- Preserve downstream API authorization behavior and the `req.user` shape.
- Preserve Google Business Profile provider-token storage and reauthorization behavior.
- Do not retain bearer/query-token application authentication compatibility.
- Store no application access token or authenticated user in browser storage.
- Use a seven-day absolute server-session lifetime with hashed opaque tokens.
- Use host-only, HttpOnly, SameSite=Lax cookies; Secure only outside local development.
- Do not modify reusable new-client UI components or `useApi`.
- Preserve unrelated working-tree changes.

## Review Focus

- Database failures must return `500`, while missing/revoked/expired sessions return `401`.
- Login and restore `401` responses must not create recursive global-expiry behavior in either frontend.
- Cookie clearing must use the same name/path/security policy as cookie creation.
- Google sign-in and Google Business Profile connection must remain distinct flows.
- Unsafe cookie-authenticated requests from disallowed origins must be rejected without blocking server-to-server/no-Origin requests.

---

### Task 1: Server session service and persistence

**Files:**
- Create: `apps/api/src/services/authSessions.js`
- Create: `apps/api/src/services/authSessions.test.js`
- Modify: `apps/api/src/startup/ensureIndexes.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `createSession(userId)`, `resolveSession(rawToken)`, `revokeSession(rawToken)`, `hashSessionToken(rawToken)`, `setSessionCookie(res, rawToken)`, `clearSessionCookie(res)`, `readSessionToken(req)`, and `SESSION_TTL_MS`.

- [ ] Write failing service tests for random token creation, hashed-only persistence, valid resolution, expired/revoked rejection, idempotent revocation, and environment-specific cookie attributes.
- [ ] Run the focused Node tests and confirm failures are caused by the missing service.
- [ ] Implement the minimal session service using `crypto.randomBytes`, SHA-256, and the existing Mongo helper.
- [ ] Add unique `token_hash` and TTL `expires_at` indexes through startup index creation.
- [ ] Run focused and full API tests.

### Task 2: Backend routes, middleware, origin protection, and Google login

**Files:**
- Modify: `apps/api/src/routes/auth.js`
- Modify: `apps/api/src/routes/auth.google.js`
- Modify: `apps/api/src/middleware/auth.js`
- Create: `apps/api/src/middleware/auth.test.js`
- Create: `apps/api/src/middleware/validateRequestOrigin.js`
- Create: `apps/api/src/middleware/validateRequestOrigin.test.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/docs/openapi.js`

**Interfaces:**
- Consumes: Task 1 session-service functions.
- Produces: cookie-based `POST /auth/login`, `GET /auth/session`, `POST /auth/logout`, cookie-based `authenticate`, and unsafe-request origin validation.

- [ ] Write failing middleware/route-level tests for cookie authentication, preserved `req.user`, invalid session `401`, infrastructure `500`, allowed/disallowed origins, login cookie response, restore response, and idempotent logout.
- [ ] Run focused tests and verify expected failures.
- [ ] Migrate `authenticate` and add error distinction without changing downstream route contracts.
- [ ] Add login/session/logout route behavior and audit calls.
- [ ] Apply origin validation to unsafe API methods using the existing CORS origin policy.
- [ ] Change Google sign-in callback to create a cookie session and clean redirect; change application-authenticated Google integration entry points to cookie auth.
- [ ] Update OpenAPI documentation and run focused/full API tests.

### Task 3: Existing web frontend migration

**Files:**
- Modify: `apps/web/src/session.js`
- Modify: `apps/web/src/session.test.js`
- Modify: `apps/web/src/apiClient.js`
- Modify: `apps/web/src/apiClient.test.js`
- Create: `apps/web/src/context/AuthContext.jsx`
- Create: `apps/web/src/context/useAuth.js`
- Modify: `apps/web/src/main.jsx`
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/pages/Login.jsx`
- Modify: `apps/web/src/pages/OrganizationMembers.jsx`
- Modify: `apps/web/src/lib/reportHistory.js`
- Modify: `apps/web/src/lib/reportHistory.test.js`
- Modify: direct token consumers found by repository search.

**Interfaces:**
- Consumes: Task 2 cookie API contract.
- Produces: asynchronous old-web session restoration, in-memory authenticated user, credentialed fetches, and API-backed logout.

- [ ] Rewrite failing session/API tests to require no auth token storage/header and require credentialed requests plus legacy-key cleanup.
- [ ] Add failing tests for restore initialization and logout-finally cleanup at extractable state/service boundaries.
- [ ] Replace old session helpers with UI/location cleanup only and one-time legacy token/user/identity removal.
- [ ] Add the old-web auth provider and make route guards wait for session initialization.
- [ ] Migrate login, Google callback behavior, fetch/report helpers, and current-user hints away from JWT access.
- [ ] Run web tests, lint, and production build.

### Task 4: New client frontend migration

**Files:**
- Modify: `apps/client/src/context/auth/AuthContext.jsx`
- Modify: `apps/client/src/context/auth/authState.js`
- Modify: `apps/client/src/context/auth/authState.test.js`
- Modify: `apps/client/src/session.js`
- Modify: `apps/client/src/session.test.js`
- Modify: `apps/client/src/services/api.service.js`
- Modify: `apps/client/src/services/auth.service.js`
- Modify: `apps/client/src/services/authFailure.js`
- Modify: `apps/client/src/services/authFailure.test.js`
- Modify: `apps/client/src/pages/authentication/Login.jsx`
- Modify: `apps/client/src/App.jsx`
- Modify: `apps/client/src/pages/private/Dashboard.jsx`

**Interfaces:**
- Consumes: Task 2 cookie API contract.
- Produces: memory-only client auth with `authLoading`, `restoreSession`, login, and API-backed logout.

- [ ] Write failing tests for memory-only initial state, legacy auth-key removal, restore success/guest/error states, and non-recursive `401` classification.
- [ ] Run focused tests and verify expected failures.
- [ ] Reduce browser session utilities to legacy cleanup, Google reauth, and active-location preferences.
- [ ] Remove bearer request injection, add session/login/logout service calls, and implement asynchronous Context restoration.
- [ ] Update route guards, login, and logout consumers to the user-only contract.
- [ ] Run client tests, lint, and production build.
- [ ] Run the full API, web, and client verification suites and review the complete migration diff against the design.
