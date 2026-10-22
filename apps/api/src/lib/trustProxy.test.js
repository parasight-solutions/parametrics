import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrustProxy, describeTrustProxy } from "./trustProxy.js";
import { createRateLimiter, getClientIdentity } from "../middleware/rateLimit.js";

test("resolveTrustProxy defaults to off", () => {
  assert.equal(resolveTrustProxy({}), false);
  assert.equal(resolveTrustProxy({ TRUST_PROXY: "" }), false);
  assert.equal(resolveTrustProxy({ TRUST_PROXY: "false" }), false);
  assert.equal(resolveTrustProxy({ TRUST_PROXY: "0" }), false);
});

test("resolveTrustProxy refuses trust-everything values", () => {
  assert.throws(() => resolveTrustProxy({ TRUST_PROXY: "true" }), /TRUST_PROXY=true/);
  assert.throws(() => resolveTrustProxy({ TRUST_PROXY: "TRUE" }), /TRUST_PROXY=true/);
  assert.throws(() => resolveTrustProxy({ TRUST_PROXY: "11" }), /between 1 and 10/);
  assert.throws(() => resolveTrustProxy({ TRUST_PROXY: "anything" }), /comma list/);
  assert.throws(() => resolveTrustProxy({ TRUST_PROXY: "10.0.0.0/99" }), /comma list/);
});

test("resolveTrustProxy accepts hop counts and address lists", () => {
  assert.equal(resolveTrustProxy({ TRUST_PROXY: "1" }), 1);
  assert.equal(resolveTrustProxy({ TRUST_PROXY: "loopback" }), "loopback");
  assert.equal(
    resolveTrustProxy({ TRUST_PROXY: "loopback, 10.0.0.0/8 ,fd00::/8" }),
    "loopback,10.0.0.0/8,fd00::/8"
  );
  assert.equal(describeTrustProxy(false), "off");
  assert.equal(describeTrustProxy(2), "hops:2");
  assert.equal(describeTrustProxy("loopback,10.0.0.1"), "list:2");
});

test("getClientIdentity ignores raw X-Forwarded-For", () => {
  const req = { ip: "203.0.113.10", headers: { "x-forwarded-for": "198.51.100.99" } };
  assert.equal(getClientIdentity(req), "ip:203.0.113.10");
});

async function withLimitedApp(trustProxy, max, fn) {
  const { default: express } = await import("express");
  const store = new Map();
  const app = express();
  app.set("trust proxy", trustProxy);
  app.post(
    "/login",
    createRateLimiter({ action: "auth", max, windowSeconds: 600, store }),
    (req, res) => res.json({ ip: req.ip })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    const post = (xff) =>
      fetch(`http://127.0.0.1:${port}/login`, {
        method: "POST",
        headers: xff ? { "X-Forwarded-For": xff } : {},
      });
    await fn({ post, store });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("without trust proxy, rotating spoofed X-Forwarded-For cannot escape the login limit", async () => {
  await withLimitedApp(false, 2, async ({ post, store }) => {
    const a = await post("198.51.100.1");
    const b = await post("198.51.100.2");
    const c = await post("198.51.100.3");
    assert.equal(a.status, 200);
    assert.equal((await a.json()).ip, "127.0.0.1");
    assert.equal(b.status, 200);
    assert.equal(c.status, 429);
    assert.ok(Number(c.headers.get("retry-after")) >= 1);
    const body = await c.json();
    assert.equal(body.error.code, "rate_limited");
    assert.ok(body.error.retry_after_seconds >= 1);
    assert.deepEqual([...store.keys()], ["auth:ip:127.0.0.1"]);
  });
});

test("with one trusted proxy hop, the proxy-appended client address is used", async () => {
  await withLimitedApp(1, 5, async ({ post, store }) => {
    // Client spoofs 1.1.1.1; the trusted proxy appends the real client address.
    const res = await post("1.1.1.1, 198.51.100.7");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ip, "198.51.100.7");
    assert.deepEqual([...store.keys()], ["auth:ip:198.51.100.7"]);
  });
});

test("an untrusted peer cannot inject a client address even when a proxy list is configured", async () => {
  // Only 10.9.9.9 is trusted; the test client connects from 127.0.0.1.
  await withLimitedApp("10.9.9.9", 5, async ({ post }) => {
    const res = await post("198.51.100.8");
    assert.equal((await res.json()).ip, "127.0.0.1");
  });
});
