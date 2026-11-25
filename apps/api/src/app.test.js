import assert from "node:assert/strict";
import test, { after } from "node:test";

import { createApp } from "./app.js";
import { connection } from "./lib/queues.js";

after(() => connection.disconnect());

async function withServer(app, run) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("createApp serves the canonical health envelope", async () => {
  await withServer(createApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.message, "API is healthy");
    assert.equal(body.data.ok, true);
    assert.equal(typeof body.data.ts, "string");
    assert.deepEqual(Object.keys(body).sort(), ["data", "message", "statusCode", "success"]);
  });
});

test("createApp returns canonical API-only 404 and leaves non-API fallback unchanged", async () => {
  await withServer(createApp(), async (baseUrl) => {
    const apiResponse = await fetch(`${baseUrl}/api/v1/missing`);
    assert.equal(apiResponse.status, 404);
    assert.deepEqual(await apiResponse.json(), {
      statusCode: 404,
      message: "API route not found",
      success: false,
      errors: [{ code: "not_found", message: "API route not found" }],
    });

    const nonApiResponse = await fetch(`${baseUrl}/missing`);
    assert.equal(nonApiResponse.status, 404);
    assert.match(nonApiResponse.headers.get("content-type"), /text\/html/);
  });
});

test("createApp converts unexpected API errors to a safe envelope", async () => {
  const app = createApp({
    configureApiRoutes(api) {
      api.get("/api/v1/test-unexpected", () => {
        const error = new Error("MongoServerError mongodb://user:secret@host");
        error.data = { access_token: "secret" };
        throw error;
      });
    },
    logger: { error() {} },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/test-unexpected`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, {
      statusCode: 500,
      message: "An unexpected error occurred",
      success: false,
      errors: [{ code: "server_error", message: "An unexpected error occurred" }],
    });
    assert.doesNotMatch(JSON.stringify(body), /Mongo|secret|mongodb/i);
  });
});

test("createApp preserves parser 400/413 statuses in canonical envelopes", async () => {
  await withServer(createApp(), async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).statusCode, 400);

    const oversized = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(1_100_000) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).statusCode, 413);
  });
});

test("createApp forwards rejected async handlers to the canonical error handler", async () => {
  const app = createApp({
    configureApiRoutes(api) {
      api.get("/api/v1/test-async-error", async () => {
        throw new Error("database unavailable");
      });
    },
    logger: { error() {} },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/test-async-error`);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).errors[0].code, "server_error");
  });
});

test("logout remains a bodyless 204 response", async () => {
  await withServer(createApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: "POST" });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  });
});
