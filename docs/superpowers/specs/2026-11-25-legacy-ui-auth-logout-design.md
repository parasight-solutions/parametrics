# Legacy UI Authentication and Logout Design

## Intent

Correct the legacy frontend authentication lifecycle so its Account > Logout
action reliably calls the existing cookie-session logout endpoint, transitions
the application to the unauthenticated state only after the server confirms
logout, and cannot be undone by an older session-restoration response.

The legacy frontend remains a working reference application. The backend and
new frontend are already working and are explicitly outside this change.

## Goals

- Keep the existing Account menu and Logout action.
- Send the existing credentialed POST /api/v1/auth/logout request.
- Treat the existing bodyless HTTP 204 response as successful logout.
- Clear the legacy UI's authenticated user and user-scoped persisted state only
  after confirmed success.
- Make protected routes transition to /login.
- Prevent stale session restoration or login completion from overwriting a
  newer authentication transition.
- Preserve a usable authenticated state and show a safe retryable error when
  logout fails.
- Add a mounted legacy React test covering the actual Logout interaction and
  state transition.

## Non-goals

- No backend authentication, session, cookie, or API-response changes.
- No changes to apps/client.
- No UI redesign or confirmation dialog.
- No changes to Posts, Reviews, Locations, Organizations, Integrations,
  Reports, Google reauthentication, or authorization rules.
- No JavaScript-readable session token or local-storage authentication.

## Current behavior and diagnosed risks

- AppShell invokes the logout callback supplied by AuthProvider.
- api() already sends credentials: include and handles HTTP 204 without
  parsing a JSON envelope.
- AuthProvider.logout() currently clears user state and persisted UI state in
  finally, so a failed request is presented locally like a successful logout.
- Startup restoration and logout have no shared operation version. A session
  request started earlier can resolve after logout and restore its user.
- Route guards already redirect unauthenticated users to /login; no routing
  redesign is required.

## Approaches considered

### Selected: operation generation in the legacy AuthProvider

Maintain a monotonically increasing operation generation in a ref. Login,
logout, session restoration, and authentication-expiry transitions claim a new
generation. Async completions update state only when their captured generation
is still current.

Logout clears user and cached UI state only after api('/auth/logout')
successfully resolves. A failure leaves the current user intact, records a safe
error, and allows retry.

This is small, deterministic, and contained within the legacy frontend.

### Rejected: route-level flags

Adding separate loading/stale flags to every protected page duplicates auth
coordination across the application and makes future races harder to reason
about.

### Rejected: forced reload after every logout

Location navigation can mask state races and provides poor failure handling.
The existing React route guards are sufficient once auth state is deterministic.

## Component behavior

AuthProvider will expose logout progress and a safe logout error alongside the
existing auth values. AppShell will disable repeated Logout clicks while the
request is in flight and display the error without leaking response details.
Existing page props and navigation remain otherwise unchanged.

Successful login clears prior user-scoped persisted state before installing the
new user, preventing account-switch data retention. Successful logout clears
the same state and installs null as the current user.

## Testing

- Pure auth-transition tests will cover stale restore, stale login, successful
  logout, logout failure, retry, and account switching.
- A mounted React integration test will open the Account menu, click Logout,
  verify one credentialed logout request, receive HTTP 204, observe the
  unauthenticated route, and confirm user-scoped storage cleanup.
- Existing Fetch boundary tests will continue proving credentials and 204
  handling.
- The complete legacy suite, lint, production build, and git diff --check will
  be run.

Browser verification will be performed only if a suitable local backend and
test account are available; otherwise exact manual steps will be reported.

## Rollback

Restore the prior versions of the legacy frontend auth provider, AppShell, and
their tests, then rebuild and redeploy only the legacy frontend artifact. The
backend and new frontend are unchanged by this design.
