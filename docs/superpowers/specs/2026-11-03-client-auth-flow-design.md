# Client Authentication Flow Design

## Intent

Complete the new `apps/client` password-authentication flow using the groundwork already present, while keeping persistence and routing intentionally simple.

## Goals

- Log in through the existing `POST /auth/login` endpoint and navigate to the dashboard.
- Restore a valid session after refresh and reject an expired or malformed token.
- Protect private routes and keep authenticated users out of guest routes.
- Add the bearer token to API requests and clear the client session after an application-authentication `401`.
- Provide client-side logout now; backend token revocation is a separate follow-up.

## Persistence

Only these keys are allowed:

- `sessionStorage`: `pm_access_token`, `pm_auth_user`, `pm_google_reauth`
- `localStorage`: `pm_auth_identity`, `pm_active_location_id`

No API response cache or dashboard-range persistence will be added. When the authenticated identity changes, only the active location is cleared. Logout clears all five keys.

## Constraints

- Do not modify reusable UI components under `src/components/ui`.
- Do not modify `src/hooks/useApi.js`.
- Use `useApi` for the login request and its loading state.
- Keep the existing backend logout endpoint out of this implementation.
- Keep Google OAuth UI out of this implementation; retain simple storage helpers for future Google reauthorization flow.

## Approach

Use the existing Context architecture as the single React auth source. A small framework-independent session module owns the five storage keys. Nested React Router guards own guest/private navigation, while the Axios service attaches tokens and emits a browser auth-expired event on genuine application-authentication `401` responses. `AuthProvider` listens for that event and clears its state.

This preserves simple dependency direction: storage does not import React, Axios does not import React Context, and routing reads Context through `useAuth`.

