import test from "node:test";
import assert from "node:assert/strict";

import {
  getAuditContextFromReq,
  sanitizeAuditMetadata,
} from "./auditLog.js";

test("sanitizeAuditMetadata redacts secret-like fields recursively", () => {
  const out = sanitizeAuditMetadata({
    email: "USER@example.com",
    password: "nope",
    nested: {
      access_token: "token",
      refreshToken: "refresh",
      ok: "kept",
    },
  });

  assert.equal(out.email, "USER@example.com");
  assert.equal(out.password, "[redacted]");
  assert.equal(out.nested.access_token, "[redacted]");
  assert.equal(out.nested.refreshToken, "[redacted]");
  assert.equal(out.nested.ok, "kept");
});

test("sanitizeAuditMetadata limits strings, arrays, keys, and depth", () => {
  const out = sanitizeAuditMetadata({
    long: "x".repeat(700),
    list: Array.from({ length: 30 }, (_, i) => i),
    deep: { a: { b: { c: "hidden" } } },
    many: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i])),
  });

  assert.equal(out.long.length, 500);
  assert.equal(out.list.length, 20);
  assert.equal(out.deep.a.b, "[truncated]");
  assert.equal(Object.keys(out.many).length, 30);
});

test("getAuditContextFromReq prefers forwarded ip and authenticated actor", () => {
  const out = getAuditContextFromReq({
    user: { user_id: "user_1", role: "admin" },
    headers: {
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      "user-agent": "test-agent",
    },
    ip: "127.0.0.1",
  });

  assert.deepEqual(out, {
    actor_user_id: "user_1",
    actor_role: "admin",
    ip: "203.0.113.9",
    user_agent: "test-agent",
  });
});
