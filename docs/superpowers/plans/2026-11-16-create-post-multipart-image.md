# Create Post Multipart Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create posts in one request with an uploaded image, external image URL, or no image while preserving JSON callers and edit/publishing behavior.

**Architecture:** The client owns file/URL mutual exclusion and submits create requests as `FormData`. The API parses only create-post multipart bodies into memory, completes authorization before durable persistence, and delegates content validation, safe local storage, URL generation, cleanup, and production configuration checks to one reusable service.

**Tech Stack:** React 19, React Hook Form, Axios, Vitest, Express 4, Multer 2, Node 20 test runner, MongoDB.

**Spec:** `docs/superpowers/specs/2026-11-16-create-post-multipart-image-design.md`

## Global Constraints

- Do not change the edit form or `PATCH /posts/:id` image/CTA contract.
- Preserve JSON compatibility for the legacy frontend and other callers.
- Keep cookie authentication, location/organization authorization, Google checks, scheduling, queueing, and `image_url` publishing unchanged.
- JPEG, PNG, and WebP are the only accepted uploaded formats; validate bytes, not client metadata.
- Default maximum upload size is 5 MiB and is configurable.
- Production requires durable `POST_UPLOAD_LOCAL_DIR` and public `APP_PUBLIC_API_BASE` configuration.
- Do not commit or push changes.

## Review Focus

- Multipart `publishNow="false"` must remain false rather than becoming truthy; Task 3 tests both boolean strings.
- An invalid external URL accompanying a valid file must not defeat mandatory file priority; Task 3 tests file-first resolution.
- A queue/audit failure after file persistence must remove only that request's new file; Task 3 tests injected post-write failure cleanup.
- A filename/MIME claiming PNG with non-PNG bytes must be rejected; Task 2 tests mismatched metadata and magic bytes.
- Production must not silently serve from a checkout or temporary directory; Task 2 tests missing, relative, in-repo, and temporary roots.

---

### Task 1: Client image selection and multipart request

**Files:**
- Create: `apps/client/src/pages/private/postImageForm.js`
- Create: `apps/client/src/pages/private/postImageForm.test.js`
- Modify: `apps/client/src/pages/private/PostFormPage.jsx`
- Modify: `apps/client/src/services/posts.service.js`
- Create: `apps/client/src/services/posts.service.test.js`

**Interfaces:**
- Produces: `selectImageFileState({ file })`, `enterImageUrlState({ value })`, and `buildCreatePostFormData(payload)` for deterministic selection and request construction.
- Consumes: existing React Hook Form setters/watchers and the shared Axios instance.

- [ ] **Step 1: Write failing helper tests** for file-clears-URL, URL-clears-file/input token, file replacement, cleared URL not restoring a file, scalar string conversion, omission of absent image fields, and file priority in `FormData`.
- [ ] **Step 2: Run `npm test -w client -- postImageForm.test.js posts.service.test.js`** and verify the new modules/exports fail.
- [ ] **Step 3: Implement the pure selection helpers and `buildCreatePostFormData(payload)`**, with `imageFile` winning over `imageUrl` and null/undefined scalar fields omitted.
- [ ] **Step 4: Update `addPost`** to submit the constructed `FormData` with a request transform/header override that removes the Axios instance's JSON content-type without manually supplying a multipart boundary.
- [ ] **Step 5: Update `PostFormPage` create mode** with a native file input, synchronized ref/state/RHF URL clearing, replaceable file state, preview, and object-URL revocation; leave edit-only visibility rules unchanged.
- [ ] **Step 6: Re-run the focused client tests** and expect all new tests to pass.

### Task 2: Secure reusable post-image storage

**Files:**
- Create: `apps/api/src/services/postImageStorage.js`
- Create: `apps/api/src/services/postImageStorage.test.js`
- Modify: `apps/api/src/routes/uploads.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `detectImageType(buffer)`, `validateExternalImageUrl(value)`, `createPostImageStorage(config)`, `createImageUploadMiddleware(config)`, and `validatePostImageStorageConfig({ env, cwd, fsImpl })`.
- Storage adapter methods: `writeValidatedImage(file) -> { filename, url }` and `deleteImage(filename) -> Promise<void>`.

- [ ] **Step 1: Write failing service tests** for JPEG/PNG/WebP signatures, spoofed/unsupported content, default/configured size limits, UUID-safe names, URL validation, path containment, deletion, and production configuration rejection/acceptance.
- [ ] **Step 2: Run the new Node test directly** and verify failures identify the missing service.
- [ ] **Step 3: Implement byte detection, URL validation, memory-upload configuration, safe writes/deletes, and startup validation** using Node built-ins plus existing Multer; do not add an image-processing dependency.
- [ ] **Step 4: Refactor `/api/v1/uploads`** to authenticate before parsing and reuse the shared service while keeping `{ url, filename }`; translate Multer/service errors to sanitized envelopes.
- [ ] **Step 5: Point `/uploads` static serving at the validated root and invoke startup validation before listening**, logging only a redacted safe-root label.
- [ ] **Step 6: Add the new service test to the API test script** and run it to green.

### Task 3: Multipart-compatible create-post orchestration

**Files:**
- Modify: `apps/api/src/routes/posts.js`
- Create: `apps/api/src/routes/posts.create.test.js`
- Test: `apps/api/src/services/postDetails.test.js`

**Interfaces:**
- Consumes: `createImageUploadMiddleware`, `validateExternalImageUrl`, and the storage adapter from Task 2.
- Produces: create-post routing that accepts JSON or multipart and resolves exactly one canonical `image_url`.

- [ ] **Step 1: Add failing route tests with injected dependencies** covering file URL persistence, external URL persistence, null image, file priority (including invalid accompanying URL), JSON compatibility, multipart boolean/date normalization, unauthorized/location-denied requests causing zero writes, post-write insert/queue failure cleanup, scheduling/queueing preservation, and PATCH ignoring image/CTA mutations.
- [ ] **Step 2: Run the focused route test** and verify it fails against the current create route.
- [ ] **Step 3: Add the upload middleware only to POST `/` after authentication/rate limiting**, normalize multipart scalar strings without changing JSON aliases, and map Multer failures to stable 400/413 envelopes.
- [ ] **Step 4: Resolve the image after authorization/provider checks**, writing a valid uploaded file first or validating the external URL otherwise; assign the resulting URL/null to `doc.image_url`.
- [ ] **Step 5: Track only the newly written filename and delete it on every subsequent thrown failure**, without touching pre-existing files or changing the publisher/queue contract.
- [ ] **Step 6: Run focused API tests** and expect all create, edit, post-detail, and image-storage tests to pass.

### Task 4: Documentation and full verification

**Files:**
- Modify: `apps/api/.env.example` if present
- Modify: root `.env.example` if present
- Create: `docs/runtime/post-image-uploads.md`

**Interfaces:**
- Documents: `POST_UPLOAD_LOCAL_DIR`, `POST_IMAGE_MAX_BYTES`, `APP_PUBLIC_API_BASE`, persistent-volume ownership/backup requirements, multipart/JSON examples, and rollback.

- [ ] **Step 1: Document deployment configuration and API examples**, explicitly stating that production storage must be persistent and publicly reachable by Google.
- [ ] **Step 2: Run `npm test -w @parametrics/api`** and record totals/failures.
- [ ] **Step 3: Run `npm test -w client`** and record totals/failures.
- [ ] **Step 4: Run `npm run lint -w client` and `npm run build -w client`** and record exact results.
- [ ] **Step 5: Inspect `git diff --check`, `git status --short`, and the final diff** for accidental edit-contract, legacy-client, worker, queue, auth/session, or unrelated changes.
- [ ] **Step 6: Deliver changed-file, API-contract, verification, compatibility, configuration/risk, and exact rollback summaries** without committing or pushing.
