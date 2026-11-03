import test from "node:test";
import assert from "node:assert/strict";

import { createValidateRequestOrigin } from "./validateRequestOrigin.js";

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("origin validation allows safe methods allowed origins and requests without Origin", () => {
  const middleware = createValidateRequestOrigin({
    isAllowedOrigin: (origin) => origin === "https://app.example.com",
  });

  for (const req of [
    { method: "GET", headers: { origin: "https://evil.example.com" } },
    { method: "POST", headers: { origin: "https://app.example.com" } },
    { method: "POST", headers: {} },
  ]) {
    let called = false;
    middleware(req, response(), () => {
      called = true;
    });
    assert.equal(called, true);
  }
});

test("origin validation rejects an unsafe request from a disallowed origin", () => {
  const middleware = createValidateRequestOrigin({
    isAllowedOrigin: () => false,
  });
  const res = response();

  middleware(
    { method: "DELETE", headers: { origin: "https://evil.example.com" } },
    res,
    () => assert.fail("next called"),
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, "origin_forbidden");
});
