import assert from "node:assert/strict";
import test from "node:test";

import { runReviewSyncJob } from "./reviewSync.js";

const location = {
  id: "location-1", user_id: "owner-1", organization_id: "org-1", client_id: "client-1",
  provider: "google", integration_id: "integration-1",
  provider_account_name: "accounts/1", provider_location_name: "locations/1",
};

function harness({ pages, failAtPage, bulkResults = [] } = {}) {
  const stateUpdates = [];
  const bulkCalls = [];
  const updateManyCalls = [];
  const updateOneCalls = [];
  const listCalls = [];
  let pageIndex = 0;
  let bulkIndex = 0;
  const collections = {
    locations: { findOne: async () => location },
    review_sync_state: { updateOne: async (filter, update, options) => stateUpdates.push({ filter, update, options }) },
    reviews: {
      bulkWrite: async (operations) => {
        bulkCalls.push(operations);
        return bulkResults[bulkIndex++] || { upsertedCount: operations.length, matchedCount: 0, modifiedCount: 0 };
      },
      updateMany: async (...args) => { updateManyCalls.push(args); return { matchedCount: 0, modifiedCount: 0 }; },
      updateOne: async (...args) => { updateOneCalls.push(args); return { matchedCount: 1, modifiedCount: 1 }; },
    },
  };
  return {
    stateUpdates, bulkCalls, updateManyCalls, updateOneCalls, listCalls,
    deps: {
      getCollection: async (name) => collections[name],
      getIntegration: async () => ({ id: "integration-1" }),
      ensureToken: async () => ({ access_token: "token" }),
      fetchReviews: async (...args) => {
        listCalls.push(args);
        if (pageIndex === failAtPage) throw new Error("google_down");
        return pages?.[pageIndex++] || { reviews: [] };
      },
      randomUUID: (() => { let value = 0; return () => `uuid-${++value}`; })(),
      now: (() => {
        const values = [
          new Date("2026-11-26T08:00:00.000Z"), new Date("2026-11-26T08:01:00.000Z"),
          new Date("2026-11-26T08:02:00.000Z"), new Date("2026-11-26T08:03:00.000Z"),
        ];
        return () => values.shift() || new Date("2026-11-26T08:04:00.000Z");
      })(),
      logger: { info() {}, warn() {}, error() {} },
    },
  };
}

test("full review reconciliation ignores a legacy cursor and fetches every page", async () => {
  const h = harness({
    pages: [
      { reviews: [{ name: "reviews/1", updateTime: "2020-01-01T00:00:00Z" }], nextPageToken: "next" },
      { reviews: [{ name: "reviews/2" }, { name: "reviews/3" }] },
    ],
    bulkResults: [
      { upsertedCount: 1, matchedCount: 0, modifiedCount: 0 },
      { upsertedCount: 0, matchedCount: 1, modifiedCount: 0 },
    ],
  });
  const result = await runReviewSyncJob({ id: "job-1", data: {
    userId: "owner-1", locationId: "location-1", since: "2026-11-26T07:59:00.000Z",
  } }, h.deps);

  assert.deepEqual(result, {
    ok: true, fetched: 3, processed: 3, inserted: 1, matched: 1, modified: 0,
    unchanged: 1, pagesFetched: 2, snapshotComplete: true, snapshotDiagnostic: null,
    absenceMatched: 0, absenceModified: 0,
  });
  assert.equal(h.listCalls.length, 2);
  assert.deepEqual(h.listCalls.map((call) => call[3]), [
    { pageSize: 50, orderBy: "updateTime desc" },
    { pageSize: 50, orderBy: "updateTime desc", pageToken: "next" },
  ]);
  assert.equal(h.bulkCalls.flat().length, 3);
  assert.deepEqual(h.bulkCalls[0][0].updateOne.filter, {
    user_id: "owner-1", location_id: "location-1", provider_review_name: "reviews/1",
  });
  assert.deepEqual(
    h.bulkCalls[0][0].updateOne.update.$set.updated_at,
    new Date("2020-01-01T00:00:00.000Z"),
  );
  const finalSet = h.stateUpdates.at(-1).update.$set;
  assert.equal(finalSet.status, "ok");
  assert.deepEqual({
    fetched: finalSet.last_fetched, processed: finalSet.last_processed, inserted: finalSet.last_inserted,
    matched: finalSet.last_matched, modified: finalSet.last_modified, unchanged: finalSet.last_unchanged,
    pagesFetched: finalSet.last_pages_fetched,
  }, { fetched: 3, processed: 3, inserted: 1, matched: 1, modified: 0, unchanged: 1, pagesFetched: 2 });
  assert.deepEqual(finalSet.last_synced_at, new Date("2026-11-26T08:01:00.000Z"));
});

test("failed reconciliation records failure without overwriting last_synced_at", async () => {
  const h = harness({ pages: [{ reviews: [{ name: "reviews/1" }], nextPageToken: "next" }], failAtPage: 1 });
  await assert.rejects(runReviewSyncJob({ id: "job-2", data: { userId: "owner-1", locationId: "location-1" } }, h.deps), /google_down/);
  const runningSet = h.stateUpdates[0].update.$set;
  const failedSet = h.stateUpdates.at(-1).update.$set;
  assert.equal(runningSet.status, "running");
  assert.equal(Object.hasOwn(runningSet, "last_synced_at"), false);
  assert.equal(failedSet.status, "failed");
  assert.equal(Object.hasOwn(failedSet, "last_synced_at"), false);
  assert.equal(failedSet.last_error.code, "review_sync_failed");
  assert.equal(h.updateManyCalls.length, 0);
});

test("MongoDB write failures remain retryable and preserve the previous successful timestamp", async () => {
  const h = harness({ pages: [{ reviews: [{ name: "reviews/1" }] }] });
  h.deps.getCollection = async (name) => {
    if (name === "locations") return { findOne: async () => location };
    if (name === "review_sync_state") return {
      updateOne: async (filter, update, options) => h.stateUpdates.push({ filter, update, options }),
    };
    return { bulkWrite: async () => { throw new Error("mongo_down"); } };
  };

  await assert.rejects(
    runReviewSyncJob({ id: "job-db", data: { userId: "owner-1", locationId: "location-1" } }, h.deps),
    /mongo_down/,
  );
  const failedSet = h.stateUpdates.at(-1).update.$set;
  assert.equal(failedSet.status, "failed");
  assert.equal(Object.hasOwn(failedSet, "last_synced_at"), false);
});

test("a location unbound after enqueue transitions from running to failed", async () => {
  const h = harness();
  h.deps.getCollection = async (name) => {
    if (name === "locations") return { findOne: async () => ({ ...location, integration_id: null }) };
    if (name === "review_sync_state") return {
      updateOne: async (filter, update, options) => h.stateUpdates.push({ filter, update, options }),
    };
    throw new Error("reviews collection must not be read");
  };

  await assert.rejects(
    runReviewSyncJob({ id: "job-unbound", data: { userId: "owner-1", locationId: "location-1" } }, h.deps),
    /location_not_bound/,
  );
  assert.deepEqual(h.stateUpdates.map((entry) => entry.update.$set.status), ["running", "failed"]);
  assert.equal(Object.hasOwn(h.stateUpdates[1].update.$set, "last_synced_at"), false);
});

test("reconciliation falls back from rejected orderBy without skipping older reviews", async () => {
  const h = harness();
  let first = true;
  h.deps.fetchReviews = async (...args) => {
    h.listCalls.push(args);
    if (first) {
      first = false;
      const error = new Error("google_http_error");
      error.status = 400;
      error.body = { error: { message: "Invalid orderBy" } };
      throw error;
    }
    return { reviews: [{ name: "reviews/old", updateTime: "2019-01-01T00:00:00Z" }] };
  };
  const result = await runReviewSyncJob({ id: "job-3", data: {
    userId: "owner-1", locationId: "location-1", since: "2026-01-01T00:00:00Z",
  } }, h.deps);
  assert.equal(result.processed, 1);
  assert.equal(result.pagesFetched, 1);
  assert.deepEqual(h.listCalls[1][3], { pageSize: 50 });
});

test("observed reviews become active and provider-owned edits including reply deletion are reconciled", async () => {
  const h = harness({ pages: [{
    totalReviewCount: 1,
    reviews: [{
      name: "reviews/1", comment: "Edited", starRating: "TWO",
      reviewer: { displayName: "Updated reviewer" }, updateTime: "2026-11-27T08:00:00.000Z",
    }],
  }] });

  const result = await runReviewSyncJob({ id: "job-active", data: {
    userId: "owner-1", locationId: "location-1", runId: "run-active",
  } }, h.deps);

  assert.equal(result.snapshotComplete, true);
  const upsert = h.bulkCalls[0][0].updateOne;
  assert.equal(upsert.update.$set.comment, "Edited");
  assert.equal(upsert.update.$set.starRating, "TWO");
  assert.deepEqual(upsert.update.$set.reviewer, { displayName: "Updated reviewer" });
  assert.equal(upsert.update.$set.provider_sync_status, "active");
  assert.equal(upsert.update.$set.provider_consecutive_misses, 0);
  assert.equal(upsert.update.$set.provider_missing_since, null);
  assert.equal(upsert.update.$set.provider_last_observed_run_id, "run-active");
  assert.ok(upsert.update.$setOnInsert.provider_first_seen_at instanceof Date);
  assert.equal(Object.hasOwn(upsert.update.$set, "reviewReply"), false);
  assert.deepEqual(h.updateOneCalls[0][1], { $set: { reviewReply: null } });
  assert.deepEqual(h.updateOneCalls[0][0].$or, [
    { local_reply_updated_at: { $exists: false } },
    { local_reply_updated_at: { $lte: new Date("2026-11-26T08:00:00.000Z") } },
  ]);
});

test("a complete snapshot marks absent reviews missing without deleting history", async () => {
  const h = harness({ pages: [{ totalReviewCount: 1, reviews: [{ name: "reviews/present" }] }] });
  await runReviewSyncJob({ id: "job-missing", data: {
    userId: "owner-1", locationId: "location-1", runId: "run-missing",
  } }, h.deps);

  const absence = h.updateManyCalls.at(-1);
  assert.deepEqual(absence[0], {
    user_id: "owner-1", organization_id: "org-1", client_id: "client-1",
    location_id: "location-1", provider: "google",
    provider_review_name: { $type: "string", $nin: ["reviews/present"] },
    provider_last_missing_run_id: { $ne: "run-missing" },
  });
  assert.equal(Array.isArray(absence[1]), true);
  const serialized = JSON.stringify(absence[1]);
  assert.equal(serialized.includes("provider_sync_status"), true);
  assert.equal(serialized.includes("provider_consecutive_misses"), true);
  assert.equal(serialized.includes("provider_missing_since"), true);
  assert.equal(serialized.includes("provider_last_missing_run_id"), true);
  assert.equal(serialized.includes("comment"), false);
  assert.equal(serialized.includes("reviewReply"), false);
});

test("inconsistent provider totals skip absence reconciliation and do not advance last_synced_at", async () => {
  const h = harness({ pages: [{ totalReviewCount: 2, reviews: [{ name: "reviews/1" }] }] });
  const result = await runReviewSyncJob({ id: "job-incomplete", data: {
    userId: "owner-1", locationId: "location-1", runId: "run-incomplete",
  } }, h.deps);

  assert.equal(result.snapshotComplete, false);
  assert.equal(result.snapshotDiagnostic, "total_review_count_mismatch");
  assert.equal(h.updateManyCalls.some((call) => call[0]?.provider_last_missing_run_id), false);
  const finalSet = h.stateUpdates.at(-1).update.$set;
  assert.equal(finalSet.status, "incomplete");
  assert.equal(finalSet.last_absence_reconciled, false);
  assert.equal(Object.hasOwn(finalSet, "last_synced_at"), false);
});

test("repeated page tokens are handled as incomplete and cannot mark reviews missing", async () => {
  const h = harness({ pages: [
    { totalReviewCount: 2, reviews: [{ name: "reviews/1" }], nextPageToken: "repeat" },
    { totalReviewCount: 2, reviews: [{ name: "reviews/2" }], nextPageToken: "repeat" },
  ] });
  const result = await runReviewSyncJob({ id: "job-repeat", data: {
    userId: "owner-1", locationId: "location-1", runId: "run-repeat",
  } }, h.deps);
  assert.equal(result.snapshotComplete, false);
  assert.equal(result.snapshotDiagnostic, "repeated_page_token");
  assert.equal(h.listCalls.length, 2);
  assert.equal(h.updateManyCalls.some((call) => call[0]?.provider_last_missing_run_id), false);
});

test("absence updates are idempotent per run and require two misses separated by thirty minutes for unavailable", async () => {
  const h = harness({ pages: [{ totalReviewCount: 0, reviews: [] }] });
  await runReviewSyncJob({ id: "job-empty", data: {
    userId: "owner-1", locationId: "location-1", runId: "run-empty",
  } }, h.deps);
  const absence = h.updateManyCalls.at(-1);
  assert.deepEqual(absence[0].provider_last_missing_run_id, { $ne: "run-empty" });
  const pipeline = JSON.stringify(absence[1]);
  assert.equal(pipeline.includes("unavailable"), true);
  assert.equal(pipeline.includes("missing"), true);
  assert.equal(pipeline.includes("provider_missing_since"), true);
  const unavailableConditions = absence[1][0].$set.provider_sync_status.$cond[0].$and;
  assert.deepEqual(unavailableConditions[1].$lte[1], new Date("2026-11-26T07:30:00.000Z"));
});

test("duplicate provider review ids make the snapshot incomplete and do not create duplicate upserts", async () => {
  const h = harness({ pages: [{
    totalReviewCount: 1,
    reviews: [{ name: "reviews/1", comment: "first" }, { name: "reviews/1", comment: "duplicate" }],
  }] });
  const result = await runReviewSyncJob({ id: "job-duplicate", data: {
    userId: "owner-1", locationId: "location-1", runId: "run-duplicate",
  } }, h.deps);
  assert.equal(result.snapshotComplete, false);
  assert.equal(result.snapshotDiagnostic, "duplicate_provider_review_id");
  assert.equal(h.bulkCalls[0].length, 1);
  assert.equal(h.updateManyCalls.some((call) => call[0]?.provider_last_missing_run_id), false);
});

test("invalid totalReviewCount metadata makes the snapshot incomplete", async () => {
  const h = harness({ pages: [{ totalReviewCount: "unknown", reviews: [{ name: "reviews/1" }] }] });
  const result = await runReviewSyncJob({ id: "job-invalid-total", data: {
    userId: "owner-1", locationId: "location-1", runId: "run-invalid-total",
  } }, h.deps);
  assert.equal(result.snapshotComplete, false);
  assert.equal(result.snapshotDiagnostic, "invalid_total_review_count");
  assert.equal(h.updateManyCalls.some((call) => call[0]?.provider_last_missing_run_id), false);
});
