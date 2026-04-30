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
import { generationRateLimit, mutationRateLimit, syncRateLimit } from "../middleware/rateLimit.js";
import {
  assertDocMatchesLocationScope,
  requireOwnedLocation,
  toApiError,
} from "../services/ownership.js";
import { auditQueued, auditSuccess } from "../services/auditLog.js";

const router = Router();
const publishQueue = makeQueue("post-publish");
const PUBLISH_JOB_ID = (postId) => `publish_${postId}`;

async function removePublishJob(postId) {
  const jobId = PUBLISH_JOB_ID(postId);
  const j = await publishQueue.getJob(jobId);
  if (j) {
    try { await j.remove(); } catch { }
  }
}

async function enqueuePublishNow({ postId, userId, reason = "manual-publish" }) {
  const jobId = PUBLISH_JOB_ID(postId);

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

async function assertLocationAccessible(accessToken, loc) {
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
          organization_id: 1,
          client_id: 1,
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
      organization_id: r.organization_id || null,
      client_id: r.client_id || null,
    });
  }
  return m;
}

export async function publishPostNow(postId) {
  const posts = await col("posts");

  const post = await posts.findOne({ id: postId });
  if (!post) throw new Error("post_not_found");
  if (post.status === "published") return { name: post.provider_post_name || null };

  const loc = await requireOwnedLocation(post.user_id, post.location_id, { provider: "google" });
  assertDocMatchesLocationScope(post, loc, "post");

  const integrationId = loc.integration_id || post.integration_id;
  if (!integrationId) throw new Error("post_location_not_bound");

  const integ = await getGoogleIntegrationById(post.user_id, integrationId);
  if (!integ) throw new Error("no_integration_for_post");

  const { access_token } = await ensureAccessToken(integ);

  const providerAccount = loc.provider_account_name || post.provider_account_name;
  const providerLocation = loc.provider_location_name || post.provider_location_name;
  if (!providerAccount || !providerLocation) throw new Error("post_missing_provider_refs");

  const postScope = {
    id: postId,
    user_id: post.user_id,
    organization_id: loc.organization_id,
    client_id: loc.client_id,
    location_id: loc.id,
  };

  await posts.updateOne(
    postScope,
    { $set: { status: "publishing", updated_at: new Date() } }
  );

  try {
    const topicType = post.topic_type || post.topicType || "STANDARD";
    const languageCode = post.language_code || post.languageCode || "en-US";

    const payload = {
      summary: post.summary,
      languageCode,
      topicType,
    };

    if (post.image_url) {
      payload.media = [{ sourceUrl: post.image_url }];
    }

    if (post.call_to_action_type) {
      const actionType = String(post.call_to_action_type).trim().toUpperCase();
      const cta = { actionType };

      if (actionType !== "CALL" && post.call_to_action_url) {
        cta.url = post.call_to_action_url;
      }

      payload.callToAction = cta;
    } else if (post.call_to_action_url) {
      payload.callToAction = { actionType: "LEARN_MORE", url: post.call_to_action_url };
    }

    const created = await createLocalPost(
      access_token,
      providerAccount,
      providerLocation,
      payload
    );

    await posts.updateOne(
      postScope,
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
    throw e;
  }
}

router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locationId = (req.query.locationId || req.query.location_id || "")
      .toString()
      .trim();

    const postsCol = await col("posts");
    let q = { user_id: userId };

    if (locationId) {
      const loc = await requireOwnedLocation(userId, locationId, { provider: "google" });
      q = {
        user_id: userId,
        organization_id: loc.organization_id,
        client_id: loc.client_id,
        location_id: loc.id,
      };
    }

    const rows = await postsCol.find(q).sort({ created_at: -1 }).toArray();
    const locMap = await mapLocationsById(userId, rows.map((r) => r.location_id));

    const posts = rows.map((p) => {
      const loc = locMap.get(p.location_id) || null;
      return {
        id: p.id,
        user_id: p.user_id,
        organization_id: p.organization_id || null,
        client_id: p.client_id || null,
        location_id: p.location_id,
        location: loc
          ? { id: loc.id, title: loc.title }
          : { id: p.location_id, title: p.location_id },
        summary: p.summary,
        image_url: p.image_url || null,
        call_to_action_url: p.call_to_action_url || null,
        status: p.status,
        scheduled_at: p.scheduled_at || null,
        integration_id: p.integration_id || null,
        provider_post_name: p.provider_post_name || null,
        provider_error: p.provider_error || null,
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    });

    return res.json({ posts });
  } catch (e) {
    return toApiError(res, e);
  }
});

router.get("/provider", authenticate, syncRateLimit, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locationId = String(req.query.locationId || "").trim();
    if (!locationId) {
      return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });
    }

    const loc = await requireOwnedLocation(userId, locationId, { provider: "google" });

    const integrationId = loc.integration_id;
    if (!integrationId) {
      return res.status(409).json({ error: { code: "location_not_bound" } });
    }

    const integ = await getGoogleIntegrationById(userId, integrationId);
    if (!integ) {
      return res.status(409).json({ error: { code: "no_integration_for_location" } });
    }

    const { access_token } = await ensureAccessToken(integ);
    const data = await listLocalPosts(access_token, loc.provider_account_name, loc.provider_location_name, { pageSize: 20 });

    return res.json({ provider_posts: data?.localPosts || [], nextPageToken: data?.nextPageToken || null });
  } catch (e) {
    return toApiError(res, e);
  }
});

router.post("/", authenticate, generationRateLimit, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const b = normalizeCreateBody(req.body);

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

    const loc = await requireOwnedLocation(userId, b.locationId, { provider: "google" });
    if (!loc.integration_id) {
      return res.status(409).json({
        error: {
          code: "location_not_bound",
          message:
            "This location is not bound to a Google connection. Re-import locations after connecting Google.",
        },
      });
    }

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
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
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
      await auditQueued(req, "post.publish.queue", {
        target_type: "post",
        target_id: id,
        organization_id: loc.organization_id,
        client_id: loc.client_id,
        location_id: loc.id,
        provider: "google",
        metadata: { reason: "manual-publish" },
      });
    } else {
      await removePublishJob(id);
    }

    await auditSuccess(req, "post.create", {
      target_type: "post",
      target_id: id,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
      provider: "google",
      metadata: { status: doc.status, publishNow: b.publishNow },
    });

    return res.json({
      post: {
        ...doc,
        location: { id: loc.id, title: loc.title || loc.name || loc.provider_location_name || loc.id },
      },
    });
  } catch (e) {
    return toApiError(res, e);
  }
});

router.patch("/:id", authenticate, generationRateLimit, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const id = String(req.params.id || "");
    const posts = await col("posts");

    const post = await posts.findOne({ id, user_id: userId });
    if (!post) {
      return res.status(404).json({ error: { code: "not_found", message: "post not found" } });
    }

    const loc = await requireOwnedLocation(userId, post.location_id, { provider: "google" });
    assertDocMatchesLocationScope(post, loc, "post");

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

    const postScope = {
      id,
      user_id: userId,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
    };

    await posts.updateOne(postScope, { $set });

    const updated = await posts.findOne(postScope, { projection: { _id: 0 } });

    if (updated.status === "queued") {
      await enqueuePublishNow({ postId: id, userId, reason: "edit-publish" });
      await auditQueued(req, "post.publish.queue", {
        target_type: "post",
        target_id: id,
        organization_id: loc.organization_id,
        client_id: loc.client_id,
        location_id: loc.id,
        provider: "google",
        metadata: { reason: "edit-publish" },
      });
    } else {
      await removePublishJob(id);
    }

    await auditSuccess(req, "post.update", {
      target_type: "post",
      target_id: id,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
      provider: "google",
      metadata: { status: updated.status, queued: updated.status === "queued" },
    });

    return res.json({ post: updated });
  } catch (e) {
    return toApiError(res, e);
  }
});

router.post("/:id/retry", authenticate, generationRateLimit, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const id = String(req.params.id || "");
    const posts = await col("posts");

    const post = await posts.findOne({ id, user_id: userId });
    if (!post) {
      return res.status(404).json({ error: { code: "not_found", message: "post not found" } });
    }

    const loc = await requireOwnedLocation(userId, post.location_id, { provider: "google" });
    assertDocMatchesLocationScope(post, loc, "post");

    if (post.status !== "failed") {
      return res.status(409).json({ error: { code: "conflict", message: "only failed posts can be retried" } });
    }

    const rebind = {};
    if (loc?.integration_id) rebind.integration_id = loc.integration_id;
    if (loc?.provider_account_name) rebind.provider_account_name = loc.provider_account_name;
    if (loc?.provider_location_name) rebind.provider_location_name = loc.provider_location_name;
    if (!post.topic_type) rebind.topic_type = "STANDARD";
    if (!post.language_code) rebind.language_code = "en-US";

    const postScope = {
      id,
      user_id: userId,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
    };

    await posts.updateOne(
      postScope,
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

    await auditQueued(req, "post.retry", {
      target_type: "post",
      target_id: id,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
      provider: "google",
      metadata: { reason: "manual-retry" },
    });

    return res.json({ ok: true });
  } catch (e) {
    return toApiError(res, e);
  }
});

router.delete("/:id", authenticate, mutationRateLimit, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const id = String(req.params.id || "");
    const posts = await col("posts");

    const post = await posts.findOne({ id, user_id: userId });
    if (!post) {
      return res.status(404).json({ error: { code: "not_found", message: "post not found" } });
    }

    const loc = await requireOwnedLocation(userId, post.location_id, { provider: "google" });
    assertDocMatchesLocationScope(post, loc, "post");

    await removePublishJob(id);
    await posts.deleteOne({
      id,
      user_id: userId,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
    });

    await auditSuccess(req, "post.delete", {
      target_type: "post",
      target_id: id,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
      provider: "google",
    });

    return res.json({ ok: true });
  } catch (e) {
    return toApiError(res, e);
  }
});

export default router;
