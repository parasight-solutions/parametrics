// apps/api/src/workers/reviewSync.worker.js
import "dotenv/config";
import { Worker } from "bullmq";
import pino from "pino";
import crypto from "crypto";

import { connection } from "../lib/queues.js";
import { col } from "../lib/mongo.js";
import { getGoogleIntegrationById, ensureAccessToken } from "../integrations/google.store.js";
import { listReviews } from "../integrations/google.js";

const log = pino({ name: "reviewSync" });

function safeErr(e) {
  return {
    message: e?.message || "review_sync_failed",
    status: e?.status || null,
    body: e?.body || null,
  };
}

function isOrderByRejected(err) {
  if (!err) return false;
  if (err.message !== "google_http_error") return false;
  if (err.status !== 400) return false;

  const raw = JSON.stringify(err.body || {});
  // google usually mentions "orderBy" or invalid argument somewhere
  return raw.toLowerCase().includes("orderby") || raw.toLowerCase().includes("order by");
}

async function upsertSyncState(userId, locationId, patch) {
  const c = await col("review_sync_state");
  const now = new Date();
  await c.updateOne(
    { user_id: userId, location_id: locationId },
    {
      $set: { ...patch, updated_at: now },
      $setOnInsert: { id: crypto.randomUUID(), created_at: now },
    },
    { upsert: true }
  );
}

export const reviewSyncWorker = new Worker(
  "review-sync",
  async (job) => {
    const userId = String(job.data?.userId || "");
    const locationId = String(job.data?.locationId || "");
    const sinceRaw = job.data?.since || null;

    if (!userId) throw new Error("missing_userId");
    if (!locationId) throw new Error("missing_locationId");

    const since = sinceRaw ? new Date(sinceRaw) : null;
    if (since && Number.isNaN(since.getTime())) throw new Error("invalid_since");

    const startedAt = new Date();

    log.info({ userId, locationId, since: sinceRaw, jobId: job.id }, "Review sync start");

    await upsertSyncState(userId, locationId, {
      status: "running",
      last_job_id: String(job.id),
      last_error: null,
      started_at: startedAt,
    });

    // bind via location.integration_id (multi-account safe)
    const locations = await col("locations");
    const loc = await locations.findOne({ id: locationId, user_id: userId, provider: "google" });
    if (!loc) throw new Error("location_not_found");
    if (!loc.integration_id) throw new Error("location_not_bound");

    const integ = await getGoogleIntegrationById(userId, loc.integration_id);
    if (!integ) throw new Error("no_integration_for_location");

    const { access_token } = await ensureAccessToken(integ);

    const reviewsCol = await col("reviews");

    let pageToken = null;
    let fetched = 0;
    let upserted = 0;

    let supportsOrderBy = true;
    let stopEarlyAllowed = true; // only true when orderBy works

    const pageSize = 50;

    const ops = [];
    const flush = async () => {
      if (!ops.length) return;
      const res = await reviewsCol.bulkWrite(ops, { ordered: false });
      // res.upsertedCount counts inserts; modifiedCount counts updates (not reliable for full count)
      ops.length = 0;
      return res;
    };

    while (true) {
      let data;

      const opts = {
        pageSize,
        ...(supportsOrderBy ? { orderBy: "updateTime desc" } : {}),
        ...(pageToken ? { pageToken } : {}),
      };

      try {
        data = await listReviews(loc.provider_account_name, loc.provider_location_name, access_token, opts);
      } catch (err) {
        if (supportsOrderBy && isOrderByRejected(err)) {
          // fallback: retry without orderBy, and disable early-stop
          log.warn({ jobId: job.id }, "orderBy rejected by Google; retrying without orderBy");
          supportsOrderBy = false;
          stopEarlyAllowed = false;
          continue;
        }
        throw err;
      }

      const list = data?.reviews || [];
      fetched += list.length;

      let stopEarly = false;

      for (const r of list) {
        const provider_review_name = r?.name || null;
        if (!provider_review_name) continue;

        const updateTime = r?.updateTime || null;

        // Early stop only when we are confident ordering is newest->oldest
        if (since && stopEarlyAllowed && updateTime) {
          const ut = new Date(updateTime);
          if (!Number.isNaN(ut.getTime()) && ut < since) {
            stopEarly = true;
            break;
          }
        }

        const doc = {
          user_id: userId,
          location_id: locationId,
          provider: "google",

          integration_id: loc.integration_id,
          provider_account_name: loc.provider_account_name || null,
          provider_location_name: loc.provider_location_name || null,

          provider_review_name,
          starRating: r?.starRating || null,
          comment: r?.comment || null,
          reviewer: r?.reviewer || null,
          createTime: r?.createTime || null,
          updateTime: r?.updateTime || null,
          reviewReply: r?.reviewReply || null,

          updated_at: new Date(),
        };

        ops.push({
          updateOne: {
            filter: { user_id: userId, location_id: locationId, provider_review_name },
            update: {
              $set: doc,
              $setOnInsert: { id: crypto.randomUUID(), created_at: new Date() },
            },
            upsert: true,
          },
        });

        upserted++;
        if (ops.length >= 200) await flush();
      }

      await flush();

      if (stopEarly) break;

      pageToken = data?.nextPageToken || null;
      if (!pageToken) break;
    }

    const finishedAt = new Date();

    // IMPORTANT: cursor for next incremental sync should be the START time of this successful run
    await upsertSyncState(userId, locationId, {
      status: "ok",
      finished_at: finishedAt,
      last_error: null,
      last_fetched: fetched,
      last_upserted: upserted,

      last_synced_at: finishedAt,                 // display only
      last_success_started_at: startedAt,         // cursor for next run (prevents missing mid-run updates)
    });

    log.info({ userId, locationId, fetched, upserted, jobId: job.id }, "Review sync done");
    return { ok: true, fetched, upserted };
  },
  { connection, concurrency: 2 }
);

reviewSyncWorker.on("failed", async (job, err) => {
  const userId = String(job?.data?.userId || "");
  const locationId = String(job?.data?.locationId || "");
  const picked = safeErr(err);

  log.error({ userId, locationId, jobId: job?.id, err: picked }, "Review sync failed");

  if (userId && locationId) {
    await upsertSyncState(userId, locationId, {
      status: "failed",
      finished_at: new Date(),
      last_error: picked,
    });
  }
});
