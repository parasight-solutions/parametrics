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
  const listCalls = [];
  let pageIndex = 0;
  let bulkIndex = 0;
  const collections = {
    locations: { findOne: async () => location },
    review_sync_state: { updateOne: async (filter, update, options) => stateUpdates.push({ filter, update, options }) },
    reviews: { bulkWrite: async (operations) => {
      bulkCalls.push(operations);
      return bulkResults[bulkIndex++] || { upsertedCount: operations.length, matchedCount: 0, modifiedCount: 0 };
    } },
  };
  return {
    stateUpdates, bulkCalls, listCalls,
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
      { reviews: [{ name: "reviews/2" }, { comment: "missing name" }] },
    ],
    bulkResults: [
      { upsertedCount: 1, matchedCount: 0, modifiedCount: 0 },
      { upsertedCount: 0, matchedCount: 1, modifiedCount: 0 },
    ],
  });
  const result = await runReviewSyncJob({ id: "job-1", data: {
    userId: "owner-1", locationId: "location-1", since: "2026-11-26T07:59:00.000Z",
  } }, h.deps);

  assert.deepEqual(result, { ok: true, fetched: 3, processed: 2, inserted: 1, matched: 1, modified: 0, unchanged: 1, pagesFetched: 2 });
  assert.equal(h.listCalls.length, 2);
  assert.deepEqual(h.listCalls.map((call) => call[3]), [
    { pageSize: 50, orderBy: "updateTime desc" },
    { pageSize: 50, orderBy: "updateTime desc", pageToken: "next" },
  ]);
  assert.equal(h.bulkCalls.flat().length, 2);
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
  }, { fetched: 3, processed: 2, inserted: 1, matched: 1, modified: 0, unchanged: 1, pagesFetched: 2 });
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
