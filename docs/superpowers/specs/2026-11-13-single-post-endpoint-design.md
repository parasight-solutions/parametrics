# Single Post Endpoint Design

## Intent

Add an authenticated endpoint for loading one post into the edit form without weakening the ownership and organization/location rules already enforced by post mutations.

## API contract

- Route: `GET /api/v1/posts/:id`.
- Success: HTTP `200` with `{ "post": { ... } }`.
- Missing or inaccessible post: HTTP `404` using the existing safe API error shape.
- The returned post excludes MongoDB `_id`, includes the existing public post fields, and includes `location: { id, title }` consistently with the list/create responses.
- The endpoint is read-only and does not contact Google or mutate queue state.

## Access and scope

- Require the existing cookie-session authentication middleware.
- Initially locate the post by `id` and authenticated `user_id`.
- Validate its location with `requireOwnedOrganizationLocationAccess` using the existing post read roles: owner, admin, manager, and viewer.
- Validate the post's canonical organization/client/location scope with `assertDocMatchesLocationScope` before returning it.

## Approaches

- Return the raw post object: rejected because create and update already use a `{ post }` envelope.
- Return `{ post }` with route-local serialization: selected as the smallest consistent change.
- Refactor all list/create/get serialization into a shared mapper: deferred because it expands this endpoint task and risks changing existing response behavior.

## Scope boundaries

- Backend endpoint and backend tests only.
- No changes to `PostFormPage.jsx`; it must consume the result as `data.post` in a separate frontend change.
- No changes to editing fields, publishing behavior, uploads, authentication, or tenancy rules.
