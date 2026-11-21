import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPostSyncLease,
  claimPostSyncLease,
  completePostSyncLease,
  releasePostSyncLease,
  renewPostSyncLease,
  startPostSyncHeartbeat,
} from "./postSyncLease.js";

const now = new Date("2026-11-20T12:00:00.000Z");
const location = {
  id: "location-1",
  user_id: "owner-1",
  organization_id: "org-1",
  client_id: "client-1",
  post_sync: { operation_fence: 4, last_success_at: new Date("2026-11-19T00:00:00Z") },
};

function unwrap(result) {
  return result?.value ?? result;
}

test("claim creates an expiring operation and monotonically increments its fence", async () => {
  let captured;
  const locations = {
    async findOneAndUpdate(filter, update) {
      captured = { filter, update };
      return { ...location, post_sync: { ...location.post_sync, operation_id: "op-1", operation_fence: 5 } };
    },
  };
  const claimed = await claimPostSyncLease(locations, {
    location,
    operationId: "op-1",
    operationKind: "automatic",
    now,
    leaseMs: 120_000,
  });
  assert.equal(claimed.fence, 5);
  assert.equal(captured.update.$inc["post_sync.operation_fence"], 1);
  assert.equal(captured.update.$set["post_sync.operation_kind"], "automatic");
  assert.equal(captured.update.$set["post_sync.operation_expires_at"].toISOString(), "2026-11-20T12:02:00.000Z");
  assert.equal(captured.filter.organization_id, "org-1");
  assert.equal(captured.filter.client_id, "client-1");
});

test("completion uses dotted fields, preserves unrelated metadata, and clears only its lease", async () => {
  let captured;
  const locations = {
    async findOneAndUpdate(filter, update) {
      captured = { filter, update };
      return {
        id: "location-1",
        post_sync: { auto_enabled: true, last_success_at: now },
      };
    },
  };
  await completePostSyncLease(locations, {
    locationId: "location-1",
    operationId: "op-1",
    fence: 5,
    operationKind: "automatic",
    summary: {
      fetched: 4, inserted: 1, updated: 1, unchanged: 2,
      missingOnGoogle: 0, tombstoneSkipped: 0, conflicts: 0,
    },
    now,
    nextAutoSyncAt: new Date("2026-11-20T14:00:00.000Z"),
  });
  assert.equal(Object.hasOwn(captured.update.$set, "post_sync"), false);
  assert.equal(captured.update.$set["post_sync.last_success_at"], now);
  assert.equal(captured.update.$set["post_sync.last_auto_success_at"], now);
  assert.equal(captured.update.$set["post_sync.next_auto_sync_at"].toISOString(), "2026-11-20T14:00:00.000Z");
  assert.equal(captured.filter["post_sync.operation_fence"], 5);
  assert.equal(captured.update.$unset["post_sync.operation_id"], "");
});

test("claim reports contention when an unexpired operation owns the location", async () => {
  const locations = { findOneAndUpdate: async () => null };
  await assert.rejects(
    claimPostSyncLease(locations, { location, operationId: "op-2", operationKind: "manual", now }),
    (error) => error.code === "post_sync_in_progress" && error.status === 409,
  );
});

test("renew and release require both operation id and fence", async () => {
  const calls = [];
  const locations = {
    async updateOne(filter, update) {
      calls.push({ filter, update });
      return { matchedCount: filter["post_sync.operation_fence"] === 5 ? 1 : 0 };
    },
  };
  assert.equal(await renewPostSyncLease(locations, {
    locationId: "location-1", operationId: "op-1", fence: 5, now, leaseMs: 120_000,
  }), true);
  assert.equal(await releasePostSyncLease(locations, {
    locationId: "location-1", operationId: "op-1", fence: 4,
  }), false);
  assert.deepEqual(calls[0].filter, {
    id: "location-1",
    "post_sync.operation_id": "op-1",
    "post_sync.operation_fence": 5,
    "post_sync.operation_expires_at": { $gt: now },
  });
  assert.ok(calls[1].update.$unset["post_sync.operation_id"] === "");
});

test("transaction ownership assertion requires an unexpired matching fence", async () => {
  const session = { id: "session-1" };
  let options;
  let update;
  const locations = {
    async findOneAndUpdate(filter, receivedUpdate, receivedOptions) {
      options = receivedOptions;
      update = receivedUpdate;
      assert.equal(filter["post_sync.operation_expires_at"].$gt.getTime(), now.getTime());
      return { id: "location-1", post_sync: { operation_id: "op-1", operation_fence: 5 } };
    },
  };
  const owned = await assertPostSyncLease(locations, {
    locationId: "location-1", operationId: "op-1", fence: 5, now, session,
  });
  assert.equal(unwrap(owned).id, "location-1");
  assert.equal(options.session, session);
  assert.equal(options.returnDocument, "after");
  assert.equal(update.$set["post_sync.operation_guard_at"].getTime(), now.getTime());
});

test("heartbeat reports lease loss and stops renewing", async () => {
  let tick;
  let cleared = false;
  let attempts = 0;
  const heartbeat = startPostSyncHeartbeat({
    intervalMs: 1000,
    renew: async () => {
      attempts += 1;
      return false;
    },
    setIntervalFn: (callback) => {
      tick = callback;
      return "timer";
    },
    clearIntervalFn: (timer) => {
      assert.equal(timer, "timer");
      cleared = true;
    },
  });
  await tick();
  assert.equal(attempts, 1);
  assert.equal(await heartbeat.lost, true);
  assert.equal(cleared, true);
  heartbeat.stop();
});

test("renewal cannot revive an expired lease", async () => {
  let filter;
  const locations = {
    updateOne: async (received) => { filter = received; return { matchedCount: 0 }; },
  };
  const now = new Date("2026-11-20T12:00:00Z");
  const renewed = await renewPostSyncLease(locations, {
    locationId: "location-1", operationId: "op-1", fence: 5, now, leaseMs: 120_000,
  });
  assert.equal(renewed, false);
  assert.equal(filter["post_sync.operation_expires_at"].$gt.getTime(), now.getTime());
});
