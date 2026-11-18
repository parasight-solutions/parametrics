# Google Post Image Publishing Design

## Intent

Fix Google Business Profile image-post publishing while preserving text-only publishing, multipart create behavior, scheduling, manual retry, edit restrictions, and local filesystem storage.

## Chosen approach

Use deterministic validation only: image URLs must be public HTTPS URLs; reject credentials, localhost and special-use hostnames, and loopback/private/link-local/reserved IP literals. Do not resolve DNS or fetch remote content. This avoids SSRF and DNS-dependent behavior while catching URLs that are unambiguously unusable by Google.

Build the Google Local Post payload through a pure helper so text-only and image payloads are directly testable. Image media contains both `mediaFormat: "PHOTO"` and the unchanged validated `sourceUrl`.

Validate the selected image source before inserting or queueing a post. Uploaded files are written first because the file remains authoritative; if their generated URL is private or non-HTTPS, delete that new file and reject creation with an actionable error. Scheduling follows the same validation because Google will eventually need to fetch the URL.

Classify provider failures in a pure worker helper. Google `400 INVALID_ARGUMENT` and confirmed media validation failures are permanent and become BullMQ `UnrecoverableError`; network failures, eligible rate limits, and Google 5xx errors remain ordinary errors so configured retry/backoff continues. The database records the actual attempt and final/retrying state.

## Non-goals

No cloud storage provider, DNS resolution, external-image download, live Google call in automated tests, PATCH image/CTA expansion, queue redesign, or unrelated refactoring.
