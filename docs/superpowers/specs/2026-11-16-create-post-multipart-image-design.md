# Create Post Multipart Image Design

## Goal

Allow the new client to create a post in one request with either an uploaded JPEG, PNG, or WebP file, an external HTTP/HTTPS image URL, or no image. Preserve existing JSON callers, edit restrictions, scheduling, queueing, and the Google publisher's `image_url` contract.

## Client design

The create-only portion of `PostFormPage` will expose a native file input beside the existing Image URL input. React Hook Form remains the source of submitted scalar values, while component state holds the selected `File` and a ref controls the native input value. Selecting a file clears `imageUrl`; entering a non-empty URL clears both selected-file state and the native input. A derived preview uses an object URL for files and the entered URL otherwise, revoking each temporary object URL when it is replaced or the component unmounts.

`postsEndpoints.addPost` will build `FormData` from the create payload. Scalar values are appended as strings, null/undefined values are omitted, and `imageFile` is appended only when selected. The request will remove the Axios instance's JSON content-type for this call and allow the browser to generate the multipart boundary. PATCH remains JSON and unchanged.

## API and storage design

Only `POST /api/v1/posts` gains a Multer `memoryStorage` parser for the `imageFile` field. Authentication and rate limiting execute before multipart parsing. The parsed file is kept in memory while normal request validation, location authorization, Google integration validation, and provider-account access checks run, so unauthorized content is never persisted.

A focused post-image storage service will:

- recognize JPEG, PNG, and WebP from magic bytes rather than trusting the filename or client MIME type;
- enforce `POST_IMAGE_MAX_BYTES`, defaulting to 5 MiB, through Multer and service validation;
- validate external URLs as absolute `http:` or `https:` URLs without fetching them;
- generate a UUID filename with an extension determined from validated bytes;
- write only beneath the resolved upload root and return an `APP_PUBLIC_API_BASE/uploads/<filename>` URL;
- delete a newly written file when post creation, queueing, or auditing fails;
- validate production configuration before the API starts.

`POST_UPLOAD_LOCAL_DIR` selects the storage root. Development and test may fall back to `<cwd>/uploads` for compatibility. Outside development/test, the variable is required, must be an absolute writable directory outside the repository, and must not be a known temporary/system root. `APP_PUBLIC_API_BASE` is required outside development/test and must be an absolute HTTP/HTTPS origin. Express static serving will use the same resolved root.

The file is persisted only after all authorization/provider checks succeed. If both sources are present, the validated uploaded file wins. If there is no file, a valid external URL is used; otherwise `image_url` is `null`. Existing JSON request aliases remain supported. Multipart boolean normalization explicitly handles the strings `"true"` and `"false"` so publish/schedule behavior matches JSON.

The existing standalone `/uploads` route will reuse the same validation and storage service rather than retaining its unsafe disk-storage implementation. Its public response shape remains compatible. It remains outside the create-post UI flow.

## Failure behavior

Malformed file content, unsupported image types, invalid URLs, extra multipart files/fields, and oversized uploads return sanitized 400-series error envelopes. Multer errors are translated without exposing paths or bytes. Files are not written before authentication and location authorization. Once written, a file is removed if any subsequent create operation fails; pre-existing uploads are never deleted.

## Compatibility

The legacy web application continues sending JSON to `POST /posts`. `PATCH /posts/:id` is untouched, so image and CTA fields remain immutable during edit and published/publishing protections remain intact. MongoDB continues storing the canonical value in `image_url`; the publishing worker continues building `payload.media = [{ sourceUrl: post.image_url }]` without changes.

## Verification

Pure client helpers will cover mutual-exclusion transitions and FormData construction. Backend service and route-level dependency-injected tests will cover content detection, limits, URL validation, storage naming, production configuration, file priority, JSON compatibility, text-only posts, authorization-before-write, cleanup, and unchanged edit behavior. The client test/build/lint and API test suite will be run, with any pre-existing or unrelated failures reported exactly.
