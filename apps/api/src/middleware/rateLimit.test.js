import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRateLimitKey,
  checkRateLimit,
  createRateLimiter,
  getClientIdentity,
  resolveRateLimitConfig,
} from "./rateLimit.js";

test("resolveRateLimitConfig uses safe defaults", () => {
  const cfg = resolveRateLimitConfig({});
  assert.equal(cfg.windowSeconds, 600);
  assert.equal(cfg.limits.auth, 10);
  assert.equal(cfg.limits.oauth, 20);
  assert.equal(cfg.limits.upload, 30);
  assert.equal(cfg.limits.sync, 10);
  assert.equal(cfg.limits.generation, 20);
  assert.equal(cfg.limits.mutation, 120);
  assert.equal(cfg.limits.report_list, 120);
  assert.equal(cfg.limits.report_download, 60);
});

test("resolveRateLimitConfig honors env overrides", () => {
  const cfg = resolveRateLimitConfig({
    RATE_LIMIT_WINDOW_SECONDS: "60",
    RATE_LIMIT_AUTH_MAX: "3",
    RATE_LIMIT_REPORT_LIST_MAX: "7",
    RATE_LIMIT_REPORT_DOWNLOAD_MAX: "4",
  });
  assert.equal(cfg.windowSeconds, 60);
  assert.equal(cfg.limits.auth, 3);
  assert.equal(cfg.limits.report_list, 7);
  assert.equal(cfg.limits.report_download, 4);
});

test("createRateLimiter uses the report_list bucket and key", () => {
  const store = new Map();
  const limiter = createRateLimiter({
    action: "report_list",
    max: 1,
    windowSeconds: 60,
    store,
    now: () => 1000,
  });

  const req = { user: { user_id: "user_x" }, ip: "203.0.113.1", headers: {} };
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    set(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  let nextCount = 0;
  limiter(req, res, () => { nextCount += 1; });
  limiter(req, res, () => { nextCount += 1; });

  assert.equal(nextCount, 1);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error.code, "rate_limited");
  assert.equal(Array.from(store.keys())[0], "report_list:user:user_x");
});

test("createRateLimiter uses the report_download bucket and key", () => {
  const store = new Map();
  const limiter = createRateLimiter({
    action: "report_download",
    max: 1,
    windowSeconds: 60,
    store,
    now: () => 1000,
  });

  const req = { user: { user_id: "user_y" }, ip: "203.0.113.2", headers: {} };
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    set(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  let nextCount = 0;
  limiter(req, res, () => { nextCount += 1; });
  limiter(req, res, () => { nextCount += 1; });

  assert.equal(nextCount, 1);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error.code, "rate_limited");
  assert.equal(Array.from(store.keys())[0], "report_download:user:user_y");
});

test("keying prefers authenticated user id over IP", () => {
  const req = {
    user: { user_id: "user_1" },
    ip: "203.0.113.10",
    headers: {},
  };
  assert.equal(getClientIdentity(req), "user:user_1");
  assert.equal(buildRateLimitKey({ action: "sync", req }), "sync:user:user_1");
});

test("keying falls back to IP", () => {
  const req = {
    ip: "203.0.113.10",
    headers: {},
  };
  assert.equal(getClientIdentity(req), "ip:203.0.113.10");
  assert.equal(buildRateLimitKey({ action: "auth", req }), "auth:ip:203.0.113.10");
});

test("checkRateLimit returns retry_after_seconds when limited", () => {
  const store = new Map();
  const key = "auth:ip:203.0.113.10";
  const first = checkRateLimit({ key, max: 2, windowSeconds: 10, nowMs: 1000, store });
  const second = checkRateLimit({ key, max: 2, windowSeconds: 10, nowMs: 2000, store });
  const third = checkRateLimit({ key, max: 2, windowSeconds: 10, nowMs: 3000, store });

  assert.equal(first.limited, false);
  assert.equal(second.limited, false);
  assert.equal(third.limited, true);
  assert.equal(third.retryAfterSeconds, 8);
});

test("middleware returns consistent JSON 429", () => {
  const store = new Map();
  const limiter = createRateLimiter({
    action: "auth",
    max: 1,
    windowSeconds: 10,
    store,
    now: () => 1000,
  });

  const req = { ip: "203.0.113.10", headers: {} };
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    set(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  let nextCount = 0;
  limiter(req, res, () => { nextCount += 1; });
  limiter(req, res, () => { nextCount += 1; });

  assert.equal(nextCount, 1);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error.code, "rate_limited");
  assert.equal(res.body.error.retry_after_seconds, 10);
  assert.equal(res.headers["Retry-After"], "10");
});

