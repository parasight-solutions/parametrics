import assert from "node:assert/strict";
import test, { after } from "node:test";

import { getReviews, queueReviewSync, replyToReview } from "./reviews.js";
import { connection } from "../lib/queues.js";

after(() => connection.disconnect());

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("reviews endpoint authorizes before running a tenant-scoped facet", async () => {
  const calls = [];
  const loc = {
    id: "location-1",
    user_id: "owner-1",
    organization_id: "org-1",
    client_id: "client-1",
  };
  const aggregateResult = [{
    reviews: [{ id: "review-1", comment: "Great", starRating: "FIVE" }],
    matching: [{ value: 25 }],
    total: [{ value: 3 }],
    replied: [{ value: 1 }],
    unreplied: [{ value: 2 }],
  }];
  const getCollection = async (name) => {
    calls.push(`collection:${name}`);
    if (name === "reviews") return {
      aggregate(pipeline) {
        calls.push({ pipeline });
        return { toArray: async () => aggregateResult };
      },
    };
    return { findOne: async (filter) => ({ status: "ok", last_synced_at: new Date("2026-11-26T10:34:43.073Z"), filter }) };
  };
  const requireAccess = async (input) => {
    calls.push({ access: input });
    return { location: loc };
  };
  const res = response();

  await getReviews({
    user: { user_id: "user-1" },
    query: {
      locationId: "location-1",
      status: "unreplied",
      keyword: "great",
      page: "2",
      perPage: "10",
    },
  }, res, { getCollection, requireAccess });

  assert.deepEqual(calls[0], {
    access: {
      userId: "user-1",
      locationId: "location-1",
      provider: "google",
      allowedRoles: ["owner", "admin", "manager", "viewer"],
    },
  });
  const pipeline = calls.find((entry) => entry.pipeline).pipeline;
  assert.deepEqual(pipeline[0], { $match: {
    user_id: "owner-1",
    organization_id: "org-1",
    client_id: "client-1",
    location_id: "location-1",
    provider: "google",
  } });
  assert.deepEqual(res.body, {
    statusCode: 200,
    success: true,
    message: "Reviews fetched successfully",
    data: {
      reviews: [{
        id: "review-1",
        comment: "Great",
        starRating: 5,
        provider_sync_status: "active",
        provider_first_seen_at: null,
        provider_last_seen_at: null,
        provider_missing_since: null,
        provider_last_checked_at: null,
        provider_consecutive_misses: 0,
      }],
      pagination: { page: 2, perPage: 10, total: 25, totalPages: 3 },
      counts: { total: 3, replied: 1, unreplied: 2 },
      lastSyncedAt: "2026-11-26T10:34:43.073Z",
      sync: { status: "ok", last_synced_at: {}, filter: {
        user_id: "owner-1",
        organization_id: "org-1",
        client_id: "client-1",
        location_id: "location-1",
      } },
    },
  });
});

test("reviews endpoint rejects invalid query input without reading reviews", async () => {
  let reviewReads = 0;
  const res = response();
  await getReviews({
    user: { user_id: "user-1" },
    query: { locationId: "location-1", status: "draft" },
  }, res, {
    requireAccess: async () => ({ location: {
      id: "location-1",
      user_id: "user-1",
      organization_id: "org-1",
      client_id: "client-1",
    } }),
    getCollection: async () => {
      reviewReads += 1;
      throw new Error("should not read");
    },
  });

  assert.equal(reviewReads, 0);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.errors, [{
    code: "bad_request",
    message: "status must be all, replied, or unreplied",
  }]);
});

test("reviews endpoint does no database work when location authorization fails", async () => {
  let collectionReads = 0;
  const res = response();
  await getReviews({
    user: { user_id: "user-1" },
    query: { locationId: "location-other" },
  }, res, {
    requireAccess: async () => {
      const error = new Error("Location not found");
      error.status = 404;
      error.code = "not_found";
      throw error;
    },
    getCollection: async () => {
      collectionReads += 1;
    },
  });

  assert.equal(collectionReads, 0);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.errors[0].code, "not_found");
});

test("reviews endpoint returns an empty out-of-range page without changing it", async () => {
  const res = response();
  await getReviews({
    user: { user_id: "user-1" },
    query: { locationId: "location-1", page: "5" },
  }, res, {
    requireAccess: async () => ({ location: {
      id: "location-1",
      user_id: "user-1",
      organization_id: "org-1",
      client_id: "client-1",
    } }),
    getCollection: async (name) => name === "reviews"
      ? { aggregate: () => ({ toArray: async () => [{
        reviews: [], matching: [{ value: 11 }], total: [{ value: 11 }],
        replied: [{ value: 4 }], unreplied: [{ value: 7 }],
      }] }) }
      : { findOne: async () => null },
  });

  assert.deepEqual(res.body.data.pagination, {
    page: 5,
    perPage: 10,
    total: 11,
    totalPages: 2,
  });
  assert.deepEqual(res.body.data.reviews, []);
  assert.equal(res.body.data.lastSyncedAt, null);
});

test("reviews endpoint preserves the previous successful timestamp while sync state is failed", async () => {
  const res = response();
  await getReviews({ user: { user_id: "user-1" }, query: { locationId: "location-1" } }, res, {
    requireAccess: async () => ({ location: { id: "location-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1" } }),
    getCollection: async (name) => name === "reviews"
      ? { aggregate: () => ({ toArray: async () => [{ reviews: [], matching: [], total: [], replied: [], unreplied: [] }] }) }
      : { findOne: async () => ({ status: "failed", last_synced_at: "2026-11-25T08:00:00.000Z" }) },
  });
  assert.equal(res.body.data.lastSyncedAt, "2026-11-25T08:00:00.000Z");
  assert.equal(res.body.data.sync.status, "failed");
});

test("successful provider reply persists a reply that classifies as replied", async () => {
  const updates = [];
  const providerCalls = [];
  const res = response();
  await replyToReview({
    user: { user_id: "user-1" }, params: { id: "review-1" }, body: { comment: " Thank you " },
  }, res, {
    getCollection: async () => ({
      findOne: async () => ({ id: "review-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1", location_id: "location-1", provider: "google", provider_review_id: "1", provider_review_name: "accounts/2/locations/1/reviews/1" }),
      updateOne: async (filter, update) => updates.push({ filter, update }),
    }),
    requireAccess: async () => ({ location: { id: "location-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1", integration_id: "integration-1", provider_account_name: "accounts/2", provider_location_name: "locations/1" }, membership: { role: "manager" } }),
    getIntegration: async () => ({ id: "integration-1" }),
    ensureToken: async () => ({ access_token: "token" }),
    updateProviderReply: async (...args) => { providerCalls.push(args); },
    auditSuccess: async () => {},
    auditFailure: async () => {},
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(providerCalls[0], ["accounts/2/locations/1/reviews/1", "Thank you", "token"]);
  assert.equal(updates[0].update.$set.reviewReply.comment, "Thank you");
  assert.ok(updates[0].update.$set.local_reply_updated_at instanceof Date);
});

test("failed provider reply leaves the local review classification unchanged", async () => {
  let updates = 0;
  const res = response();
  await replyToReview({
    user: { user_id: "user-1" }, params: { id: "review-1" }, body: { comment: "Thank you" },
  }, res, {
    getCollection: async () => ({
      findOne: async () => ({ id: "review-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1", location_id: "location-1", provider: "google", provider_review_name: "locations/1/reviews/1" }),
      updateOne: async () => { updates += 1; },
    }),
    requireAccess: async () => ({ location: { id: "location-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1", integration_id: "integration-1" }, membership: { role: "manager" } }),
    getIntegration: async () => ({ id: "integration-1" }),
    ensureToken: async () => ({ access_token: "token" }),
    updateProviderReply: async () => { const error = new Error("provider failed"); error.status = 503; error.code = "provider_unavailable"; throw error; },
    auditSuccess: async () => {},
    auditFailure: async () => {},
    logger: { warn() {} },
  });

  assert.equal(res.statusCode, 503);
  assert.equal(updates, 0);
});

function googleReplyError(status, providerStatus, message = "provider failure") {
  const error = new Error("google_http_error");
  error.status = status;
  error.body = {
    error: {
      code: status,
      status: providerStatus,
      message,
      details: [{ reason: "provider_reason", access_token: "secret-token" }],
    },
    access_token: "secret-token",
  };
  return error;
}

async function failedReplyResponse(error, { logger = { warn() {} } } = {}) {
  let updates = 0;
  const res = response();
  await replyToReview({
    user: { user_id: "user-1" },
    params: { id: "review-1" },
    body: { comment: "Thank you" },
    headers: { "x-request-id": "correlation-1" },
  }, res, {
    getCollection: async () => ({
      findOne: async () => ({
        id: "review-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1",
        location_id: "location-1", provider: "google", provider_review_name: "accounts/1/locations/1/reviews/1",
      }),
      updateOne: async () => { updates += 1; },
    }),
    requireAccess: async () => ({ location: {
      id: "location-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1", integration_id: "integration-1",
    }, membership: { role: "manager" } }),
    getIntegration: async () => ({ id: "integration-1" }),
    ensureToken: async () => ({ access_token: "token" }),
    updateProviderReply: async () => { throw error; },
    auditSuccess: async () => {}, auditFailure: async () => {}, logger,
  });
  return { res, updates };
}

test("Google review-specific NOT_FOUND maps to a safe unavailable error without changing MongoDB", async () => {
  const logged = [];
  const { res, updates } = await failedReplyResponse(
    googleReplyError(404, "NOT_FOUND", "Requested review resource was not found"),
    { logger: { warn: (entry) => logged.push(entry) } },
  );

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, {
    statusCode: 404,
    success: false,
    message: "This review is currently unavailable on Google. Please try again later.",
    errors: [{ code: "google_review_unavailable", message: "Google could not find this review." }],
  });
  assert.equal(updates, 0);
  assert.deepEqual(logged[0], {
    reviewId: "review-1", locationId: "location-1", providerStatus: 404,
    providerErrorCode: 404, providerReason: "NOT_FOUND", correlationId: "correlation-1",
  });
  assert.equal(JSON.stringify(res.body).includes("secret-token"), false);
  assert.equal(JSON.stringify(logged).includes("secret-token"), false);
});

for (const [status, providerStatus, expectedCode, expectedStatus] of [
  [429, "RESOURCE_EXHAUSTED", "google_rate_limited", 429],
  [403, "PERMISSION_DENIED", "google_permission_denied", 403],
  [503, "UNAVAILABLE", "google_provider_unavailable", 503],
]) {
  test(`Google ${status} reply failure maps to ${expectedCode}`, async () => {
    const { res, updates } = await failedReplyResponse(googleReplyError(status, providerStatus));
    assert.equal(res.statusCode, expectedStatus);
    assert.equal(res.body.errors[0].code, expectedCode);
    assert.equal(updates, 0);
    assert.equal(Object.hasOwn(res.body, "body"), false);
  });
}

test("network timeout maps to provider unavailable without exposing internals", async () => {
  const error = new Error("socket timeout with token secret-token");
  error.code = "ETIMEDOUT";
  const { res, updates } = await failedReplyResponse(error);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.errors[0].code, "google_provider_unavailable");
  assert.equal(JSON.stringify(res.body).includes("secret-token"), false);
  assert.equal(updates, 0);
});

test("manual review sync always queues a full reconciliation without a cursor", async () => {
  const jobs = [];
  const stateWrites = [];
  let jobReads = 0;
  const res = response();
  await queueReviewSync({
    user: { user_id: "user-1" }, body: { locationId: "location-1" }, headers: {},
  }, res, {
    getCollection: async () => ({ findOne: async () => null, updateOne: async (...args) => { stateWrites.push(args); } }),
    requireAccess: async () => ({ location: { id: "location-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1", integration_id: "integration-1" }, membership: { role: "manager" } }),
    queue: {
      getJob: async () => (++jobReads === 1 ? null : { id: "reviewSync_user-1_location-1", data: { runId: "run-1" } }),
      add: async (name, data, options) => { jobs.push({ name, data, options }); return { id: options.jobId }; },
    },
    auditQueued: async () => {},
    auditFailure: async () => {},
    randomUUID: () => "run-1",
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.queued, true);
  assert.equal(res.body.data.since, null);
  assert.equal(jobs[0].name, "sync-location-reviews");
  assert.deepEqual(jobs[0].data, {
    userId: "user-1", locationId: "location-1", organizationId: "org-1", clientId: "client-1", runId: "run-1",
    mode: "full", since: null,
  });
  assert.deepEqual(stateWrites[0][0].last_run_id, { $ne: "run-1" });
  assert.ok(stateWrites[0][0].$or[0].updated_at.$lt instanceof Date);
  assert.equal(stateWrites[0][1].$set.last_run_id, "run-1");
  assert.equal(stateWrites[0][2].upsert, false);
  assert.equal(stateWrites[1][1].$setOnInsert.status, "queued");
  assert.equal(stateWrites[1][2].upsert, true);
});

test("a concurrent duplicate adopts the BullMQ winner run id without overwriting its worker state", async () => {
  const stateWrites = [];
  let jobReads = 0;
  const res = response();
  await queueReviewSync({ user: { user_id: "user-1" }, body: { locationId: "location-1" }, headers: {} }, res, {
    getCollection: async () => ({ updateOne: async (...args) => { stateWrites.push(args); } }),
    requireAccess: async () => ({ location: { id: "location-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1", integration_id: "integration-1" }, membership: { role: "manager" } }),
    queue: {
      getJob: async () => (++jobReads === 1 ? null : { id: "reviewSync_user-1_location-1", data: { runId: "winner-run" } }),
      add: async (_name, _data, options) => ({ id: options.jobId, data: { runId: "winner-run" } }),
    },
    randomUUID: () => "loser-run",
    auditQueued: async () => {}, auditFailure: async () => {},
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.alreadyRunning, true);
  assert.equal(res.body.data.jobId, "reviewSync_user-1_location-1");
  assert.equal(stateWrites.length, 0);
});

test("force cannot enqueue a duplicate while the BullMQ job is active", async () => {
  let adds = 0;
  const res = response();
  await queueReviewSync({ user: { user_id: "user-1" }, body: { locationId: "location-1", force: true }, headers: {} }, res, {
    getCollection: async () => ({ findOne: async () => ({ status: "failed", last_synced_at: new Date() }) }),
    requireAccess: async () => ({ location: { id: "location-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1", integration_id: "integration-1" }, membership: { role: "manager" } }),
    queue: { getJob: async () => ({ id: "active-job", getState: async () => "active" }), add: async () => { adds += 1; } },
    auditQueued: async () => {}, auditFailure: async () => {},
  });
  assert.equal(adds, 0);
  assert.equal(res.body.data.alreadyRunning, true);
  assert.equal(res.body.data.jobId, "active-job");
  assert.equal(res.body.data.since, null);
});

for (const terminalState of ["completed", "failed"]) {
  test(`a ${terminalState} BullMQ job does not block a subsequent manual sync`, async () => {
    let removed = 0;
    let added = 0;
    const res = response();
    await queueReviewSync({ user: { user_id: "user-1" }, body: { locationId: "location-1" }, headers: {} }, res, {
      getCollection: async () => ({ findOne: async () => ({ status: terminalState }), updateOne: async () => {} }),
      requireAccess: async () => ({ location: { id: "location-1", user_id: "user-1", organization_id: "org-1", client_id: "client-1", integration_id: "integration-1" }, membership: { role: "manager" } }),
      queue: {
        getJob: async () => ({ id: "old-job", getState: async () => terminalState, remove: async () => { removed += 1; } }),
        add: async (_name, _data, options) => { added += 1; return { id: options.jobId }; },
      },
      auditQueued: async () => {}, auditFailure: async () => {},
    });
    assert.equal(removed, 1);
    assert.equal(added, 1);
    assert.equal(res.body.data.alreadyRunning, undefined);
    assert.equal(res.body.data.since, null);
  });
}
