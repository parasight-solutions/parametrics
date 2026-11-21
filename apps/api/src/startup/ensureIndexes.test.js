import test from "node:test";
import assert from "node:assert/strict";
import {
  ensurePostAutoSyncIndexes,
  ensurePostDeletionTombstoneIndexes,
} from "./ensureIndexes.js";

test("tombstone indexes include unique resource identity and no TTL", async () => {
  const created = [];
  const collection = {
    collectionName: "post_deletion_tombstones",
    listIndexes: () => ({ toArray: async () => [] }),
    createIndex: async (key, options) => created.push({ key, options }),
  };
  await ensurePostDeletionTombstoneIndexes(collection);
  assert.deepEqual(created, [
    { key: { provider_resource_key: 1 }, options: { unique: true, name: "uniq_post_deletion_tombstones_provider_resource_key" } },
    { key: { provider: 1, provider_account_name: 1, provider_location_name: 1, provider_post_name: 1 }, options: { name: "idx_post_deletion_tombstones_provider_resource" } },
  ]);
  assert.equal(created.some(({ options }) => "expireAfterSeconds" in options), false);
});

test("location indexes support enabled due auto-sync scans", async () => {
  const created = [];
  const collection = {
    collectionName: "locations",
    listIndexes: () => ({ toArray: async () => [] }),
    createIndex: async (key, options) => created.push({ key, options }),
  };
  await ensurePostAutoSyncIndexes(collection);
  assert.deepEqual(created, [{
    key: {
      provider: 1,
      status: 1,
      "post_sync.auto_enabled": 1,
      "post_sync.next_auto_sync_at": 1,
    },
    options: { name: "idx_locations_post_auto_sync_due" },
  }]);
});
