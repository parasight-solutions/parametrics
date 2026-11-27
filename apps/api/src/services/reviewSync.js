import crypto from "node:crypto";

import { col } from "../lib/mongo.js";
import { listReviews } from "../integrations/google.js";
import { ensureAccessToken, getGoogleIntegrationById } from "../integrations/google.store.js";
import { buildReviewSyncDocument } from "./reviewSyncDocument.js";
import { canonicalReviewFilter, validateGoogleReviewIdentity } from "./googleReviewIdentity.js";

const BATCH_SIZE = 200;
const PAGE_SIZE = 50;
const MISSING_ESCALATION_MS = 30 * 60 * 1000;

function safeError(error) {
  return {
    code: "review_sync_failed",
    message: "Google review synchronization failed",
    status: error?.status || null,
  };
}

function isOrderByRejected(error) {
  if (error?.message !== "google_http_error" || error?.status !== 400) return false;
  const body = JSON.stringify(error.body || {}).toLowerCase();
  return body.includes("orderby") || body.includes("order by");
}

function providerTimestamp(review) {
  const raw = review?.updateTime || review?.createTime || null;
  if (!raw) return null;
  const timestamp = new Date(raw);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function providerTotalReviewCount(data) {
  if (data?.totalReviewCount === undefined || data?.totalReviewCount === null) return undefined;
  const total = Number(data.totalReviewCount);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function buildAbsencePipeline({ observedAt, runId }) {
  const cutoff = new Date(observedAt.getTime() - MISSING_ESCALATION_MS);
  const previousMisses = { $ifNull: ["$provider_consecutive_misses", 0] };
  const missingSince = { $ifNull: ["$provider_missing_since", observedAt] };
  return [{
    $set: {
      provider_sync_status: {
        $cond: [
          {
            $and: [
              { $gte: [previousMisses, 1] },
              { $lte: [missingSince, cutoff] },
            ],
          },
          "unavailable",
          "missing",
        ],
      },
      provider_missing_since: missingSince,
      provider_consecutive_misses: { $add: [previousMisses, 1] },
      provider_last_checked_at: observedAt,
      provider_last_missing_run_id: runId,
    },
  }];
}

async function promoteSingleLegacyReview({ reviews, location, userId, locationId, identity }) {
  const legacyRows = await reviews.find({
    user_id: userId,
    organization_id: location.organization_id,
    client_id: location.client_id,
    location_id: locationId,
    provider: "google",
    provider_review_id: { $exists: false },
    provider_review_name: {
      $regex: `/locations/${identity.locationId}/reviews/${identity.reviewId}$`,
    },
  }).limit(2).toArray();
  if (legacyRows.length > 1) return false;
  if (legacyRows.length === 1) {
    try {
      await reviews.updateOne(
        { _id: legacyRows[0]._id, provider_review_id: { $exists: false } },
        { $set: {
          provider_review_id: identity.reviewId,
          provider_google_location_id: identity.locationId,
        } },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  return true;
}

async function updateSyncState(collection, filter, patch, timestamp, randomUUID) {
  await collection.updateOne(filter, {
    $set: { ...patch, updated_at: timestamp },
    $setOnInsert: { id: randomUUID(), created_at: timestamp },
  }, { upsert: true });
}

export async function runReviewSyncJob(job, {
  getCollection = col,
  getIntegration = getGoogleIntegrationById,
  ensureToken = ensureAccessToken,
  fetchReviews = listReviews,
  randomUUID = crypto.randomUUID,
  now = () => new Date(),
  logger = console,
} = {}) {
  const userId = String(job?.data?.userId || "");
  const locationId = String(job?.data?.locationId || "");
  const runId = String(job?.data?.runId || job?.id || "");
  if (!userId) throw new Error("missing_userId");
  if (!locationId) throw new Error("missing_locationId");

  const locations = await getCollection("locations");
  const location = await locations.findOne({ id: locationId, user_id: userId, provider: "google" });
  if (!location) throw new Error("location_not_found");

  const syncState = await getCollection("review_sync_state");
  const stateFilter = { user_id: location.user_id, location_id: location.id };
  const startedAt = now();
  await updateSyncState(syncState, stateFilter, {
    status: "running",
    last_job_id: String(job.id),
    last_run_id: runId,
    organization_id: location.organization_id,
    client_id: location.client_id,
    last_error: null,
    started_at: startedAt,
  }, startedAt, randomUUID);

  const counters = {
    fetched: 0,
    processed: 0,
    inserted: 0,
    matched: 0,
    modified: 0,
    unchanged: 0,
    pagesFetched: 0,
  };

  try {
    if (!location.integration_id) throw new Error("location_not_bound");
    const integration = await getIntegration(userId, location.integration_id);
    if (!integration) throw new Error("no_integration_for_location");
    const { access_token: accessToken } = await ensureToken(integration);
    const reviews = await getCollection("reviews");
    const operations = [];
    const replyOperations = [];
    const observedReviewIds = new Set();
    const seenPageTokens = new Set();
    const reportedTotals = new Set();
    let snapshotDiagnostic = null;

    const flush = async () => {
      if (!operations.length) return;
      const batch = operations.splice(0, operations.length);
      let result;
      try {
        result = await reviews.bulkWrite(batch, { ordered: false });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        const retryResults = [];
        for (const operation of batch) {
          const { filter, update } = operation.updateOne;
          retryResults.push(await reviews.updateOne(filter, update, { upsert: false }));
        }
        result = {
          upsertedCount: 0,
          matchedCount: retryResults.reduce((sum, item) => sum + Number(item?.matchedCount || 0), 0),
          modifiedCount: retryResults.reduce((sum, item) => sum + Number(item?.modifiedCount || 0), 0),
        };
      }
      const inserted = Number(result?.upsertedCount || 0);
      const matched = Number(result?.matchedCount || 0);
      const modified = Number(result?.modifiedCount || 0);
      counters.inserted += inserted;
      counters.matched += matched;
      counters.modified += modified;
      counters.unchanged += Math.max(0, matched - modified);
    };

    let pageToken = null;
    let supportsOrderBy = true;
    while (true) {
      const options = {
        pageSize: PAGE_SIZE,
        ...(supportsOrderBy ? { orderBy: "updateTime desc" } : {}),
        ...(pageToken ? { pageToken } : {}),
      };
      let data;
      try {
        data = await fetchReviews(
          location.provider_account_name,
          location.provider_location_name,
          accessToken,
          options,
        );
      } catch (error) {
        if (supportsOrderBy && isOrderByRejected(error)) {
          supportsOrderBy = false;
          logger.warn?.({ jobId: job.id }, "orderBy rejected by Google; retrying without orderBy");
          continue;
        }
        throw error;
      }

      counters.pagesFetched += 1;
      const pageReviews = Array.isArray(data?.reviews) ? data.reviews : [];
      const reportedTotal = providerTotalReviewCount(data);
      if (reportedTotal === null) snapshotDiagnostic ||= "invalid_total_review_count";
      if (reportedTotal !== null && reportedTotal !== undefined) reportedTotals.add(reportedTotal);
      counters.fetched += pageReviews.length;
      for (const review of pageReviews) {
        let identity;
        try {
          identity = validateGoogleReviewIdentity({
            reviewName: review?.name,
            providerLocationName: location.provider_location_name,
          });
        } catch (error) {
          snapshotDiagnostic ||= error?.message || "invalid_provider_review_name";
          continue;
        }
        if (observedReviewIds.has(identity.reviewId)) {
          snapshotDiagnostic ||= "duplicate_provider_review_id";
          continue;
        }
        observedReviewIds.add(identity.reviewId);
        const legacyReady = await promoteSingleLegacyReview({
          reviews, location, userId, locationId, identity,
        });
        if (!legacyReady) {
          snapshotDiagnostic ||= "ambiguous_legacy_review_identity";
          continue;
        }
        counters.processed += 1;
        const document = buildReviewSyncDocument({
          userId,
          locationId,
          location,
          review,
          updatedAt: providerTimestamp(review),
        });
        const providerReply = document.reviewReply;
        delete document.reviewReply;
        Object.assign(document, {
          provider_sync_status: "active",
          provider_last_seen_at: startedAt,
          provider_missing_since: null,
          provider_consecutive_misses: 0,
          provider_last_checked_at: startedAt,
          provider_last_observed_run_id: runId,
        });
        operations.push({
          updateOne: {
            filter: {
              ...canonicalReviewFilter({ userId, locationId, reviewId: identity.reviewId }),
            },
            update: {
              $set: document,
              $setOnInsert: {
                id: randomUUID(),
                created_at: startedAt,
                provider_first_seen_at: startedAt,
              },
            },
            upsert: true,
          },
        });
        replyOperations.push({
          filter: {
            user_id: userId,
            organization_id: location.organization_id,
            client_id: location.client_id,
            location_id: locationId,
            provider: "google",
            provider_review_id: identity.reviewId,
            $or: [
              { local_reply_updated_at: { $exists: false } },
              { local_reply_updated_at: { $lte: startedAt } },
            ],
          },
          update: { $set: { reviewReply: providerReply } },
        });
        if (operations.length >= BATCH_SIZE) await flush();
      }
      await flush();
      const nextPageToken = data?.nextPageToken || null;
      if (nextPageToken && seenPageTokens.has(nextPageToken)) {
        snapshotDiagnostic ||= "repeated_page_token";
        break;
      }
      if (nextPageToken) seenPageTokens.add(nextPageToken);
      pageToken = nextPageToken;
      if (!pageToken) break;
    }

    if (reportedTotals.size > 1) snapshotDiagnostic ||= "inconsistent_total_review_count";
    const [reportedTotal] = reportedTotals;
    if (reportedTotal !== undefined && reportedTotal !== observedReviewIds.size) {
      snapshotDiagnostic ||= "total_review_count_mismatch";
    }
    const snapshotComplete = !snapshotDiagnostic;

    if (observedReviewIds.size) {
      await reviews.updateMany(
        {
          user_id: userId,
          organization_id: location.organization_id,
          client_id: location.client_id,
          location_id: locationId,
          provider: "google",
          provider_review_id: { $in: [...observedReviewIds] },
          provider_first_seen_at: { $exists: false },
        },
        { $set: { provider_first_seen_at: startedAt } },
      );
    }
    for (const operation of replyOperations) {
      await reviews.updateOne(operation.filter, operation.update);
    }

    let absenceResult = { matchedCount: 0, modifiedCount: 0 };
    if (snapshotComplete) {
      absenceResult = await reviews.updateMany(
        {
          user_id: userId,
          organization_id: location.organization_id,
          client_id: location.client_id,
          location_id: locationId,
          provider: "google",
          $or: [
            { provider_review_id: { $type: "string", $nin: [...observedReviewIds] } },
            { provider_review_id: { $exists: false } },
          ],
          provider_last_missing_run_id: { $ne: runId },
        },
        buildAbsencePipeline({ observedAt: startedAt, runId }),
      );
    }

    const finishedAt = now();
    const completedState = {
      status: snapshotComplete ? "ok" : "incomplete",
      finished_at: finishedAt,
      last_error: snapshotComplete ? null : {
        code: "incomplete_review_snapshot",
        message: "Google review snapshot was incomplete",
        reason: snapshotDiagnostic,
      },
      last_fetched: counters.fetched,
      last_processed: counters.processed,
      last_inserted: counters.inserted,
      last_upserted: counters.inserted,
      last_matched: counters.matched,
      last_modified: counters.modified,
      last_unchanged: counters.unchanged,
      last_pages_fetched: counters.pagesFetched,
      last_snapshot_complete: snapshotComplete,
      last_snapshot_diagnostic: snapshotDiagnostic,
      last_snapshot_observation_run_id: runId,
      last_absence_reconciled: snapshotComplete,
      last_absence_matched: Number(absenceResult?.matchedCount || 0),
      last_absence_modified: Number(absenceResult?.modifiedCount || 0),
    };
    if (snapshotComplete) {
      completedState.last_synced_at = finishedAt;
      completedState.last_success_started_at = startedAt;
      completedState.last_absence_run_id = runId;
    }
    await updateSyncState(syncState, stateFilter, completedState, finishedAt, randomUUID);
    const result = {
      ok: true,
      ...counters,
      snapshotComplete,
      snapshotDiagnostic,
      absenceMatched: Number(absenceResult?.matchedCount || 0),
      absenceModified: Number(absenceResult?.modifiedCount || 0),
    };
    logger.info?.({ userId, locationId, jobId: job.id, ...counters }, "Review sync done");
    return result;
  } catch (error) {
    const failedAt = now();
    await updateSyncState(syncState, stateFilter, {
      status: "failed",
      finished_at: failedAt,
      last_error: safeError(error),
    }, failedAt, randomUUID);
    logger.error?.({ userId, locationId, jobId: job.id, err: safeError(error) }, "Review sync failed");
    throw error;
  }
}
