import test from "node:test";
import assert from "node:assert/strict";
import { mapPostSyncError, runPostSync } from "./postSyncRunner.js";

const now = new Date("2026-11-20T12:00:00.000Z");
const location = {
  id: "location-1",
  user_id: "owner-1",
  organization_id: "org-1",
  client_id: "client-1",
  integration_id: "integration-1",
  provider_account_name: "accounts/1",
  provider_location_name: "locations/1",
};
const summary = {
  fetched: 1, inserted: 1, updated: 0, unchanged: 0,
  missingOnGoogle: 0, tombstoneSkipped: 0, conflicts: 0,
};

test("shared runner claims, fences transactional sync, and completes owned metadata", async () => {
  const events = [];
  const session = { id: "session-1" };
  const result = await runPostSync({
    location,
    integration: { id: "integration-1" },
    operationId: "operation-1",
    operationKind: "automatic",
    now,
  }, {
    locations: {},
    config: { leaseMs: 120_000, heartbeatMs: 40_000, intervalMinutes: 120 },
    claimLease: async () => {
      events.push("claim");
      return { location, fence: 7 };
    },
    renewLease: async () => true,
    startHeartbeat: () => ({ stop: () => events.push("stop"), lost: Promise.resolve(false) }),
    withTransaction: async (work) => {
      events.push("transaction");
      return work(session);
    },
    assertLease: async (_locations, args) => {
      assert.equal(args.session, session);
      assert.equal(args.fence, 7);
      events.push("assert");
    },
    syncGooglePosts: async (_input, deps) => {
      await deps.withTransaction(async (activeSession) => deps.assertOwnership(activeSession));
      events.push("sync");
      return { summary };
    },
    syncDependencies: {},
    completeLease: async (_locations, args) => {
      assert.equal(args.operationKind, "automatic");
      assert.ok(args.nextAutoSyncAt > new Date("2026-11-20T14:00:00.000Z"));
      events.push("complete");
    },
    releaseLease: async () => events.push("release"),
    clock: () => new Date("2026-11-20T12:05:00.000Z"),
  });
  assert.deepEqual(events, ["claim", "transaction", "assert", "sync", "complete", "stop"]);
  assert.equal(result.summary.inserted, 1);
});

test("shared runner conditionally releases its lease when synchronization fails", async () => {
  const events = [];
  await assert.rejects(runPostSync({
    location,
    integration: { id: "integration-1" },
    operationId: "operation-1",
    operationKind: "manual",
    now,
  }, {
    locations: {},
    config: { leaseMs: 120_000, heartbeatMs: 40_000, intervalMinutes: 120 },
    claimLease: async () => ({ location, fence: 3 }),
    startHeartbeat: () => ({ stop: () => events.push("stop"), lost: Promise.resolve(false) }),
    syncGooglePosts: async () => { throw Object.assign(new Error("rate"), { status: 429 }); },
    syncDependencies: {},
    releaseLease: async (_locations, args) => {
      assert.equal(args.fence, 3);
      events.push("release");
    },
  }), (error) => error.code === "google_post_sync_rate_limited");
  assert.deepEqual(events, ["release", "stop"]);
});

test("provider errors map to bounded actionable sync codes without raw bodies", () => {
  for (const [status, code] of [
    [401, "google_post_sync_auth_failed"],
    [403, "google_post_sync_auth_failed"],
    [429, "google_post_sync_rate_limited"],
    [503, "google_post_sync_unavailable"],
  ]) {
    const mapped = mapPostSyncError(Object.assign(new Error("provider"), { status, body: { token: "secret" } }));
    assert.equal(mapped.code, code);
    assert.equal(mapped.body, undefined);
  }
});
