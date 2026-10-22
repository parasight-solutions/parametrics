import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isDebugRoutesEnabled, debugReason } from "./debugRoutes.js";
import { signJwt } from "./jwt.js";

// google.store.js -> lib/crypto.js requires an encryption key at import time.
// Test-only throwaway value; nothing is encrypted or persisted here.
process.env.APP_ENC_KEY ||= "s2-33-test-only-encryption-key-not-a-secret";
const { default: debugRoutes, CLEAR_CONFIRMATION } = await import("../routes/debug.js");
const { default: debugGoogle } = await import("../routes/debug.google.js");

const TEST_JWT_SECRET = "s2-33-debug-routes-test-secret-0123456789abcdef";

async function withEnv(env, fn) {
  const original = { ...process.env };
  for (const key of ["NODE_ENV", "ENABLE_DEBUG_ROUTES", "JWT_SECRET"]) delete process.env[key];
  Object.assign(process.env, env);
  try {
    await fn();
  } finally {
    process.env = original;
  }
}

async function withDebugApp(fn) {
  const { default: express } = await import("express");
  const app = express();
  app.use(express.json());
  // Mounted unconditionally here to prove the request-time guard.
  app.use("/api/v1/debug", debugRoutes);
  app.use("/api/v1/debug", debugGoogle);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}/api/v1/debug`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("debug routes require a local NODE_ENV and an explicit opt-in flag", () => {
  assert.equal(isDebugRoutesEnabled({}), false);
  assert.equal(isDebugRoutesEnabled({ NODE_ENV: "development" }), false);
  assert.equal(isDebugRoutesEnabled({ ENABLE_DEBUG_ROUTES: "true" }), false);
  assert.equal(isDebugRoutesEnabled({ NODE_ENV: "production", ENABLE_DEBUG_ROUTES: "true" }), false);
  assert.equal(isDebugRoutesEnabled({ NODE_ENV: "staging", ENABLE_DEBUG_ROUTES: "true" }), false);
  assert.equal(isDebugRoutesEnabled({ NODE_ENV: "development", ENABLE_DEBUG_ROUTES: "1" }), false);
  assert.equal(isDebugRoutesEnabled({ NODE_ENV: "development", ENABLE_DEBUG_ROUTES: "true" }), true);
  assert.equal(isDebugRoutesEnabled({ NODE_ENV: "test", ENABLE_DEBUG_ROUTES: "TRUE" }), true);
});

test("production requests never reach debug handlers, even with the flag set", async () => {
  await withEnv({ NODE_ENV: "production", ENABLE_DEBUG_ROUTES: "true", JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = signJwt({ user_id: "user_debug" });
    await withDebugApp(async (base) => {
      for (const [method, path] of [
        ["GET", "/google/status"],
        ["GET", "/google/access"],
        ["POST", "/google/clear"],
      ]) {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: method === "POST" ? JSON.stringify({ confirm: CLEAR_CONFIRMATION }) : undefined,
        });
        assert.equal(res.status, 404, `${method} ${path} must fall through to 404`);
      }
    });
  });
});

test("enabled debug routes still require authentication", async () => {
  await withEnv({ NODE_ENV: "development", ENABLE_DEBUG_ROUTES: "true" }, async () => {
    await withDebugApp(async (base) => {
      assert.equal((await fetch(`${base}/google/status`)).status, 401);
      assert.equal((await fetch(`${base}/google/clear`, { method: "POST" })).status, 401);
    });
  });
});

test("destructive clear requires explicit confirmation and a user id", async () => {
  await withEnv({ NODE_ENV: "development", ENABLE_DEBUG_ROUTES: "true", JWT_SECRET: TEST_JWT_SECRET }, async () => {
    await withDebugApp(async (base) => {
      const userToken = signJwt({ user_id: "user_debug" });
      const noConfirm = await fetch(`${base}/google/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(noConfirm.status, 400);
      assert.equal((await noConfirm.json()).reason, "confirmation_required");

      // A signed token without user_id (e.g. an OAuth state JWT) must not
      // turn into a { user_id: null } delete filter.
      const noUser = await fetch(`${base}/google/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${signJwt({ r: "/" })}`, "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: CLEAR_CONFIRMATION }),
      });
      assert.equal(noUser.status, 401);
    });
  });
});

test("debug responses no longer expose token material or provider error bodies", async () => {
  const debugSrc = await readFile(new URL("../routes/debug.js", import.meta.url), "utf8");
  const googleSrc = await readFile(new URL("../routes/debug.google.js", import.meta.url), "utf8");
  for (const src of [debugSrc, googleSrc]) {
    assert.ok(!src.includes("token_prefix"));
    assert.ok(!src.includes("token_length"));
    assert.ok(!/body:\s*e\.body/.test(src));
    assert.ok(!/message:\s*e\.message/.test(src));
    assert.ok(!src.includes("req.user.id"), "user id field is user_id");
  }
  assert.equal(debugReason({ code: "no_integration" }), "no_integration");
  assert.equal(debugReason({ code: "Bearer abc.def" }), "error");
  assert.equal(debugReason(new Error("token ya29.leak")), "error");
});
