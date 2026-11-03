# Cookie Session Authentication Design

## Intent

Replace browser-stored bearer JWT authentication with one server-managed, cookie-based session contract shared by the API, existing `apps/web` frontend, and new `apps/client` frontend.

The existing frontend must remain operational as the behavioral reference while the new frontend adopts the same authentication semantics with cleaner React structure.

## Goals

- Keep authentication credentials out of JavaScript-readable storage.
- Make logout immediately invalidate the current server-side session.
- Restore authentication after browser refresh through the API.
- Use the same login, restore, logout, and request-authentication contract in both frontends.
- Remove bearer-token headers and JWT query-string handoffs from browser flows.
- Preserve current user roles and backend authorization behavior.

## Non-goals

- OAuth authorization-server functionality.
- Access-token and refresh-token pairs for third-party or mobile clients.
- “Log out all devices” UI in this phase.
- Persisting the authenticated user in local or session storage.
- Changing Google Business Profile provider-token storage.

## Selected approach

Use an opaque, server-managed session rather than separate browser access and refresh tokens.

Alternatives considered:

1. **Opaque server session — selected.** One random cookie maps to a hashed MongoDB session. It provides immediate revocation, straightforward restoration, and the least browser/authentication complexity.
2. **Access and rotating refresh-token cookies.** Valid, but requires token-family rotation, replay detection, concurrent-refresh coordination, and more failure states without providing a current product benefit.
3. **JWT in an HttpOnly cookie.** Removes JavaScript access but remains difficult to revoke immediately without adding server state, eliminating its main simplicity advantage.

## Session representation

The browser receives one opaque cookie. The raw token is generated with a cryptographically secure random source and is never stored in MongoDB.

MongoDB stores a session document similar to:

```js
{
  _id,
  token_hash,
  user_id,
  created_at,
  last_seen_at,
  expires_at,
  revoked_at
}
```

`token_hash` uses SHA-256 over a high-entropy random token. A unique index covers `token_hash`; a TTL index covers `expires_at`. Session lookup also rejects revoked and expired records and loads the current user from `users`, so deleted/disabled users cannot be restored from stale cookie data.

The initial absolute session lifetime will be seven days to preserve the current JWT lifetime. The expiry is not silently extended by ordinary requests in this phase. A later “remember me” design may introduce different lifetimes explicitly.

## Cookie policy

Cookie name:

- Production: `__Host-pm_session`
- Local development: `pm_session`

Attributes:

```text
HttpOnly
SameSite=Lax
Path=/
Secure=true in production
Secure=false for local HTTP development
No Domain attribute
```

The cookie remains host-only to the API host. The old and new frontend subdomains send it to the API through credentialed requests but cannot read it or receive it on their own hosts.

The API retains an explicit CORS origin allowlist with credentials enabled. Unsafe cookie-authenticated requests (`POST`, `PUT`, `PATCH`, `DELETE`) validate the `Origin` header against the same allowlist. This is important because sibling subdomains are same-site even though they are different origins.

## Backend API contract

### `POST /api/v1/auth/login`

- Rate-limit and validate credentials as today.
- Revoke the current cookie session if one exists.
- Create a new server session.
- Set the HttpOnly session cookie.
- Return `{ user: { id, email, role } }`; do not return an access token.

### `GET /api/v1/auth/session`

- Resolve the cookie session.
- Return `{ user: { id, email, role } }` when valid.
- Return `401 { error: { code: "unauthorized" } }` when missing, expired, revoked, or attached to a missing/disabled user.
- Clear an invalid cookie where appropriate.

This is the restore-session operation; the route describes the resource rather than the UI action.

### `POST /api/v1/auth/logout`

- Resolve and revoke the current session when present.
- Always clear the session cookie.
- Record an audit event when a valid session/user can be identified.
- Return `204`, making logout idempotent even for an already-expired session.

## Authentication middleware

The existing `authenticate` middleware changes from bearer-JWT verification to session-cookie verification and continues populating:

```js
req.user = { user_id, role }
```

This preserves downstream route authorization contracts. Query-string token fallback is removed from application authentication. The temporary signed state used internally for Google integration callbacks remains a separate short-lived mechanism and is not accepted as an application session.

Cookie parsing will be implemented with a small explicit parser or `cookie-parser`; the implementation plan will choose one consistent API-wide mechanism. Session creation, resolution, revocation, and cookie options live in a dedicated auth-session service rather than route handlers.

## Google authentication changes

The Google sign-in callback will:

- Resolve or create the local user as today.
- Create the same opaque application session.
- Set the same HttpOnly cookie.
- Redirect to a clean frontend login/callback destination without `gjwt` or any credential in the URL.

Google Business Profile connection remains distinct from application login. Its provider access/refresh tokens stay encrypted/server-side as they are now. The integration start route authenticates through the application session cookie instead of bearer/query tokens.

## Existing frontend migration (`apps/web`)

- Replace token-based `isAuthed()` with asynchronous session restoration.
- Introduce a small auth provider/hook or equivalent centralized state so routes wait for initialization.
- Password login consumes only `data.user`.
- Google login no longer reads `gjwt` from the query string.
- API calls use `credentials: "include"` and stop setting `Authorization`.
- Direct fetch/report helpers migrate to credentialed cookies.
- Logout calls `/auth/logout`, then clears frontend user-scoped UI/location state and auth state even if the request fails.
- Organization-member “current user” hints read the restored user rather than decoding a JWT.
- Existing provider reauthorization behavior remains separate from application-session expiry.

## New frontend migration (`apps/client`)

`AuthContext` holds only:

```js
{
  user,
  authLoading,
  isAuthenticated,
  login,
  logout,
  restoreSession
}
```

On provider mount, `authLoading` starts true and `GET /auth/session` runs. Route guards render a loading state until it resolves; success sets the user and failure sets the guest state.

Axios retains `withCredentials: true`, removes the bearer request interceptor, and treats authenticated-request `401` responses as session expiry without recursively expiring login/session-check requests.

Login stores only the returned user in Context. Logout calls the API and clears Context in `finally`.

## Browser storage after migration

Authentication stores neither user nor credential in `localStorage` or `sessionStorage`.

Allowed non-authentication state remains:

```text
sessionStorage: pm_google_reauth
localStorage:   pm_active_location_id
```

Active location is cleared on logout. On login/session restoration, it is validated against locations the restored user can access rather than relying on a persisted authentication identity marker.

## Failure behavior

- Missing/expired/revoked cookie: API returns `401`; frontends become guests.
- Login rejection: display credential error without triggering global session-expiry handling.
- Restore-session rejection: normal guest initialization, not a visible error alert.
- Logout network failure: frontend still clears in-memory auth state; server session expires naturally or can be revoked on the next successful logout/login.
- Database/session lookup failure: return `500`, not `401`, so infrastructure failures are not misrepresented as user logout.

## Testing and migration

- Add backend tests for cookie attributes, hashed token storage, valid restore, expired/revoked restore, logout revocation, idempotent logout, origin validation, and middleware compatibility.
- Add old-frontend tests for credentialed requests, restoration, protected routes, and logout cleanup.
- Update new-frontend tests for asynchronous restoration and removal of token storage/headers.
- Update OpenAPI documentation.
- Remove legacy browser token keys during frontend initialization once, so users with old builds do not retain obsolete credentials.
- Deploy backend and both frontends as one coordinated contract change; the old bearer-token contract is intentionally not retained.

## Configuration

Add explicit configuration for:

- Allowed old/new frontend origins.
- Production cookie security mode.
- Seven-day session lifetime.
- Frontend redirect destination for Google login.

Production startup must fail for unsafe cookie/origin configuration rather than silently falling back to localhost values.
