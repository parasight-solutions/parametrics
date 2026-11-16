# Post image uploads

POST /api/v1/posts accepts JSON for compatibility and multipart/form-data for create-only image uploads. Multipart fields are locationId, summary, publishNow, scheduleAt, imageFile, imageUrl, and callToActionUrl. When both image sources are present, imageFile wins.

Production requires POST_UPLOAD_LOCAL_DIR on a persistent writable volume and APP_PUBLIC_API_BASE set to the public HTTP/HTTPS API origin reachable by Google. POST_IMAGE_MAX_BYTES is optional and defaults to 5242880 bytes (5 MiB).

Existing JSON requests remain valid. Rollback consists of reverting the post route/storage/server changes and the client form/service changes, then removing the new tests and this document. Existing uploaded files must be retained or migrated before rollback.
