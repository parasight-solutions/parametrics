import test from "node:test";
import assert from "node:assert/strict";
import {
  ensurePostDeletionTombstoneIndexes,
  ensureReviewIndexes,
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

test("review listing index includes the deterministic id tiebreaker", async () => {
  const created = [];
  const collection = {
    collectionName: "reviews",
    listIndexes: () => ({ toArray: async () => [] }),
    createIndex: async (key, options) => created.push({ key, options }),
  };

  await ensureReviewIndexes(collection);

  assert.deepEqual(created, [
    {
      key: { user_id: 1, location_id: 1, provider_review_name: 1 },
      options: { unique: true, name: "uniq_reviews_user_location_provider_review" },
    },
    {
      key: {
        user_id: 1,
        location_id: 1,
        provider: 1,
        updateTime: -1,
        createTime: -1,
        _id: -1,
      },
      options: { name: "idx_reviews_user_location_provider_updateTime" },
    },
    {
      key: {
        organization_id: 1,
        client_id: 1,
        location_id: 1,
        updateTime: -1,
        createTime: -1,
      },
      options: { name: "idx_reviews_org_client_location_updateTime" },
    },
  ]);
});
