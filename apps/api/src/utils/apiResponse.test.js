import assert from "node:assert/strict";
import test from "node:test";

import {
  buildError,
  buildSuccess,
  normalizeApiError,
  sendError,
  sendSuccess,
} from "./apiResponse.js";

test("buildSuccess returns the exact success contract and defaults", () => {
  assert.deepEqual(buildSuccess(), {
    statusCode: 200,
    data: null,
    message: "Operation completed successfully",
    success: true,
  });

  assert.deepEqual(
    buildSuccess({ statusCode: 201, data: { id: "post-1" }, message: "Post created" }),
    {
      statusCode: 201,
      data: { id: "post-1" },
      message: "Post created",
      success: true,
    },
  );
  assert.deepEqual(Object.keys(buildSuccess()).sort(), ["data", "message", "statusCode", "success"]);
});

test("buildSuccess rejects a nested standard envelope", () => {
  assert.throws(
    () => buildSuccess({ data: { statusCode: 200, data: {}, message: "nested", success: true } }),
    /nested API response envelope/i,
  );
});

test("buildSuccess redacts nested provider diagnostics from public data", () => {
  const body = buildSuccess({
    data: {
      errors: [{
        code: "provider_failed",
        message: "Google said token=secret",
        body: { access_token: "secret" },
      }],
      post: {
        provider_error_detail: {
          status: 400,
          body: { error: { message: "private provider response" } },
        },
      },
    },
  });

  assert.deepEqual(body.data.errors, [{
    code: "provider_failed",
    message: "Provider operation failed",
  }]);
  assert.deepEqual(body.data.post.provider_error_detail, {
    status: 400,
    message: "Provider operation failed",
  });
});

test("buildError returns exact keys and normalizes one or many errors", () => {
  assert.deepEqual(
    buildError({
      statusCode: 422,
      message: "Validation failed",
      errors: { code: "VALIDATION_ERROR", field: "locationId", message: "Location is required" },
    }),
    {
      statusCode: 422,
      message: "Validation failed",
      success: false,
      errors: [{ code: "VALIDATION_ERROR", field: "locationId", message: "Location is required" }],
    },
  );

  const body = buildError({
    statusCode: 400,
    errors: [
      { code: "bad_request", message: "First" },
      { code: "invalid", message: "Second" },
    ],
  });
  assert.equal(body.errors.length, 2);
  assert.deepEqual(Object.keys(body).sort(), ["errors", "message", "statusCode", "success"]);
});

test("normalizeApiError preserves application codes and safe client messages", () => {
  const error = Object.assign(new Error("Location is required"), {
    statusCode: 422,
    code: "VALIDATION_ERROR",
    field: "locationId",
  });

  assert.deepEqual(normalizeApiError(error), {
    statusCode: 422,
    message: "Location is required",
    errors: [{ code: "VALIDATION_ERROR", field: "locationId", message: "Location is required" }],
  });
});

test("normalizeApiError uses server_error and redacts unexpected internals", () => {
  const error = Object.assign(new Error("MongoServerError mongodb://user:secret@host"), {
    status: 500,
    data: { access_token: "token", providerBody: { secret: true } },
    stack: "secret stack",
  });

  assert.deepEqual(normalizeApiError(error), {
    statusCode: 500,
    message: "An unexpected error occurred",
    errors: [{ code: "server_error", message: "An unexpected error occurred" }],
  });
});

test("normalizeApiError does not expose arbitrary provider 4xx codes or messages", () => {
  assert.deepEqual(normalizeApiError({
    status: 403,
    code: "VENDOR_PRIVATE_CODE",
    message: "private tenant diagnostic",
  }), {
    statusCode: 403,
    message: "An unexpected error occurred",
    errors: [{
      code: "server_error",
      message: "An unexpected error occurred",
    }],
  });
});

test("normalizeApiError exposes only allowlisted Google reconnect details", () => {
  for (const reason of ["missing_refresh_token", "invalid_grant", "access_revoked", "permission_denied"]) {
    const normalized = normalizeApiError({
      status: 409,
      code: "reauth_required",
      message: "Reconnect Google",
      details: { provider: "google", reason, access_token: "secret" },
      data: { rawProviderBody: true },
    });
    assert.deepEqual(normalized.errors[0].details, { provider: "google", reason });
  }

  const rejected = normalizeApiError({
    status: 409,
    code: "reauth_required",
    message: "Reconnect Google",
    details: { provider: "google", reason: "unknown_reason" },
  });
  assert.equal("details" in rejected.errors[0], false);
});

test("normalizeApiError exposes only positive integer retry timing", () => {
  const accepted = normalizeApiError({
    status: 429,
    code: "rate_limited",
    message: "Too many requests",
    details: { retryAfterSeconds: 12, providerBody: "secret" },
  });
  assert.deepEqual(accepted.errors[0].details, { retryAfterSeconds: 12 });

  for (const retryAfterSeconds of [0, -1, 1.5, "12"]) {
    const rejected = normalizeApiError({
      status: 429,
      code: "rate_limited",
      message: "Too many requests",
      details: { retryAfterSeconds },
    });
    assert.equal("details" in rejected.errors[0], false);
  }
});

test("sendSuccess and sendError keep HTTP and body statuses identical", () => {
  const createResponse = () => ({
    statusValue: null,
    body: null,
    status(value) {
      this.statusValue = value;
      return this;
    },
    json(value) {
      this.body = value;
      return value;
    },
  });

  const successRes = createResponse();
  sendSuccess(successRes, { statusCode: 202, data: { queued: true }, message: "Queued" });
  assert.equal(successRes.statusValue, 202);
  assert.equal(successRes.body.statusCode, 202);

  const errorRes = createResponse();
  sendError(errorRes, {
    statusCode: 409,
    message: "Conflict",
    errors: [{ code: "conflict", message: "Conflict" }],
  });
  assert.equal(errorRes.statusValue, 409);
  assert.equal(errorRes.body.statusCode, 409);
});
