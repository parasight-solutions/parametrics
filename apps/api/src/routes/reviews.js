// apps/api/src/routes/reviews.js
import { Router } from "express";
import crypto from "crypto";

import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import { makeQueue } from "../lib/queues.js";
import { mutationRateLimit, syncRateLimit } from "../middleware/rateLimit.js";
import { getGoogleIntegrationById, ensureAccessToken } from "../integrations/google.store.js";
import { updateReviewReply } from "../integrations/google.js";
import {
  assertDocMatchesLocationScope,
  buildLocationScopeFilter,
  requireOwnedLocation,
  toApiError,
} from "../services/ownership.js";

const router = Router();
const reviewSyncQueue = makeQueue("review-sync");

async function getSyncStateForLocation(loc) {
  const c = await col("review_sync_state");
  return c.findOne(
    buildLocationScopeFilter(loc),
    { projection: { _id: 0 } }
  );
}

async function setSyncQueuedForLocation(loc, patch = {}) {
  const c = await col("review_sync_state");
  const now = new Date();

  await c.updateOne(
    buildLocationScopeFilter(loc),
    {
      $set: {
        status: "queued",
        last_error: null,
        queued_at: now,
        updated_at: now,
        ...patch,
      },
      $setOnInsert: {
        id: crypto.randomUUID(),
        created_at: now,
      },
    },
    { upsert: true }
  );
}

// GET /api/v1/reviews?locationId=...
router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locationId = String(req.query.locationId || req.query.location_id || "").trim();
    if (!locationId) {
      return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });
    }

    const loc = await requireOwnedLocation(userId, locationId, { provider: "google" });

    const c = await col("reviews");
    const rows = await c
      .find(
        buildLocationScopeFilter(loc, { provider: "google" }),
        { projection: { _id: 0 } }
      )
      .sort({ updateTime: -1, createTime: -1 })
      .limit(200)
      .toArray();

    const sync = await getSyncStateForLocation(loc);

    return res.json({ reviews: rows, sync: sync || null });
  } catch (e) {
    return toApiError(res, e);
  }
});

// POST /api/v1/reviews/sync  { locationId, force?: boolean }
router.post("/sync", authenticate, syncRateLimit, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locationId = String(req.body?.locationId || req.body?.location_id || "").trim();
    const force = Boolean(req.body?.force);

    if (!locationId) {
      return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });
    }

    const loc = await requireOwnedLocation(userId, locationId, { provider: "google" });

    if (!loc.integration_id) {
      return res.status(409).json({ error: { code: "location_not_bound" } });
    }

    const syncState = await getSyncStateForLocation(loc);

    const STALE_MS = 60 * 60 * 1000;
    const lastUpdMs = syncState?.updated_at ? new Date(syncState.updated_at).getTime() : 0;
    const isStale = !syncState || !lastUpdMs || (Date.now() - lastUpdMs) > STALE_MS;

    if (!force && !isStale && (syncState?.status === "running" || syncState?.status === "queued")) {
      return res.json({
        queued: true,
        alreadyRunning: true,
        jobId: syncState?.last_job_id || null,
        since: syncState?.since || null,
      });
    }

    const cursor = syncState?.last_success_started_at || syncState?.last_synced_at || null;
    const since = !force && cursor ? new Date(cursor).toISOString() : null;

    const jobId = `reviewSync_${userId}_${locationId}`;

    const job = await reviewSyncQueue.add(
      "sync-location-reviews",
      {
        userId,
        locationId,
        organizationId: loc.organization_id,
        clientId: loc.client_id,
        since,
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true,
      }
    );

    await setSyncQueuedForLocation(loc, {
      last_job_id: String(job.id),
      since,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
    });

    return res.json({ queued: true, jobId: String(job.id), since });
  } catch (e) {
    return toApiError(res, e);
  }
});

// PUT /api/v1/reviews/:id/reply { comment }
router.put("/:id/reply", authenticate, mutationRateLimit, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const id = String(req.params.id || "").trim();
    const comment = String(req.body?.comment || "").trim();

    if (!comment) {
      return res.status(400).json({ error: { code: "bad_request", message: "comment required" } });
    }

    const c = await col("reviews");
    const review = await c.findOne({ id, user_id: userId, provider: "google" });

    if (!review) {
      return res.status(404).json({ error: { code: "not_found", message: "review not found" } });
    }

    const loc = await requireOwnedLocation(userId, review.location_id, { provider: "google" });
    assertDocMatchesLocationScope(review, loc, "review");

    if (!loc.integration_id) {
      return res.status(409).json({ error: { code: "location_not_bound" } });
    }

    const integ = await getGoogleIntegrationById(userId, loc.integration_id);
    if (!integ) {
      return res.status(409).json({ error: { code: "no_integration_for_location" } });
    }

    const { access_token } = await ensureAccessToken(integ);

    await updateReviewReply(review.provider_review_name, comment, access_token);

    await c.updateOne(
      {
        id,
        user_id: userId,
        organization_id: loc.organization_id,
        client_id: loc.client_id,
        location_id: loc.id,
      },
      {
        $set: {
          reviewReply: { comment, updateTime: new Date().toISOString() },
          updated_at: new Date(),
        },
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    return toApiError(res, e);
  }
});

export default router;
