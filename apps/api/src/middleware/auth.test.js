import test from "node:test";
import assert from "node:assert/strict";

import { createAuthenticate } from "./auth.js";

function createResponse() {
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

test("authenticate restores the existing req.user contract from a session cookie", async () => {
  const authenticate = createAuthenticate({
    readToken: () => "raw-session",
    resolve: async () => ({ user_id: "user-1" }),
    findUser: async () => ({ id: "user-1", role: "admin", status: "active" }),
  });
  const req = { headers: { cookie: "pm_session=raw-session" } };
  const res = createResponse();
  let called = false;

  await authenticate(req, res, () => {
    called = true;
  });

  assert.equal(called, true);
  assert.deepEqual(req.user, { user_id: "user-1", role: "admin" });
});

test("authenticate returns 401 for missing invalid and disabled sessions", async () => {
  for (const setup of [
    { token: "", session: null, user: null },
    { token: "raw", session: null, user: null },
    {
      token: "raw",
      session: { user_id: "user-1" },
      user: { id: "user-1", status: "disabled" },
    },
  ]) {
    const authenticate = createAuthenticate({
      readToken: () => setup.token,
      resolve: async () => setup.session,
      findUser: async () => setup.user,
    });
    const res = createResponse();

    await authenticate({ headers: {} }, res, () => assert.fail("next called"));

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, "unauthorized");
  }
});

test("authenticate returns 500 when session storage fails", async () => {
  const authenticate = createAuthenticate({
    readToken: () => "raw",
    resolve: async () => {
      throw new Error("database unavailable");
    },
    findUser: async () => null,
  });
  const res = createResponse();

  await authenticate({ headers: {} }, res, () => assert.fail("next called"));

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, "server_error");
});
