import test from "node:test";
import assert from "node:assert/strict";
import { buildPostSyncWorkerOptions, runAutoPostSyncJob } from "./autoPostSync.js";

const location = {
  id: "loc-1", user_id: "owner-1", organization_id: "org-1", client_id: "client-1",
  provider: "google", status: "active", integration_id: "int-1",
  provider_account_name: "accounts/1", provider_location_name: "locations/1",
  post_sync: { auto_enabled: true, enqueue_claim_id: "claim-1" },
};

function deps(overrides = {}) {
  const events = [];
  return {
    events,
    config: { enabled: true, intervalMinutes: 120, leaseMs: 120_000, heartbeatMs: 40_000 },
    locations: {
      findOne: async () => structuredClone(location),
      updateOne: async () => ({ matchedCount: 1 }),
    },
    users: { findOne: async () => ({ id: "owner-1", status: "active" }) },
    requireLocationAccess: async (args) => {
      events.push(["access", args]);
      return { role: "owner" };
    },
    getIntegrationById: async (userId, integrationId) => {
      events.push(["integration", userId, integrationId]);
      return { id: "int-1", active: true, needs_reauth: false };
    },
    runSync: async (input) => {
      events.push(["sync", input]);
      return { summary: { fetched: 0 } };
    },
    syncGooglePosts: async () => ({ summary: {} }),
    syncDependencies: {},
    withTransaction: async (work) => work({}),
    operationId: () => "operation-1",
    now: () => new Date("2026-11-20T12:00:00.000Z"),
    ...overrides,
  };
}

test("disabled global flag skips queued work before loading a location or Google integration", async () => {
  let locationReads = 0;
  const input = deps({
    config: { enabled: false },
    locations: { findOne: async () => { locationReads += 1; } },
  });
  const result = await runAutoPostSyncJob({ locationId: "loc-1", enqueueClaimId: "claim-1" }, input);
  assert.deepEqual(result, { skipped: true, reason: "auto_sync_disabled" });
  assert.equal(locationReads, 0);
});

test("worker reloads scope and resolves the exact integration owned by the location", async () => {
  const input = deps();
  const result = await runAutoPostSyncJob({ locationId: "loc-1", enqueueClaimId: "claim-1" }, input);
  assert.equal(result.summary.fetched, 0);
  assert.equal(input.events[0][0], "access");
  assert.equal(input.events[0][1].userId, "owner-1");
  assert.deepEqual(input.events[1], ["integration", "owner-1", "int-1"]);
  assert.equal(input.events[2][0], "sync");
  assert.equal(input.events[2][1].operationKind, "automatic");
});

test("disabled or disconnected locations skip before Google integration resolution", async () => {
  for (const changed of [
    { post_sync: { auto_enabled: false } },
    { status: "disabled" },
    { integration_id: null },
  ]) {
    let integrations = 0;
    const input = deps({
      locations: {
        findOne: async () => ({ ...location, ...changed }),
        updateOne: async () => ({ matchedCount: 1 }),
      },
      getIntegrationById: async () => { integrations += 1; },
    });
    const result = await runAutoPostSyncJob({ locationId: "loc-1", enqueueClaimId: "claim-1" }, input);
    assert.equal(result.skipped, true);
    assert.equal(integrations, 0);
  }
});

test("worker rejects an integration awaiting reauthorization without running synchronization", async () => {
  let syncs = 0;
  const input = deps({
    getIntegrationById: async () => ({ id: "int-1", active: true, needs_reauth: true }),
    runSync: async () => { syncs += 1; },
  });
  await assert.rejects(
    runAutoPostSyncJob({ locationId: "loc-1", enqueueClaimId: "claim-1" }, input),
    (error) => error.code === "google_post_sync_auth_failed" && error.retryable === false,
  );
  assert.equal(syncs, 0);
});

test("worker rejects inactive location owners before resolving Google credentials", async () => {
  let integrations = 0;
  const input = deps({
    users: { findOne: async () => ({ id: "owner-1", status: "disabled" }) },
    getIntegrationById: async () => { integrations += 1; },
  });
  await assert.rejects(
    runAutoPostSyncJob({ locationId: "loc-1", enqueueClaimId: "claim-1" }, input),
    (error) => error.code === "post_sync_owner_inactive" && error.retryable === false,
  );
  assert.equal(integrations, 0);
});

test("worker skips when it loses the exact enqueue claim before starting Google work", async () => {
  let updates = 0;
  let syncs = 0;
  const input = deps({
    locations: {
      findOne: async () => structuredClone(location),
      updateOne: async () => ({ matchedCount: ++updates === 1 ? 0 : 1 }),
    },
    runSync: async () => { syncs += 1; },
  });
  const result = await runAutoPostSyncJob({ locationId: "loc-1", enqueueClaimId: "claim-1" }, input);
  assert.deepEqual(result, { skipped: true, reason: "enqueue_claim_lost" });
  assert.equal(syncs, 0);
});

test("worker options use configured concurrency without exposing job credentials", () => {
  const connection = { host: "redis" };
  assert.deepEqual(buildPostSyncWorkerOptions({ concurrency: 3 }, connection), {
    connection,
    concurrency: 3,
  });
});

test("automatic failure records a sanitized operational code and remains retryable", async () => {
  const updates = [];
  const input = deps({
    locations: {
      findOne: async () => structuredClone(location),
      updateOne: async (_filter, update) => { updates.push(update); return { matchedCount: 1 }; },
    },
    runSync: async (_input, runDeps) => {
      const error = Object.assign(new Error("raw provider body must not persist"), {
        code: "google_post_sync_rate_limited",
        status: 429,
        body: { access_token: "secret" },
      });
      await runDeps.onFailure({ error, operationId: "operation-1", fence: 1, failedAt: new Date("2026-11-20T12:00:00Z") });
      throw error;
    },
  });
  await assert.rejects(
    runAutoPostSyncJob({ locationId: "loc-1", enqueueClaimId: "claim-1" }, input),
    (error) => error.code === "google_post_sync_rate_limited",
  );
  const failure = updates.at(-1).$set;
  assert.equal(failure["post_sync.last_auto_failure_code"], "google_post_sync_rate_limited");
  assert.equal(failure["post_sync.auto_state"], "retrying");
  assert.equal(JSON.stringify(failure).includes("access_token"), false);
  assert.equal(JSON.stringify(failure).includes("raw provider"), false);
});
