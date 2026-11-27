import assert from "node:assert/strict";
import test from "node:test";

import { cleanupDuplicateGoogleReviews } from "./reviewDuplicateCleanup.js";

const oldName = "accounts/105611384841512279530/locations/4394236421618650033/reviews/shared-review";
const currentName = "accounts/103094208499803762981/locations/4394236421618650033/reviews/shared-review";
const location = {
  id: "location-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1",
  provider: "google", integration_id: "integration-current",
  provider_account_name: "accounts/103094208499803762981",
  provider_location_name: "locations/4394236421618650033",
};

function harness({ equalCandidates = false } = {}) {
  const rows = [
    {
      _id: "mongo-old", id: "local-old", user_id: "user-1", organization_id: "org-1",
      client_id: "client-1", location_id: "location-1", provider: "google",
      integration_id: equalCandidates ? "integration-current" : "integration-old",
      provider_review_name: equalCandidates ? currentName : oldName,
      provider_sync_status: equalCandidates ? "active" : "unavailable",
      updateTime: "2026-11-20T00:00:00Z",
    },
    {
      _id: "mongo-current", id: "local-current", user_id: "user-1", organization_id: "org-1",
      client_id: "client-1", location_id: "location-1", provider: "google",
      integration_id: "integration-current", provider_review_name: currentName,
      provider_sync_status: "active", updateTime: equalCandidates ? "2026-11-20T00:00:00Z" : "2026-11-26T00:00:00Z",
    },
  ];
  const events = [];
  const archives = new Map();
  const reviews = {
    find: () => ({ toArray: async () => rows.filter(Boolean) }),
    countDocuments: async () => rows.filter(Boolean).length,
    updateOne: async (filter, update) => {
      events.push(["review-update", filter]);
      const row = rows.find((item) => item?._id === filter._id);
      if (row) Object.assign(row, update.$set);
      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
    },
    deleteOne: async (filter) => {
      events.push(["delete", filter]);
      const index = rows.findIndex((item) => item?._id === filter._id);
      if (index >= 0) rows[index] = null;
      return { deletedCount: index >= 0 ? 1 : 0 };
    },
  };
  const archive = {
    updateOne: async (filter, update) => {
      events.push(["archive", filter]);
      if (!archives.has(filter.source_review_id)) archives.set(filter.source_review_id, update.$setOnInsert);
      return { upsertedCount: 1 };
    },
    findOne: async (filter) => archives.get(filter.source_review_id) || null,
  };
  return {
    rows, events, archives, reviews, archive,
    locations: { find: () => ({ toArray: async () => [location] }) },
  };
}

test("dry-run identifies the cross-account duplicate and performs no writes", async () => {
  const h = harness();
  const result = await cleanupDuplicateGoogleReviews({
    reviews: h.reviews, locations: h.locations, archive: h.archive,
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.duplicateGroups, 1);
  assert.equal(result.groups[0].keeperId, "local-current");
  assert.deepEqual(result.groups[0].duplicateIds, ["local-old"]);
  assert.match(result.groups[0].keeperReason, /current connected account/);
  assert.deepEqual(h.events, []);
});

test("apply archives and verifies the duplicate before deleting it", async () => {
  const h = harness();
  const result = await cleanupDuplicateGoogleReviews({
    reviews: h.reviews, locations: h.locations, archive: h.archive,
    apply: true, backupConfirmed: true,
  });
  assert.equal(result.deleted, 1);
  assert.equal(h.events.findIndex(([kind]) => kind === "archive") < h.events.findIndex(([kind]) => kind === "delete"), true);
  assert.ok(h.archives.has("mongo-old"));
  assert.equal(h.rows.filter(Boolean)[0].provider_review_id, "shared-review");
});

test("ambiguous duplicate groups are skipped without writes", async () => {
  const h = harness({ equalCandidates: true });
  const result = await cleanupDuplicateGoogleReviews({
    reviews: h.reviews, locations: h.locations, archive: h.archive,
    apply: true, backupConfirmed: true,
  });
  assert.equal(result.ambiguousGroups, 1);
  assert.equal(result.deleted, 0);
  assert.deepEqual(h.events, []);
});

test("cleanup is idempotent after a successful apply", async () => {
  const h = harness();
  await cleanupDuplicateGoogleReviews({
    reviews: h.reviews, locations: h.locations, archive: h.archive,
    apply: true, backupConfirmed: true,
  });
  h.events.length = 0;
  const result = await cleanupDuplicateGoogleReviews({
    reviews: h.reviews, locations: h.locations, archive: h.archive,
    apply: true, backupConfirmed: true,
  });
  assert.equal(result.duplicateGroups, 0);
  assert.equal(result.deleted, 0);
  assert.equal(h.events.some(([kind]) => kind === "delete" || kind === "archive"), false);
});

test("apply requires an explicit backup acknowledgement", async () => {
  const h = harness();
  await assert.rejects(
    cleanupDuplicateGoogleReviews({ reviews: h.reviews, locations: h.locations, archive: h.archive, apply: true }),
    /review_cleanup_backup_required/,
  );
  assert.deepEqual(h.events, []);
});

test("identical provider review ids in different tenants are never grouped together", async () => {
  const rows = [
    { _id: "a", id: "a", user_id: "user-a", organization_id: "org-a", client_id: "client-a", location_id: "loc-a", provider: "google", provider_review_name: "accounts/1/locations/9/reviews/same" },
    { _id: "b", id: "b", user_id: "user-b", organization_id: "org-b", client_id: "client-b", location_id: "loc-b", provider: "google", provider_review_name: "accounts/2/locations/9/reviews/same" },
  ];
  const result = await cleanupDuplicateGoogleReviews({
    reviews: { find: () => ({ toArray: async () => rows }), countDocuments: async () => 2 },
    locations: { find: () => ({ toArray: async () => [
      { id: "loc-a", user_id: "user-a", organization_id: "org-a", client_id: "client-a", provider_location_name: "locations/9" },
      { id: "loc-b", user_id: "user-b", organization_id: "org-b", client_id: "client-b", provider_location_name: "locations/9" },
    ] }) },
    archive: {},
  });
  assert.equal(result.duplicateGroups, 0);
  assert.equal(result.canonicalCandidates, 2);
});

test("a conflicting tenant scope skips the affected canonical duplicate group", async () => {
  const h = harness();
  h.rows.push({
    ...h.rows[0], _id: "mongo-conflict", id: "local-conflict",
    organization_id: "other-org", provider_review_name: currentName,
  });
  const result = await cleanupDuplicateGoogleReviews({
    reviews: h.reviews, locations: h.locations, archive: h.archive,
    apply: true, backupConfirmed: true,
  });
  assert.equal(result.conflictingGroups, 1);
  assert.equal(result.deleted, 0);
  assert.deepEqual(h.events, []);
});
