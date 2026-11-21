import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPostSyncJobId,
  calculateInitialAutoSyncAt,
  calculateNextAutoSyncAt,
  claimDuePostSyncLocations,
  enqueueClaimedPostSync,
  isPostAutoSyncDue,
} from "./postAutoSyncScheduler.js";

test("successful automatic sync is next due 120 minutes after completion", () => {
  const completedAt = new Date("2026-11-20T10:00:00.000Z");
  const due = calculateNextAutoSyncAt({
    locationId: "location-1",
    completedAt,
    intervalMinutes: 120,
  });
  assert.ok(due >= new Date("2026-11-20T12:00:00.000Z"));
  assert.ok(due < new Date("2026-11-20T12:05:00.000Z"));
});

test("duplicate scheduler scans can claim a due location only once", async () => {
  const now = new Date("2026-11-20T10:00:00.000Z");
  const location = {
    id: "loc-1", provider: "google", status: "active",
    integration_id: "int-1", user_id: "owner-1", organization_id: "org-1", client_id: "client-1",
    provider_account_name: "accounts/1", provider_location_name: "locations/1",
    post_sync: { auto_enabled: true, next_auto_sync_at: new Date("2026-11-20T09:00:00Z") },
  };
  let claimed = false;
  const locations = {
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [location] }) }) }),
    async findOneAndUpdate(filter, update) {
      if (claimed) return null;
      assert.equal(filter["post_sync.auto_enabled"], true);
      claimed = true;
      return { ...location, post_sync: { ...location.post_sync, enqueue_claim_id: update.$set["post_sync.enqueue_claim_id"] } };
    },
  };
  const deps = { locations, claimIdFactory: () => "claim-1" };
  const first = await claimDuePostSyncLocations({ now, limit: 10, claimMs: 60_000 }, deps);
  const second = await claimDuePostSyncLocations({ now, limit: 10, claimMs: 60_000 }, deps);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.deepEqual(Object.keys(first[0]).sort(), ["dueAt", "enqueueClaimId", "locationId"]);
});

test("scheduler ignores a MongoDB claim envelope whose value is null", async () => {
  const locations = {
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [{
      id: "loc-1",
      post_sync: { auto_enabled: true, next_auto_sync_at: new Date("2026-11-20T09:00:00Z") },
    }] }) }) }),
    findOneAndUpdate: async () => ({ value: null }),
  };
  const claimed = await claimDuePostSyncLocations(
    { now: new Date("2026-11-20T12:00:00Z") },
    { locations, claimIdFactory: () => "lost-claim" },
  );
  assert.deepEqual(claimed, []);
});

test("enqueue uses a minimal payload and conditionally clears its claim on failure", async () => {
  const calls = [];
  const record = { locationId: "loc-1", enqueueClaimId: "claim-1", dueAt: new Date("2026-11-20T10:00:00Z") };
  const locations = {
    async updateOne(filter, update) { calls.push({ filter, update }); return { matchedCount: 1 }; },
  };
  const queue = {
    async add(_name, payload) {
      assert.deepEqual(payload, {
        locationId: "loc-1",
        enqueueClaimId: "claim-1",
        dueAt: "2026-11-20T10:00:00.000Z",
      });
      throw new Error("redis unavailable");
    },
  };
  await assert.rejects(enqueueClaimedPostSync(record, { queue, locations, maxAttempts: 3 }), /redis unavailable/);
  assert.equal(calls[0].filter["post_sync.enqueue_claim_id"], "claim-1");
  assert.equal(calls[0].update.$unset["post_sync.enqueue_claim_id"], "");
});

test("first enable uses stable prompt staggering instead of waiting two hours", () => {
  const enabledAt = new Date("2026-11-20T10:00:00.000Z");
  const first = calculateInitialAutoSyncAt({ locationId: "location-1", enabledAt });
  const repeated = calculateInitialAutoSyncAt({ locationId: "location-1", enabledAt });
  assert.equal(first.toISOString(), repeated.toISOString());
  assert.ok(first >= enabledAt);
  assert.ok(first < new Date("2026-11-20T10:05:00.000Z"));
});

test("due evaluation treats a missing due time as due only for enabled locations", () => {
  const now = new Date("2026-11-20T10:00:00.000Z");
  assert.equal(isPostAutoSyncDue({ autoEnabled: true, nextAutoSyncAt: null, now }), true);
  assert.equal(isPostAutoSyncDue({ autoEnabled: false, nextAutoSyncAt: null, now }), false);
  assert.equal(isPostAutoSyncDue({ autoEnabled: true, nextAutoSyncAt: new Date(now.getTime() + 1), now }), false);
  assert.equal(isPostAutoSyncDue({ autoEnabled: true, nextAutoSyncAt: now, now }), true);
});

test("job identity is stable within a due window and changes for future windows", () => {
  const first = buildPostSyncJobId({ locationId: "location/with unsafe chars", dueAt: new Date("2026-11-20T10:00:20Z") });
  const sameWindow = buildPostSyncJobId({ locationId: "location/with unsafe chars", dueAt: new Date("2026-11-20T10:00:59Z") });
  const later = buildPostSyncJobId({ locationId: "location/with unsafe chars", dueAt: new Date("2026-11-20T10:01:00Z") });
  assert.equal(first, sameWindow);
  assert.notEqual(first, later);
  assert.match(first, /^post-sync-[a-f0-9]{16}-\d+$/);
  assert.equal(first.includes(":"), false);
});
