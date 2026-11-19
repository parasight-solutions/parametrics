# Google Post Image Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish valid Google Business Profile image posts and stop retrying permanent provider validation failures.

**Architecture:** Pure helpers own public-image URL validation, Google payload construction, and provider retry classification. The create route validates the canonical selected image before persistence/queueing and cleans up rejected uploads; the worker converts permanent failures to BullMQ `UnrecoverableError`.

**Tech Stack:** Node.js 20+, Express, BullMQ 5, MongoDB, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-18-google-post-image-publishing-design.md`

## Global Constraints

- No S3, Cloudinary, remote image fetching, or DNS resolution.
- Preserve JSON and multipart create callers, file priority, scheduling, manual retry, and PATCH restrictions.
- Do not touch unrelated `uploads/` worktree changes.
- Do not commit, push, merge, or deploy.

## Review Focus

- IPv4 alternate notation and IPv6 mapped addresses must not bypass private-address rejection.
- Safe query strings must survive validation unchanged.
- A rejected uploaded file must be removed before any post insert or queue operation.
- A Google 429 or 5xx must remain retryable while 400 INVALID_ARGUMENT is permanent.
- Text-only payloads must contain no `media` property.

---

### Task 1: Public image URL validation

**Files:** Modify `apps/api/src/services/postImageStorage.js`; test `apps/api/src/services/postImageStorage.test.js`.

- [ ] Add failing tests for public HTTPS/query preservation and rejection of HTTP, credentials, localhost, special-use names, private IPv4, loopback/link-local/reserved IPv4, and private/loopback IPv6.
- [ ] Implement deterministic `validatePublicImageUrl(value)` and keep `validateExternalImageUrl` as a compatibility alias.
- [ ] Run the focused storage tests green.

### Task 2: Google payload and create-time rejection

**Files:** Create `apps/api/src/services/googlePostPayload.js` and test; modify `apps/api/src/routes/posts.js`; add route-helper tests where dependencies are injectable.

- [ ] Add failing tests for text-only payload, `mediaFormat: PHOTO`, unchanged public URL/query, file priority, scheduled creation, JSON compatibility, and cleanup before insert/queue on a private generated URL.
- [ ] Implement `buildGoogleLocalPostPayload(post)` and canonical image validation before persistence.
- [ ] Run focused payload/storage/create tests green.

### Task 3: Permanent provider failure classification

**Files:** Create `apps/api/src/services/postPublishFailure.js` and test; modify `apps/api/src/workers/postPublish.worker.js`.

- [ ] Add failing tests for permanent Google 400 INVALID_ARGUMENT/media validation and retryable network, 429, and 5xx failures.
- [ ] Implement `classifyPostPublishFailure(error)` and throw `UnrecoverableError` only for permanent failures after marking the first attempt final.
- [ ] Preserve ordinary errors for BullMQ retry/backoff and manual retry route behavior.
- [ ] Run focused worker helper tests green.

### Task 4: Configuration, regression, and verification

**Files:** Modify `docs/runtime/post-image-uploads.md`; add new tests to `apps/api/package.json` test command if appropriate.

- [ ] Document public HTTPS requirements and local uploaded-image limitation.
- [ ] Run focused tests, full API tests, client tests/lint/build, syntax checks, and `git diff --check`.
- [ ] Report live Google publishing as unverified unless credentials are explicitly available and used.
