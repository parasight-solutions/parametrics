import test from "node:test";
import assert from "node:assert/strict";

import { createAuthRouter } from "./auth.js";

function routeHandler(router, path, method) {
  const layer = router.stack.find(
    (item) => item.route?.path === path && item.route?.methods?.[method],
  );
  return layer.route.stack.at(-1).handle;
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    cookies: [],
    cleared: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    cookie(...args) {
      this.cookies.push(args);
      return this;
    },
    clearCookie(...args) {
      this.cleared.push(args);
      return this;
    },
    send() {
      return this;
    },
  };
}

function createUsers(user) {
  return {
    async findOne() {
      return user;
    },
  };
}

test("login creates a cookie session and returns only the user", async () => {
  const user = {
    id: "user-1",
    email: "user@example.com",
    normalized_email: "user@example.com",
    password: "hash",
    role: "admin",
  };
  const router = createAuthRouter({
    getUsers: async () => createUsers(user),
    comparePassword: async () => true,
    createSession: async () => "raw-session",
    readSessionToken: () => "",
    revokeSession: async () => false,
    setSessionCookie: (res, token) => res.cookie("pm_session", token),
    auditSuccess: async () => {},
    auditFailure: async () => {},
    authenticate: (_req, _res, next) => next(),
  });
  const res = response();

  await routeHandler(router, "/login", "post")(
    { body: { email: user.email, password: "secret" }, headers: {} },
    res,
  );

  assert.deepEqual(res.cookies[0], ["pm_session", "raw-session"]);
  assert.deepEqual(res.body, {
    user: { id: "user-1", email: "user@example.com", role: "admin" },
  });
  assert.equal("token" in res.body, false);
});

test("session returns the authenticated user without exposing session data", async () => {
  const router = createAuthRouter({
    getUsers: async () => createUsers({
      id: "user-1",
      email: "user@example.com",
      role: "user",
      status: "active",
    }),
    authenticate: (_req, _res, next) => next(),
  });
  const res = response();

  await routeHandler(router, "/session", "get")(
    { user: { user_id: "user-1", role: "user" } },
    res,
  );

  assert.deepEqual(res.body, {
    user: { id: "user-1", email: "user@example.com", role: "user" },
  });
});

test("logout revokes when possible always clears the cookie and returns 204", async () => {
  const revoked = [];
  const router = createAuthRouter({
    readSessionToken: () => "raw-session",
    resolveSession: async () => ({ user_id: "user-1" }),
    revokeSession: async (token) => revoked.push(token),
    clearSessionCookie: (res) => res.clearCookie("pm_session"),
    auditSuccess: async () => {},
  });
  const res = response();

  await routeHandler(router, "/logout", "post")(
    { headers: {}, user: { user_id: "user-1", role: "user" } },
    res,
  );

  assert.deepEqual(revoked, ["raw-session"]);
  assert.deepEqual(res.cleared[0], ["pm_session"]);
  assert.equal(res.statusCode, 204);
});
