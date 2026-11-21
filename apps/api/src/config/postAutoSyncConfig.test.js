import test from "node:test";
import assert from "node:assert/strict";
import { resolvePostAutoSyncConfig } from "./postAutoSyncConfig.js";

test("auto-sync configuration is disabled and runs every 120 minutes by default", () => {
  assert.deepEqual(resolvePostAutoSyncConfig({}), {
    enabled: false,
    intervalMinutes: 120,
    concurrency: 1,
    maxAttempts: 3,
    leaseMs: 120_000,
    heartbeatMs: 40_000,
  });
});

test("auto-sync configuration accepts bounded explicit values", () => {
  const config = resolvePostAutoSyncConfig({
    POST_AUTO_SYNC_ENABLED: "true",
    POST_AUTO_SYNC_INTERVAL_MINUTES: "240",
    POST_AUTO_SYNC_CONCURRENCY: "3",
    POST_AUTO_SYNC_MAX_ATTEMPTS: "5",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.intervalMinutes, 240);
  assert.equal(config.concurrency, 3);
  assert.equal(config.maxAttempts, 5);
  assert.ok(config.heartbeatMs < config.leaseMs);
});

test("auto-sync configuration rejects ambiguous or unsafe values", () => {
  for (const env of [
    { POST_AUTO_SYNC_ENABLED: "yes" },
    { POST_AUTO_SYNC_INTERVAL_MINUTES: "14" },
    { POST_AUTO_SYNC_INTERVAL_MINUTES: "1441" },
    { POST_AUTO_SYNC_CONCURRENCY: "0" },
    { POST_AUTO_SYNC_MAX_ATTEMPTS: "11" },
  ]) {
    assert.throws(
      () => resolvePostAutoSyncConfig(env),
      (error) => error.code === "invalid_post_auto_sync_config",
    );
  }
});
