import test from "node:test";
import assert from "node:assert/strict";
import { createErrorHandler, safeLogText } from "./errorHandler.js";
import { createCorsOptions } from "./corsConfig.js";

function captureLogger() {
  const lines = [];
  return {
    lines,
    warn: (line) => lines.push(["warn", line]),
    error: (line) => lines.push(["error", line]),
  };
}

async function withPerimeterApp({ env, logger, now }, fn) {
  const { default: express } = await import("express");
  const { default: helmet } = await import("helmet");
  const { default: cors } = await import("cors");
  const app = express();
  app.use(helmet());
  app.use(cors(createCorsOptions(env)));
  app.use(express.json());
  app.get("/api/v1/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/v1/echo", (req, res) => res.json({ got: req.body }));
  app.get("/api/v1/boom", () => {
    throw new Error("secret-ish internal detail");
  });
  app.use(createErrorHandler({ logger, now }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const PROD = { NODE_ENV: "production", CORS_ORIGINS: "https://app.example.com" };

test("disallowed origin gets a controlled 403 with no CORS headers or stack (GET and preflight)", async () => {
  const logger = captureLogger();
  await withPerimeterApp({ env: PROD, logger }, async (base) => {
    const get = await fetch(`${base}/api/v1/health`, { headers: { Origin: "https://evil.example.com" } });
    assert.equal(get.status, 403);
    assert.equal(get.headers.get("access-control-allow-origin"), null);
    assert.equal(get.headers.get("x-content-type-options"), "nosniff");
    const body = await get.text();
    assert.deepEqual(JSON.parse(body), {
      error: { code: "cors_origin_not_allowed", message: "Origin not allowed" },
    });
    assert.ok(!/at .*\.js:\d+/.test(body), "no stack frames in the response");

    const preflight = await fetch(`${base}/api/v1/echo`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
  });
  assert.ok(logger.lines.every(([, line]) => !line.includes("\n")), "CORS rejections log one line, no stack");
});

test("allowed origin and no-Origin requests keep working", async () => {
  await withPerimeterApp({ env: PROD, logger: captureLogger() }, async (base) => {
    const preflight = await fetch(`${base}/api/v1/echo`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://app.example.com");
    assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");

    const allowed = await fetch(`${base}/api/v1/health`, { headers: { Origin: "https://app.example.com" } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.com");

    const noOrigin = await fetch(`${base}/api/v1/health`);
    assert.equal(noOrigin.status, 200);
    assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);
  });
});

test("CORS rejection logging is bounded, sanitised and throttled", async () => {
  const logger = captureLogger();
  let t = 0;
  await withPerimeterApp({ env: PROD, logger, now: () => t }, async (base) => {
    const evil = `https://evil.example.com/${"x".repeat(5000)}`;
    for (let i = 0; i < 5; i += 1) {
      await fetch(`${base}/api/v1/health`, { headers: { Origin: evil } });
    }
    t = 61_000;
    await fetch(`${base}/api/v1/health`, { headers: { Origin: "https://evil.example.com" } });
  });
  assert.equal(logger.lines.length, 2, "one line per interval");
  assert.ok(logger.lines[0][1].length < 400);
  assert.match(logger.lines[1][1], /suppressed_since_last=4/);
});

test("unexpected errors return JSON 500 without stack under any NODE_ENV", async () => {
  const logger = captureLogger();
  const env = { NODE_ENV: "staging", CORS_ORIGINS: "https://app.example.com" };
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "staging"; // finalhandler would print stacks here
  try {
    await withPerimeterApp({ env, logger }, async (base) => {
      const res = await fetch(`${base}/api/v1/boom?t=should-not-be-logged`);
      assert.equal(res.status, 500);
      const body = await res.text();
      assert.deepEqual(JSON.parse(body), {
        error: { code: "internal_error", message: "Internal server error" },
      });
      assert.ok(!body.includes("secret-ish"));
    });
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
  assert.equal(logger.lines.length, 1);
  assert.equal(logger.lines[0][0], "error");
  assert.ok(logger.lines[0][1].includes("/api/v1/boom"));
  assert.ok(!logger.lines[0][1].includes("should-not-be-logged"), "query strings are never logged");
});

test("client errors keep their 4xx status with a generic JSON body", async () => {
  await withPerimeterApp({ env: PROD, logger: captureLogger() }, async (base) => {
    const res = await fetch(`${base}/api/v1/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "bad_request");
  });
});

test("safeLogText strips control characters and truncates", () => {
  assert.equal(safeLogText("a\nb\u0000c"), "a?b?c");
  assert.equal(safeLogText("x".repeat(300)).length, 203);
});
