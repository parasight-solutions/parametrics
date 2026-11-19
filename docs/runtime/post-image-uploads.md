# Post image uploads

POST /api/v1/posts accepts JSON for compatibility and multipart/form-data for create-only image uploads. Multipart fields are locationId, summary, publishNow, scheduleAt, imageFile, imageUrl, and callToActionUrl. When both image sources are present, imageFile wins.

Production requires POST_UPLOAD_LOCAL_DIR on a persistent writable volume and APP_PUBLIC_API_BASE set to a public HTTPS API origin reachable by Google. POST_IMAGE_MAX_BYTES is optional and defaults to 5242880 bytes (5 MiB).

Local HTTP storage remains available for developing the upload form, but a post using a generated localhost, loopback, private-network, or non-HTTPS image URL is rejected before it is inserted or queued, and the newly uploaded file is deleted. Use an externally hosted public HTTPS image URL to test Google image publishing from a local application. Configuration validation cannot prove that Google can reach a deployed origin; deployment verification must fetch an uploaded URL from outside the private network without authentication.

Existing JSON requests remain valid. Rollback consists of reverting the post route/storage/server changes and the client form/service changes, then removing the new tests and this document. Existing uploaded files must be retained or migrated before rollback.
