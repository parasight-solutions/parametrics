import assert from "node:assert/strict";
import test from "node:test";

import { toApiError } from "./ownership.js";

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("toApiError preserves application status code and safe message without arbitrary data", () => {
  const res = response();
  const error = Object.assign(new Error("resource does not match location scope"), {
    status: 409,
    code: "scope_mismatch",
    data: { expected_location_id: "secret-scope", providerBody: { token: "secret" } },
  });

  toApiError(res, error);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    statusCode: 409,
    message: "resource does not match location scope",
    success: false,
    errors: [{ code: "scope_mismatch", message: "resource does not match location scope" }],
  });
});

test("toApiError redacts unexpected server exception messages", () => {
  const res = response();
  toApiError(res, new Error("MongoServerError mongodb://user:secret@host"));

  assert.deepEqual(res.body, {
    statusCode: 500,
    message: "An unexpected error occurred",
    success: false,
    errors: [{ code: "server_error", message: "An unexpected error occurred" }],
  });
});
