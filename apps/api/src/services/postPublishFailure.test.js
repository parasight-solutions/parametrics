import test from "node:test";
import assert from "node:assert/strict";
import { buildPostPublishFailureDecision, classifyPostPublishFailure } from "./postPublishFailure.js";

test("Google 400 INVALID_ARGUMENT validation failures are permanent", () => {
  const result = classifyPostPublishFailure({
    status: 400,
    body: { error: { code: 400, status: "INVALID_ARGUMENT", message: "Request contains an invalid argument.", details: [{ errorDetails: [{ field: "media[0].source_url" }] }] } },
  });
  assert.deepEqual(result, { permanent: true, reason: "google_invalid_argument" });
});

test("local public-image validation failures are permanent", () => {
  assert.deepEqual(classifyPostPublishFailure({ code: "image_url_not_public" }), { permanent: true, reason: "invalid_image_url" });
  assert.deepEqual(classifyPostPublishFailure({ code: "image_url_must_be_public_https" }), { permanent: true, reason: "invalid_image_url" });
});

test("network, rate-limit, and Google server failures remain retryable", () => {
  assert.deepEqual(classifyPostPublishFailure(new Error("fetch failed")), { permanent: false, reason: "network_or_unknown" });
  assert.deepEqual(classifyPostPublishFailure({ status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } }), { permanent: false, reason: "google_rate_limit" });
  assert.deepEqual(classifyPostPublishFailure({ status: 503, body: { error: { status: "UNAVAILABLE" } } }), { permanent: false, reason: "google_server_error" });
});

test("failure decision ends permanent failures immediately and retryable failures only at max attempts", () => {
  assert.deepEqual(buildPostPublishFailureDecision({ error: { status: 400, body: { error: { status: "INVALID_ARGUMENT" } } }, attempt: 1, maxAttempts: 5 }), {
    permanent: true, final: true, reason: "google_invalid_argument",
  });
  assert.deepEqual(buildPostPublishFailureDecision({ error: { status: 503 }, attempt: 1, maxAttempts: 5 }), {
    permanent: false, final: false, reason: "google_server_error",
  });
  assert.deepEqual(buildPostPublishFailureDecision({ error: { status: 503 }, attempt: 5, maxAttempts: 5 }), {
    permanent: false, final: true, reason: "google_server_error",
  });
});
