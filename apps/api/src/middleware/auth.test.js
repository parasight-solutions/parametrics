import test from "node:test";
import assert from "node:assert/strict";
import { authenticate } from "./auth.js";
import { signJwt } from "../lib/jwt.js";

const TEST_JWT_SECRET = "s2-33-auth-middleware-test-secret-0123456789abcdef";

function run(req) {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  try {
    let status = 200;
    let body = null;
    let nextCalled = false;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };
    const fullReq = { headers: {}, query: {}, ...req };
    authenticate(fullReq, res, () => {
      nextCalled = true;
    });
    return { status, body, nextCalled, user: fullReq.user };
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
}

function sign(payload) {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  try {
    return signJwt(payload);
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
}

test("Bearer app JWT authenticates", () => {
  const req = { headers: { authorization: `Bearer ${sign({ user_id: "user_a", role: "admin" })}` } };
  const out = run(req);
  assert.equal(out.nextCalled, true);
  assert.deepEqual(out.user, { user_id: "user_a", role: "admin" });
});

test("a valid app JWT in the ?t= query string is no longer accepted", () => {
  const out = run({ query: { t: sign({ user_id: "user_a" }) } });
  assert.equal(out.nextCalled, false);
  assert.equal(out.status, 401);
  assert.equal(out.body.error.code, "unauthorized");
});

test("signed tokens without user_id (e.g. OAuth state) are not app sessions", () => {
  for (const payload of [{ uid: "user_a", ru: "http://x/callback" }, { r: "/" }]) {
    const out = run({ headers: { authorization: `Bearer ${sign(payload)}` } });
    assert.equal(out.nextCalled, false);
    assert.equal(out.status, 401);
  }
});

test("missing or invalid bearer tokens are rejected", () => {
  assert.equal(run({}).status, 401);
  assert.equal(run({ headers: { authorization: "Bearer not-a-jwt" } }).status, 401);
});
