# Single Post Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, tenancy-safe `GET /api/v1/posts/:id` endpoint returning `{ post }`.

**Architecture:** Keep the Express route thin and place its read/access/serialization behavior in a dependency-injected `getPostDetailsForUser` service so it can be tested without starting Redis-backed queue objects. The service reads by authenticated user and post ID, validates canonical location access and scope, and returns a sanitized post with location display data.

**Tech Stack:** Node.js, Express, MongoDB, Node test runner

**Spec:** `docs/superpowers/specs/2026-11-13-single-post-endpoint-design.md`

## Global Constraints

- Return `{ post }` and never expose MongoDB `_id`.
- Preserve existing read roles: owner, admin, manager, viewer.
- Do not contact Google or mutate queues.
- Backend and backend tests only; do not modify `apps/client`.
- Do not alter create, edit, publish, upload, auth, or tenancy behavior.

## Review Focus

- A post owned by another user must look missing rather than leak its existence.
- A stale post whose canonical organization/client/location scope differs from its location must be rejected.
- A viewer with valid location access can read but does not gain mutation rights.
- Optional post fields must serialize as the same null/default values used by the list response.
- Empty or unknown IDs return the existing safe `404 not_found` response.

---

### Task 1: Single-post read service and route

**Files:**
- Create: `apps/api/src/services/postDetails.js`
- Create: `apps/api/src/services/postDetails.test.js`
- Modify: `apps/api/src/routes/posts.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `getPostDetailsForUser({ userId, postId }, { posts, requireLocationAccess, assertScope }) -> Promise<object>`.
- Produces: `GET /api/v1/posts/:id -> { post }`.

- [ ] Write failing service tests for sanitized success output, foreign/missing post `404`, allowed read roles, and canonical scope validation.
- [ ] Run `node --test src/services/postDetails.test.js` and confirm failure because the service is absent.
- [ ] Implement the minimal dependency-injected service and serializer.
- [ ] Register `router.get('/:id', authenticate, ...)` after `/provider` and before mutations so static GET routes retain precedence.
- [ ] Add the test file to the API test command.
- [ ] Run focused tests, syntax checks, and the complete API suite; report unrelated baseline failures separately.
