# Client Authentication Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver working password login, session restoration, protected routing, bearer authentication, client-side logout, and expired-session handling in `apps/client`.

**Architecture:** A small storage module owns the approved browser keys, `AuthContext` owns live auth state, nested route guards control navigation, and Axios communicates authentication expiry through a browser event. Login uses the existing `useApi` hook and reusable form components unchanged.

**Tech Stack:** React 19, React Router 7, Axios, React Hook Form, Vitest

**Spec:** `docs/superpowers/specs/2026-11-03-client-auth-flow-design.md`

## Global Constraints

- Do not modify `apps/client/src/components/ui/*` or `apps/client/src/hooks/useApi.js`.
- Persist only the five keys named in the spec; add no caches.
- Do not implement backend logout or Google OAuth UI in this change.
- Use test-first development for new session and authentication behavior.

## Review Focus

- Malformed or expired JWTs must never restore an authenticated session.
- A changed user identity must clear the previous active location.
- A failed login must show the backend error and must not alter the current session.
- Only genuine application-authentication `401` responses should expire the session.
- Redirects after login must remain internal and return users to their requested route.

---

### Task 1: Session persistence

**Files:**
- Modify: `apps/client/src/session.js`
- Create: `apps/client/src/session.test.js`
- Modify: `apps/client/package.json`

**Interfaces:**
- Produces: `getToken`, `getStoredUser`, `saveSession`, `clearSession`, `isTokenExpired`, Google reauth helpers, and active-location helpers.

- [ ] Write failing tests for the approved storage locations, identity-change cleanup, full logout cleanup, malformed users, and expired tokens.
- [ ] Run the focused test and confirm the failures are caused by missing behavior.
- [ ] Implement the minimal session module behavior.
- [ ] Run the focused test and full client test command.

### Task 2: Auth context and API expiry bridge

**Files:**
- Modify: `apps/client/src/context/auth/AuthContext.jsx`
- Modify: `apps/client/src/context/auth/useAuth.js`
- Modify: `apps/client/src/services/api.service.js`
- Modify: `apps/client/src/services/auth.service.js`
- Create: `apps/client/src/context/auth/authState.js`
- Create: `apps/client/src/context/auth/authState.test.js`

**Interfaces:**
- Consumes: Task 1 session functions.
- Produces: initialized auth state, `isAuthenticated`, `login`, `logout`, and the `pm:auth-expired` event contract.

- [ ] Write failing tests for restoring valid sessions and rejecting incomplete/expired sessions.
- [ ] Run the focused tests and verify expected failure.
- [ ] Implement the pure initial-state helper and connect it to `AuthProvider`.
- [ ] Add Axios response handling for recognized application-authentication `401` errors.
- [ ] Run focused and full client tests.

### Task 3: Routing and login integration

**Files:**
- Modify: `apps/client/src/App.jsx`
- Modify: `apps/client/src/main.jsx`
- Modify: `apps/client/src/pages/authentication/Login.jsx`
- Modify: `apps/client/src/pages/private/Dashboard.jsx`

**Interfaces:**
- Consumes: `AuthProvider`, `useAuth`, `authEndpoints.login`, and `useApi`.
- Produces: `/login` guest route, `/` private dashboard route, requested-route restoration, and dashboard logout control.

- [ ] Add guest/private route guards using nested `Outlet` routes.
- [ ] Implement the email/password form with existing form components and `useApi` loading.
- [ ] Save the successful login response through Context and safely navigate to the requested internal route.
- [ ] Add client-side logout from Dashboard.
- [ ] Run lint, tests, and production build.

