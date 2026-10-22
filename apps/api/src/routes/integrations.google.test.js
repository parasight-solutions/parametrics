import test from "node:test";
import assert from "node:assert/strict";

// google.store.js -> lib/crypto.js requires an encryption key at import time.
// Test-only throwaway value; nothing is encrypted or persisted here.
process.env.APP_ENC_KEY ||= "s2-33-test-only-encryption-key-not-a-secret";
const { default: router } = await import("./integrations.google.js");
const { authenticate } = await import("../middleware/auth.js");
const { oauthRateLimit } = await import("../middleware/rateLimit.js");

function routeLayer(method, path) {
  return router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
}

async function withApp(fn) {
  const { default: express } = await import("express");
  const app = express();
  app.use("/api/v1/integrations/google", router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}/api/v1/integrations/google`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("POST /connect/start requires Bearer auth before the rate limiter keys on the user", () => {
  const layer = routeLayer("post", "/connect/start");
  assert.ok(layer, "POST /connect/start is registered");
  const handles = layer.route.stack.map((l) => l.handle);
  assert.equal(handles[0], authenticate);
  assert.equal(handles[1], oauthRateLimit);
});

test("GET /connect/go and /callback are rate limited", () => {
  for (const path of ["/connect/go", "/callback"]) {
    const layer = routeLayer("get", path);
    assert.ok(layer, `${path} is registered`);
    assert.ok(layer.route.stack.some((l) => l.handle === oauthRateLimit));
  }
});

test("legacy GET /start?t=<jwt> is retired with 410 and never redirects to Google", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/start?t=eyJhbGciOiJIUzI1NiJ9.e30.sig`, { redirect: "manual" });
    assert.equal(res.status, 410);
    assert.equal(res.headers.get("location"), null);
    assert.equal((await res.json()).error.code, "connect_start_moved");
  });
});

test("POST /connect/start without a Bearer token is 401, and ?t= does not help", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/connect/start?t=eyJhbGciOiJIUzI1NiJ9.e30.sig`, { method: "POST" });
    assert.equal(res.status, 401);
  });
});
