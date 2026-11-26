import crypto from "node:crypto";

import { col } from "../lib/mongo.js";
import { listReviews } from "../integrations/google.js";
import { ensureAccessToken, getGoogleIntegrationById } from "../integrations/google.store.js";
import { buildReviewSyncDocument } from "./reviewSyncDocument.js";

const BATCH_SIZE = 200;
const PAGE_SIZE = 50;

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

    const flush = async () => {
      if (!operations.length) return;
      const batch = operations.splice(0, operations.length);
      const result = await reviews.bulkWrite(batch, { ordered: false });
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
      counters.fetched += pageReviews.length;
      for (const review of pageReviews) {
        if (!review?.name) continue;
        counters.processed += 1;
        operations.push({
          updateOne: {
            filter: {
              user_id: userId,
              location_id: locationId,
              provider_review_name: review.name,
            },
            update: {
              $set: buildReviewSyncDocument({
                userId,
                locationId,
                location,
                review,
                updatedAt: providerTimestamp(review),
              }),
              $setOnInsert: { id: randomUUID(), created_at: startedAt },
            },
            upsert: true,
          },
        });
        if (operations.length >= BATCH_SIZE) await flush();
      }
      await flush();
      pageToken = data?.nextPageToken || null;
      if (!pageToken) break;
    }

    const finishedAt = now();
    await updateSyncState(syncState, stateFilter, {
      status: "ok",
      finished_at: finishedAt,
      last_error: null,
      last_fetched: counters.fetched,
      last_processed: counters.processed,
      last_inserted: counters.inserted,
      last_upserted: counters.inserted,
      last_matched: counters.matched,
      last_modified: counters.modified,
      last_unchanged: counters.unchanged,
      last_pages_fetched: counters.pagesFetched,
      last_synced_at: finishedAt,
      last_success_started_at: startedAt,
    }, finishedAt, randomUUID);
    const result = { ok: true, ...counters };
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
