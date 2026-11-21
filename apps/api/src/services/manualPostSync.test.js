import test from "node:test";
import assert from "node:assert/strict";
import {
  runManualPostSync,
} from "./manualPostSync.js";
import {
  claimPostSyncLease,
  completePostSyncLease,
  releasePostSyncLease,
} from "./postSyncLease.js";

const now = new Date("2026-11-19T12:00:00Z");
const location = {
  id: "loc-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1",
  integration_id: "integration-1", provider_account_name: "accounts/123", provider_location_name: "locations/456",
};

function locationsDouble(initial = location) {
  const state = { doc: structuredClone(initial) };
  return {
    state,
    async findOneAndUpdate(filter, update) {
      const lease = state.doc.post_sync;
      const allowed = filter["post_sync.operation_id"]
        ? lease?.operation_id === filter["post_sync.operation_id"] &&
          (filter["post_sync.operation_fence"] === undefined || lease?.operation_fence === filter["post_sync.operation_fence"])
        : !lease?.operation_id || lease.operation_expires_at <= now;
      if (!allowed) return null;
      for (const [key, value] of Object.entries(update.$inc || {})) {
        if (key.startsWith("post_sync.")) { state.doc.post_sync ||= {}; const field = key.slice(10); state.doc.post_sync[field] = Number(state.doc.post_sync[field] || 0) + value; }
      }
      for (const [key, value] of Object.entries(update.$set || {})) {
        if (key === "post_sync") state.doc.post_sync = value;
        else if (key.startsWith("post_sync.")) { state.doc.post_sync ||= {}; state.doc.post_sync[key.slice(10)] = value; }
      }
      for (const key of Object.keys(update.$unset || {})) if (key.startsWith("post_sync.")) delete state.doc.post_sync[key.slice(10)];
      return structuredClone(state.doc);
    },
    async updateOne(filter, update) {
      if (state.doc.post_sync?.operation_id !== filter["post_sync.operation_id"] ||
          (filter["post_sync.operation_fence"] !== undefined && state.doc.post_sync?.operation_fence !== filter["post_sync.operation_fence"])) return { matchedCount: 0 };
      for (const [key, value] of Object.entries(update.$set || {})) if (key.startsWith("post_sync.")) state.doc.post_sync[key.slice(10)] = value;
      for (const key of Object.keys(update.$unset || {})) delete state.doc.post_sync[key.slice(10)];
      return { matchedCount: 1 };
    },
  };
}

test("location sync lease rejects live work and ignores stale release", async () => {
  const locations = locationsDouble();
  await claimPostSyncLease(locations, { location, operationId: "one", now, leaseMs: 30_000 });
  await assert.rejects(claimPostSyncLease(locations, { location, operationId: "two", now, leaseMs: 30_000 }), (e) => e.code === "post_sync_in_progress");
  await releasePostSyncLease(locations, { locationId: location.id, operationId: "stale", fence: 1 });
  assert.equal(locations.state.doc.post_sync.operation_id, "one");
});

test("sync completion stores safe success metadata under the matching lease", async () => {
  const locations = locationsDouble();
  await claimPostSyncLease(locations, { location, operationId: "one", now, leaseMs: 30_000 });
  const completed = await completePostSyncLease(locations, {
    locationId: location.id, operationId: "one", fence: 1, operationKind: "manual", now,
    summary: { fetched: 3, inserted: 1, updated: 1, unchanged: 1, missingOnGoogle: 0, tombstoneSkipped: 0, conflicts: 0 },
  });
  assert.equal(completed.post_sync.last_success_at.getTime(), now.getTime());
  assert.equal(completed.post_sync.operation_id, undefined);
});

test("runManualPostSync authorizes, syncs, and returns the public contract", async () => {
  const locations = locationsDouble();
  const result = await runManualPostSync({ userId: "user-1", locationId: "loc-1", now }, {
    locations,
    requireLocationAccess: async () => ({ location }),
    getIntegrationById: async () => ({ id: "integration-1" }),
    syncGooglePosts: async () => ({ summary: { fetched: 1, inserted: 1, updated: 0, unchanged: 0, missingOnGoogle: 0, tombstoneSkipped: 0, skipped: 0, conflicts: 0 } }),
    syncDependencies: {},
    withTransaction: async (work) => work({}),
    operationId: () => "operation-1",
  });
  assert.equal(result.success, true);
  assert.equal(result.locationId, "loc-1");
  assert.equal(result.summary.inserted, 1);
  assert.equal(result.lastSyncedAt, now.toISOString());
});

test("runManualPostSync releases its lease and preserves old success metadata on failure", async () => {
  const locations = locationsDouble({ ...location, post_sync: { last_success_at: new Date("2026-11-18T00:00:00Z") } });
  await assert.rejects(runManualPostSync({ userId: "user-1", locationId: "loc-1", now }, {
    locations,
    requireLocationAccess: async () => ({ location: locations.state.doc }),
    getIntegrationById: async () => ({ id: "integration-1" }),
    syncGooglePosts: async () => { throw Object.assign(new Error("provider failed"), { code: "provider_failed" }); },
    syncDependencies: {}, withTransaction: async (work) => work({}), operationId: () => "operation-1",
  }));
  assert.equal(locations.state.doc.post_sync.operation_id, undefined);
  assert.equal(locations.state.doc.post_sync.last_success_at.toISOString(), "2026-11-18T00:00:00.000Z");
});

test("runManualPostSync maps provider HTTP failures to stable safe codes", async () => {
  const locations = locationsDouble();
  await assert.rejects(runManualPostSync({ userId: "user-1", locationId: "loc-1", now }, {
    locations,
    requireLocationAccess: async () => ({ location }),
    getIntegrationById: async () => ({ id: "integration-1" }),
    syncGooglePosts: async () => { throw Object.assign(new Error("http_error"), { status: 429, body: { secret: true } }); },
    syncDependencies: {}, withTransaction: async (work) => work({}), operationId: () => "operation-1",
  }), (error) => error.status === 429 && error.code === "google_post_sync_rate_limited" && !error.data);
});

test("manual synchronization works while auto-sync is disabled and preserves automatic metadata", async () => {
  const locations = locationsDouble({
    ...location,
    post_sync: {
      auto_enabled: false,
      last_auto_failure_at: new Date("2026-11-19T00:00:00Z"),
      last_auto_failure_code: "google_post_sync_auth_failed",
    },
  });
  await runManualPostSync({ userId: "user-1", locationId: "loc-1", now }, {
    locations,
    requireLocationAccess: async () => ({ location: locations.state.doc }),
    getIntegrationById: async () => ({ id: "integration-1" }),
    syncGooglePosts: async () => ({ summary: {
      fetched: 0, inserted: 0, updated: 0, unchanged: 0,
      missingOnGoogle: 0, tombstoneSkipped: 0, skipped: 0, conflicts: 0,
    } }),
    syncDependencies: {},
    withTransaction: async (work) => work({}),
    operationId: () => "operation-1",
  });
  assert.equal(locations.state.doc.post_sync.auto_enabled, false);
  assert.equal(locations.state.doc.post_sync.last_auto_failure_code, "google_post_sync_auth_failed");
  assert.equal(locations.state.doc.post_sync.last_auto_failure_at.toISOString(), "2026-11-19T00:00:00.000Z");
  assert.ok(locations.state.doc.post_sync.next_auto_sync_at > now);
});
