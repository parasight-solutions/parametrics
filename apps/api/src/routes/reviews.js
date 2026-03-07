// apps/api/src/routes/reviews.js
import { Router } from "express";
import crypto from "crypto";

import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import { makeQueue } from "../lib/queues.js";
import { getGoogleIntegrationById, ensureAccessToken } from "../integrations/google.store.js";
import { updateReviewReply } from "../integrations/google.js";

const router = Router();
const reviewSyncQueue = makeQueue("review-sync");

async function getSyncState(userId, locationId) {
  const c = await col("review_sync_state");
  return c.findOne({ user_id: userId, location_id: locationId }, { projection: { _id: 0 } });
}

async function setSyncQueued(userId, locationId, patch = {}) {
  const c = await col("review_sync_state");
  const now = new Date();
  await c.updateOne(
    { user_id: userId, location_id: locationId },
    {
      $set: {
        status: "queued",
        last_error: null,
        queued_at: now,
        updated_at: now,
        ...patch,
      },
      $setOnInsert: { id: crypto.randomUUID(), created_at: now },
    },
    { upsert: true }
  );
}

// GET /api/v1/reviews?locationId=...
router.get("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const locationId = String(req.query.locationId || req.query.location_id || "").trim();
  if (!locationId) return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });

  const c = await col("reviews");
  const rows = await c
    .find({ user_id: userId, location_id: locationId, provider: "google" }, { projection: { _id: 0 } })
    .sort({ updateTime: -1, createTime: -1 })
    .limit(200)
    .toArray();

  const sync = await getSyncState(userId, locationId);

  res.json({ reviews: rows, sync: sync || null });
});

// POST /api/v1/reviews/sync  { locationId, force?: boolean }
router.post("/sync", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const locationId = String(req.body?.locationId || req.body?.location_id || "").trim();
  const force = Boolean(req.body?.force);

  if (!locationId) return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });

  const locations = await col("locations");
  const loc = await locations.findOne({ id: locationId, user_id: userId, provider: "google" });
  if (!loc) return res.status(404).json({ error: { code: "not_found", message: "location not found" } });
  if (!loc.integration_id) return res.status(409).json({ error: { code: "location_not_bound" } });

  const syncState = await getSyncState(userId, locationId);

  // ✅ compute staleness BEFORE using it
  const STALE_MS = 60 * 60 * 1000; // 60 min
  const lastUpdMs = syncState?.updated_at ? new Date(syncState.updated_at).getTime() : 0;
  const isStale = !syncState || !lastUpdMs || (Date.now() - lastUpdMs) > STALE_MS;

  // If already running/queued and not stale, don’t enqueue again
  if (!force && !isStale && (syncState?.status === "running" || syncState?.status === "queued")) {
    return res.json({
      queued: true,
      alreadyRunning: true,
      jobId: syncState?.last_job_id || null,
      since: syncState?.since || null,
    });
  }

  // Cursor for incremental sync (safe cursor: last_success_started_at)
  const cursor = syncState?.last_success_started_at || syncState?.last_synced_at || null;
  const since = !force && cursor ? new Date(cursor).toISOString() : null;

  const jobId = `reviewSync_${userId}_${locationId}`;

  const job = await reviewSyncQueue.add(
    "sync-location-reviews",
    { userId, locationId, since },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  await setSyncQueued(userId, locationId, {
    last_job_id: String(job.id),
    since,
  });

  res.json({ queued: true, jobId: String(job.id), since });
});

// PUT /api/v1/reviews/:id/reply { comment }
router.put("/:id/reply", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const id = String(req.params.id || "").trim();
  const comment = String(req.body?.comment || "").trim();

  if (!comment) return res.status(400).json({ error: { code: "bad_request", message: "comment required" } });

  const c = await col("reviews");
  const review = await c.findOne({ id, user_id: userId, provider: "google" });
  if (!review) return res.status(404).json({ error: { code: "not_found", message: "review not found" } });

  const locations = await col("locations");
  const loc = await locations.findOne({ id: review.location_id, user_id: userId, provider: "google" });
  if (!loc) return res.status(404).json({ error: { code: "not_found", message: "location not found" } });
  if (!loc.integration_id) return res.status(409).json({ error: { code: "location_not_bound" } });

  const integ = await getGoogleIntegrationById(userId, loc.integration_id);
  if (!integ) return res.status(409).json({ error: { code: "no_integration_for_location" } });

  const { access_token } = await ensureAccessToken(integ);

  // correct arg order: (reviewName, comment, accessToken)
  await updateReviewReply(review.provider_review_name, comment, access_token);

  await c.updateOne(
    { id, user_id: userId },
    {
      $set: {
        reviewReply: { comment, updateTime: new Date().toISOString() },
        updated_at: new Date(),
      },
    }
  );

  res.json({ ok: true });
});

export default router;
