// apps/api/src/routes/posts.js
import { Router } from "express";
import crypto from "crypto";
import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import {
  getActiveGoogleIntegration,
  getGoogleIntegrationById,
  ensureAccessToken,
} from "../integrations/google.store.js";
import { createLocalPost, listAccounts, listLocalPosts } from "../integrations/google.js";
import { makeQueue } from "../lib/queues.js";

const router = Router();
const publishQueue = makeQueue("post-publish");
const PUBLISH_JOB_ID = (postId) => `publish_${postId}`;

// Remove any existing job for a post (waiting/delayed/active/etc)
async function removePublishJob(postId) {
  const jobId = PUBLISH_JOB_ID(postId);
  const j = await publishQueue.getJob(jobId);
  if (j) {
    try { await j.remove(); } catch { }
  }
}

// Enqueue immediate publish (NO delay; scheduled publishes are handled by jobs/scheduler.js)
async function enqueuePublishNow({ postId, userId, reason = "manual-publish" }) {
  const jobId = PUBLISH_JOB_ID(postId);

  // replace existing if any
  const existing = await publishQueue.getJob(jobId);
  if (existing) {
    try { await existing.remove(); } catch { }
  }

  await publishQueue.add(
    reason,
    { postId, userId },
    {
      jobId,
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    }
  );
}


function normalizeCreateBody(body = {}) {
  const locationId = body.locationId || body.location_id || body.location || "";
  const summary = body.summary || body.text || "";

  const imageUrl = body.imageUrl || body.image_url || null;

  const callToActionUrl = body.callToActionUrl || body.call_to_action_url || null;
  const callToActionType = body.callToActionType || body.call_to_action_type || null;

  const languageCode = body.languageCode || body.language_code || null;
  const topicType = body.topicType || body.topic_type || null;

  const scheduleAt = body.scheduleAt || body.scheduled_at || null;
  const publishNow =
    typeof body.publishNow === "boolean" ? body.publishNow : !scheduleAt;

  return {
    locationId: String(locationId || ""),
    summary: String(summary || "").trim(),

    imageUrl: imageUrl ? String(imageUrl) : null,

    callToActionUrl: callToActionUrl ? String(callToActionUrl) : null,
    callToActionType: callToActionType ? String(callToActionType).trim() : null,

    languageCode: languageCode ? String(languageCode).trim() : null,
    topicType: topicType ? String(topicType).trim().toUpperCase() : null,

    publishNow,
    scheduleAt: scheduleAt ? new Date(scheduleAt) : null,
  };
}

function safeErrString(e) {
  if (!e) return "publish_failed";
  if (typeof e === "string") return e;
  const out = {
    message: e.message || "google_error",
    status: e.status || undefined,
    body: e.body || undefined,
  };
  try {
    return JSON.stringify(out);
  } catch {
    return out.message;
  }
}

async function assertLocationAccessible(accessToken, loc) {
  // If this token can’t see the account, posting will 404.
  const acc = String(loc?.provider_account_name || "").trim();
  if (!acc) throw new Error("location_missing_account_name");

  const data = await listAccounts(accessToken);
  const ok = (data?.accounts || []).some((a) => a?.name === acc);

  if (!ok) {
    const e = new Error("account_mismatch");
    e.code = "account_mismatch";
    e.data = { requiredAccount: acc };
    throw e;
  }
}

async function mapLocationsById(userId, locationIds) {
  const ids = Array.from(new Set((locationIds || []).filter(Boolean)));
  if (!ids.length) return new Map();

  const locations = await col("locations");
  const rows = await locations
    .find(
      { user_id: userId, id: { $in: ids } },
      {
        projection: {
          _id: 0,
          id: 1,
          title: 1,
          name: 1,
          provider_location_name: 1,
          provider_account_name: 1,
          integration_id: 1,
        },
      }
    )
    .toArray();

  const m = new Map();
  for (const r of rows) {
    m.set(r.id, {
      id: r.id,
      title: r.title || r.name || r.provider_location_name || r.id,
      provider_account_name: r.provider_account_name || null,
      provider_location_name: r.provider_location_name || null,
      integration_id: r.integration_id || null,
    });
  }
  return m;
}

/**
 * Worker entrypoint: publish a post immediately.
 * Exported because workers import it.
 */
export async function publishPostNow(postId) {
  const posts = await col("posts");
  const locations = await col("locations");

  const post = await posts.findOne({ id: postId });
  if (!post) throw new Error("post_not_found");
  if (post.status === "published") return { name: post.provider_post_name || null };

  const loc = await locations.findOne({
    id: post.location_id,
    user_id: post.user_id,
    provider: "google",
  });
  if (!loc) throw new Error("location_not_found");

  // Back-compat for older posts: if integration_id not on post, try loc.integration_id
  const integrationId = loc.integration_id || post.integration_id;
  if (!integrationId) throw new Error("post_location_not_bound");

  const integ = await getGoogleIntegrationById(post.user_id, integrationId);
  if (!integ) throw new Error("no_integration_for_post");

  const { access_token } = await ensureAccessToken(integ);

  // Snapshot fields preferred; fallback to location doc for legacy posts
  const providerAccount = loc.provider_account_name || post.provider_account_name;
  const providerLocation = loc.provider_location_name || post.provider_location_name;
  if (!providerAccount || !providerLocation) throw new Error("post_missing_provider_refs");

  // mark publishing
  await posts.updateOne(
    { id: postId, user_id: post.user_id },
    { $set: { status: "publishing", updated_at: new Date() } }
  );

  try {
    // GBP LocalPost requires topicType. Media items must use sourceUrl. :contentReference[oaicite:4]{index=4}
    const topicType =
      post.topic_type ||
      post.topicType ||
      "STANDARD";

    const languageCode =
      post.language_code ||
      post.languageCode ||
      "en-US";

    const payload = {
      summary: post.summary,
      languageCode,
      topicType,
    };

    // Optional media (only sourceUrl is supported for LocalPost MediaItem) :contentReference[oaicite:5]{index=5}
    if (post.image_url) {
      payload.media = [{ sourceUrl: post.image_url }];
    }

    // Optional CTA :contentReference[oaicite:6]{index=6}
    // Note: for CALL actionType, URL should be unset (GBP ignores/complains depending on behavior).
    if (post.call_to_action_type) {
      const actionType = String(post.call_to_action_type).trim().toUpperCase();
      const cta = { actionType };

      if (actionType !== "CALL" && post.call_to_action_url) {
        cta.url = post.call_to_action_url;
      }

      payload.callToAction = cta;
    } else if (post.call_to_action_url) {
      // Default CTA if user only gave URL
      payload.callToAction = { actionType: "LEARN_MORE", url: post.call_to_action_url };
    }

    const created = await createLocalPost(
      access_token,
      providerAccount,
      providerLocation,
      payload
    );

    await posts.updateOne(
      { id: postId, user_id: post.user_id },
      {
        $set: {
          status: "published",
          provider_post_name: created?.name || null,
          provider_error: null,
          updated_at: new Date(),
        },
        $unset: {
          provider_error_detail: "",
        },
      }
    );

    return created;
  } catch (e) {
    // ✅ Do NOT mark failed here — BullMQ may retry.
    // The worker is the single source of truth for retry/failed states + error details.
    throw e;
  }
}

// GET /api/v1/posts?locationId=...  (optional)
router.get("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const locationId = (req.query.locationId || req.query.location_id || "")
    .toString()
    .trim();

  const q = { user_id: userId };
  if (locationId) q.location_id = locationId;

  const postsCol = await col("posts");
  const rows = await postsCol.find(q).sort({ created_at: -1 }).toArray();

  const locMap = await mapLocationsById(userId, rows.map((r) => r.location_id));

  const posts = rows.map((p) => {
    const loc = locMap.get(p.location_id) || null;
    return {
      id: p.id,
      user_id: p.user_id,
      location_id: p.location_id,
      location: loc ? { id: loc.id, title: loc.title } : { id: p.location_id, title: p.location_id },

      summary: p.summary,
      image_url: p.image_url || null,
      call_to_action_url: p.call_to_action_url || null,

      status: p.status,
      scheduled_at: p.scheduled_at || null,

      // NEW: expose integration_id to UI
      integration_id: p.integration_id || null,

      provider_post_name: p.provider_post_name || null,
      provider_error: p.provider_error || null,

      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  });

  res.json({ posts });
});

// GET /api/v1/posts/provider?locationId=...
// Fetches posts directly from Google for that location (verification/debug)
router.get("/provider", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const locationId = String(req.query.locationId || "").trim();
  if (!locationId) {
    return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });
  }

  const locations = await col("locations");
  const loc = await locations.findOne({ id: locationId, user_id: userId, provider: "google" });
  if (!loc) return res.status(404).json({ error: { code: "not_found", message: "location not found" } });

  const integrationId = loc.integration_id;
  if (!integrationId) return res.status(409).json({ error: { code: "location_not_bound" } });

  const integ = await getGoogleIntegrationById(userId, integrationId);
  if (!integ) return res.status(409).json({ error: { code: "no_integration_for_location" } });

  const { access_token } = await ensureAccessToken(integ);

  const data = await listLocalPosts(access_token, loc.provider_account_name, loc.provider_location_name, { pageSize: 20 });

  return res.json({ provider_posts: data?.localPosts || [], nextPageToken: data?.nextPageToken || null });
});

router.post("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const b = normalizeCreateBody(req.body);

  // Validate scheduleAt if present
  if (!b.publishNow && b.scheduleAt) {
    if (Number.isNaN(b.scheduleAt.getTime())) {
      return res.status(400).json({
        error: { code: "bad_request", message: "invalid scheduleAt" },
      });
    }
  }

  if (!b.locationId) {
    return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });
  }
  if (!b.summary) {
    return res.status(400).json({ error: { code: "bad_request", message: "summary required" } });
  }

  const locations = await col("locations");
  const loc = await locations.findOne({ id: b.locationId, user_id: userId, provider: "google" });
  if (!loc) {
    return res.status(404).json({ error: { code: "not_found", message: "location not found" } });
  }
  if (!loc.integration_id) {
    return res.status(409).json({
      error: {
        code: "location_not_bound",
        message:
          "This location is not bound to a Google connection. Re-import locations after connecting Google.",
      },
    });
  }

  // Deterministic: validate using the integration that OWNS the location (not “active integration”)
  try {
    const integ = await getGoogleIntegrationById(userId, loc.integration_id);
    if (!integ) {
      return res.status(409).json({
        error: { code: "no_integration_for_location", message: "Google connection for this location not found" },
      });
    }

    const tokenObj = await ensureAccessToken(integ);
    const accessToken = tokenObj?.access_token || tokenObj?.accessToken || tokenObj;

    await assertLocationAccessible(accessToken, loc);
  } catch (e) {
    if (e?.code === "account_mismatch") {
      return res.status(409).json({
        error: {
          code: "account_mismatch",
          message:
            "This location belongs to a different Google account. Switch connection and re-import locations.",
          data: e.data || null,
        },
      });
    }
    return res.status(500).json({ error: { code: "server_error", message: e?.message || "server_error" } });
  }

  const id = crypto.randomUUID();
  const now = new Date();

  const doc = {
    id,
    user_id: userId,
    location_id: loc.id,

    // NEW: snapshot bind so scheduled jobs never depend on “active integration”
    integration_id: loc.integration_id,
    provider_account_name: loc.provider_account_name || null,
    provider_location_name: loc.provider_location_name || null,

    summary: b.summary,
    image_url: b.imageUrl,
    call_to_action_url: b.callToActionUrl,
    topic_type: b.topicType || "STANDARD",
    language_code: b.languageCode || "en-US",
    call_to_action_type: b.callToActionType || null,

    status: b.publishNow ? "queued" : "scheduled",
    scheduled_at: b.publishNow ? null : b.scheduleAt,
    // ✅ Manual posts are not AI-generated, so treat them as ready
    ai_status: "done",
    ai_error: null,
    ai_generated_at: now,

    provider_post_name: null,
    provider_error: null,

    created_at: now,
    updated_at: now,
  };

  await (await col("posts")).insertOne(doc);

  if (b.publishNow) {
    await enqueuePublishNow({ postId: id, userId, reason: "manual-publish" });
  } else {
    // Scheduled posts are picked by apps/api/src/jobs/scheduler.js when due.
    // Defensive: remove any legacy delayed job that may exist from older code.
    await removePublishJob(id);
  }

  return res.json({
    post: {
      ...doc,
      location: { id: loc.id, title: loc.title || loc.name || loc.provider_location_name || loc.id },
    },
  });
});

// Edit post (summary + schedule/publish)
router.patch("/:id", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const id = String(req.params.id || "");
  const posts = await col("posts");

  const post = await posts.findOne({ id, user_id: userId });
  if (!post) return res.status(404).json({ error: { code: "not_found", message: "post not found" } });

  if (post.status === "publishing") {
    return res.status(409).json({ error: { code: "conflict", message: "post is publishing; cannot edit now" } });
  }

  if (post.status === "published") {
    return res.status(409).json({ error: { code: "conflict", message: "published posts cannot be edited" } });
  }

  const body = req.body || {};
  const summary = body.summary ?? body.text;
  const publishNow = typeof body.publishNow === "boolean" ? body.publishNow : undefined;
  const scheduleAtRaw = body.scheduleAt ?? body.scheduled_at;

  const $set = { updated_at: new Date() };

  if (typeof summary === "string") $set.summary = summary.trim();

  let enqueue = false;

  if (publishNow === true) {
    $set.status = "queued";
    $set.scheduled_at = null;
    $set.provider_error = null;
    enqueue = true;
  } else if (scheduleAtRaw !== undefined) {
    if (scheduleAtRaw) {
      const dt = new Date(scheduleAtRaw);
      if (Number.isNaN(dt.getTime())) {
        return res.status(400).json({ error: { code: "bad_request", message: "invalid scheduleAt" } });
      }
      $set.status = "scheduled";
      $set.scheduled_at = dt;
    } else {
      $set.status = "queued";
      $set.scheduled_at = null;
      $set.provider_error = null;
      enqueue = true;
    }
  }

  await posts.updateOne({ id, user_id: userId }, { $set });

  const updated = await posts.findOne({ id, user_id: userId }, { projection: { _id: 0 } });

  // Keep queue in sync with DB state
  // Keep queue in sync with DB state (scheduler owns scheduled publishing)
  if (updated.status === "queued") {
    await enqueuePublishNow({ postId: id, userId, reason: "edit-publish" });
  } else {
    // scheduled/failed/etc should not have a waiting publish job
    await removePublishJob(id);
  }

  return res.json({ post: updated });
});

// Retry failed post
router.post("/:id/retry", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const id = String(req.params.id || "");
  const posts = await col("posts");

  const post = await posts.findOne({ id, user_id: userId });
  if (!post) return res.status(404).json({ error: { code: "not_found", message: "post not found" } });

  if (post.status !== "failed") {
    return res.status(409).json({ error: { code: "conflict", message: "only failed posts can be retried" } });
  }

  const locations = await col("locations");
  const loc = await locations.findOne({ id: post.location_id, user_id: userId, provider: "google" });

  // Rebind to latest provider refs (fixes old posts created before re-import / wrong connection)
  const rebind = {};
  if (loc?.integration_id) rebind.integration_id = loc.integration_id;
  if (loc?.provider_account_name) rebind.provider_account_name = loc.provider_account_name;
  if (loc?.provider_location_name) rebind.provider_location_name = loc.provider_location_name;

  // Ensure required defaults exist for older docs
  if (!post.topic_type) rebind.topic_type = "STANDARD";
  if (!post.language_code) rebind.language_code = "en-US";

  await posts.updateOne(
    { id, user_id: userId },
    {
      $set: {
        status: "queued",
        provider_error: null,
        updated_at: new Date(),
        ...rebind,
      },
      $unset: {
        provider_error_detail: "",
      },
    }
  );

  await enqueuePublishNow({ postId: id, userId, reason: "manual-retry" });

  return res.json({ ok: true });
});

router.delete("/:id", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const id = String(req.params.id || "");

  await removePublishJob(id);
  await (await col("posts")).deleteOne({ id, user_id: userId });

  res.json({ ok: true });
});

export default router;
