import test from "node:test";
import assert from "node:assert/strict";

async function withEnv(env, fn) {
  const original = { ...process.env };
  process.env = { ...original, ...env };
  for (const key of ["NODE_ENV", "CORS_ORIGINS"]) {
    if (!(key in env)) delete process.env[key];
  }

  try {
    await fn();
  } finally {
    process.env = original;
  }
}

async function loadFreshModule() {
  return import(`./corsConfig.js?t=${Date.now()}-${Math.random()}`);
}

function callOrigin(corsOptions, origin) {
  return new Promise((resolve) => {
    corsOptions.origin(origin, (err, allowed) => {
      resolve({ err, allowed });
    });
  });
}

test("production requires CORS_ORIGINS", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    const { createCorsOptions } = await loadFreshModule();
    assert.throws(
      () => createCorsOptions(),
      /CORS_ORIGINS is required when NODE_ENV=production/
    );
  });
});

test("production rejects wildcard CORS_ORIGINS", async () => {
  await withEnv(
    { NODE_ENV: "production", CORS_ORIGINS: "*" },
    async () => {
      const { createCorsOptions } = await loadFreshModule();
      assert.throws(
        () => createCorsOptions(),
        /CORS_ORIGINS must not include wildcard origins/
      );
    }
  );
});

test("development allows localhost origins", async () => {
  await withEnv({ NODE_ENV: "development" }, async () => {
    const { createCorsOptions } = await loadFreshModule();
    const corsOptions = createCorsOptions();
    const out = await callOrigin(corsOptions, "http://localhost:5173");

    assert.equal(out.err, null);
    assert.equal(out.allowed, "http://localhost:5173");
  });
});

test("production allows configured origin", async () => {
  await withEnv(
    { NODE_ENV: "production", CORS_ORIGINS: "https://app.example.com" },
    async () => {
      const { createCorsOptions } = await loadFreshModule();
      const corsOptions = createCorsOptions();
      const out = await callOrigin(corsOptions, "https://app.example.com");

      assert.equal(out.err, null);
      assert.equal(out.allowed, "https://app.example.com");
    }
  );
});

test("production rejects unknown origin", async () => {
  await withEnv(
    { NODE_ENV: "production", CORS_ORIGINS: "https://app.example.com" },
    async () => {
      const { createCorsOptions } = await loadFreshModule();
      const corsOptions = createCorsOptions();
      const out = await callOrigin(corsOptions, "https://evil.example.com");

      assert.match(out.err?.message || "", /CORS origin not allowed/);
      assert.equal(out.allowed, false);
    }
  );
});

test("requests without Origin remain allowed to continue", async () => {
  await withEnv(
    { NODE_ENV: "production", CORS_ORIGINS: "https://app.example.com" },
    async () => {
      const { createCorsOptions } = await loadFreshModule();
      const corsOptions = createCorsOptions();
      const out = await callOrigin(corsOptions, undefined);

      assert.equal(out.err, null);
      assert.equal(out.allowed, false);
    }
  );
});
