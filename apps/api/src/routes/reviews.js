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
  toApiError,
} from "../services/ownership.js";
import { requireOwnedOrganizationLocationAccess } from "../services/organizationAccess.js";
import { auditFailure, auditQueued, auditSuccess } from "../services/auditLog.js";
import {
  buildReviewListPipeline,
  normalizeReviewListQuery,
  readReviewListFacet,
} from "../services/reviewList.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

const router = Router();
const reviewSyncQueue = makeQueue("review-sync");
const LOCATION_READ_ROLES = Object.freeze(["owner", "admin", "manager", "viewer"]);
const LOCATION_OPERATION_ROLES = Object.freeze(["owner", "admin", "manager"]);

const reviewError = (res, statusCode, code, message = code) =>
  sendError(res, { statusCode, message, errors: [{ code, message }] });

function providerErrorDetails(error) {
  const providerError = error?.body?.error;
  const detail = Array.isArray(providerError?.details) ? providerError.details[0] : null;
  return {
    providerStatus: Number(error?.status) || null,
    providerErrorCode: providerError?.code ?? null,
    providerReason: String(
      providerError?.status || detail?.reason || detail?.errorCode || "",
    ).trim() || null,
  };
}

export function classifyGoogleReviewReplyError(error) {
  if (error?.code === "reauth_required") return null;
  const diagnostics = providerErrorDetails(error);
  const status = diagnostics.providerStatus;
  const reason = String(diagnostics.providerReason || "").toUpperCase();

  if (status === 404 && reason === "NOT_FOUND" && Number(diagnostics.providerErrorCode) === 404) {
    return {
      statusCode: 404,
      code: "google_review_unavailable",
      message: "This review is currently unavailable on Google. Please try again later.",
      errorMessage: "Google could not find this review.",
      diagnostics,
    };
  }
  if (status === 429) {
    return {
      statusCode: 429,
      code: "google_rate_limited",
      message: "Google is temporarily rate limiting review replies. Please try again later.",
      errorMessage: "Google temporarily rate limited this request.",
      diagnostics,
    };
  }
  if (status === 403) {
    return {
      statusCode: 403,
      code: "google_permission_denied",
      message: "Google denied permission to update this review reply.",
      errorMessage: "Permission to update this Google review was denied.",
      diagnostics,
    };
  }
  if (status >= 500 || error?.code === "ETIMEDOUT" || error?.name === "AbortError") {
    return {
      statusCode: 503,
      code: "google_provider_unavailable",
      message: "Google review replies are temporarily unavailable. Please try again later.",
      errorMessage: "Google is temporarily unavailable.",
      diagnostics,
    };
  }
  return null;
}

async function getSyncStateForLocation(loc, getCollection = col) {
  const c = await getCollection("review_sync_state");
  return c.findOne(
    buildLocationScopeFilter(loc),
    { projection: { _id: 0 } }
  );
}

function toIsoTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function setSyncQueuedForLocation(loc, patch = {}, getCollection = col, runId = null, queuedAt = new Date()) {
  const c = await getCollection("review_sync_state");
  const now = queuedAt;
  const identity = { user_id: loc.user_id, location_id: loc.id };
  const filter = {
    ...identity,
    $or: [
      { updated_at: { $lt: queuedAt } },
      { updated_at: { $exists: false } },
    ],
  };
  if (runId) filter.last_run_id = { $ne: runId };
  const queued = {
    status: "queued",
    last_error: null,
    queued_at: now,
    updated_at: now,
    ...patch,
  };

  await c.updateOne(filter, { $set: queued }, { upsert: false });
  await c.updateOne(identity, {
    $setOnInsert: {
      ...queued,
      id: crypto.randomUUID(),
      created_at: now,
    },
  }, { upsert: true });
}

const ACTIVE_JOB_STATES = new Set(["active", "waiting", "delayed", "prioritized", "waiting-children"]);
const TERMINAL_JOB_STATES = new Set(["completed", "failed"]);

async function inspectExistingSyncJob(queue, jobId) {
  if (typeof queue.getJob !== "function") return null;
  const job = await queue.getJob(jobId);
  if (!job) return null;
  const state = await job.getState();
  if (TERMINAL_JOB_STATES.has(state)) {
    await job.remove();
    return null;
  }
  return ACTIVE_JOB_STATES.has(state) ? job : null;
}

export async function getReviews(req, res, {
  getCollection = col,
  requireAccess = requireOwnedOrganizationLocationAccess,
} = {}) {
  try {
    const userId = req.user.user_id;
    const locationId = String(req.query.locationId || req.query.location_id || "").trim();
    if (!locationId) {
      return reviewError(res, 400, "bad_request", "locationId required");
    }

    const { location: loc } = await requireAccess({
      userId,
      locationId,
      provider: "google",
      allowedRoles: LOCATION_READ_ROLES,
    });

    const query = normalizeReviewListQuery(req.query);
    const c = await getCollection("reviews");
    const facetResult = await c.aggregate(buildReviewListPipeline({
      baseFilter: buildLocationScopeFilter(loc, { provider: "google" }),
      query,
    })).toArray();
    const list = readReviewListFacet(facetResult, query);

    const sync = await getSyncStateForLocation(loc, getCollection);

    return sendSuccess(res, {
      data: {
        ...list,
        lastSyncedAt: toIsoTimestamp(sync?.last_synced_at),
        sync: sync || null,
      },
      message: "Reviews fetched successfully",
    });
  } catch (e) {
    return toApiError(res, e);
  }
}

// GET /api/v1/reviews?locationId=...
router.get("/", authenticate, getReviews);

export async function queueReviewSync(req, res, {
  getCollection = col,
  requireAccess = requireOwnedOrganizationLocationAccess,
  queue = reviewSyncQueue,
  randomUUID = crypto.randomUUID,
  auditQueued: writeQueuedAudit = auditQueued,
  auditFailure: writeFailureAudit = auditFailure,
} = {}) {
  let auditTarget = {};
  try {
    const userId = req.user.user_id;
    const locationId = String(req.body?.locationId || req.body?.location_id || "").trim();
    const force = Boolean(req.body?.force);

    if (!locationId) {
      return reviewError(res, 400, "bad_request", "locationId required");
    }

    const { location: loc, membership } = await requireAccess({
      userId,
      locationId,
      provider: "google",
      allowedRoles: LOCATION_OPERATION_ROLES,
    });
    auditTarget = {
      target_type: "location",
      target_id: loc.id,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
      provider: "google",
      metadata: { membership_role: membership.role },
    };

    if (!loc.integration_id) {
      return reviewError(res, 409, "location_not_bound", "Location is not bound to Google");
    }

    const jobId = `reviewSync_${userId}_${locationId}`;
    const runId = randomUUID();
    const existingJob = await inspectExistingSyncJob(queue, jobId);
    if (existingJob) {
      await writeQueuedAudit(req, "review.sync.queue", {
        ...auditTarget,
        metadata: {
          ...(auditTarget.metadata || {}),
          alreadyRunning: true,
          force,
          mode: "full",
          since: null,
        },
      });
      return sendSuccess(res, { data: {
        queued: true,
        alreadyRunning: true,
        jobId: String(existingJob.id),
        since: null,
      }, message: "Review synchronization already queued" });
    }

    const queuedAt = new Date();
    const job = await queue.add(
      "sync-location-reviews",
      {
        userId,
        locationId,
        organizationId: loc.organization_id,
        clientId: loc.client_id,
        runId,
        mode: "full",
        since: null,
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
    const persistedJob = typeof queue.getJob === "function"
      ? await queue.getJob(String(job.id))
      : job;
    const acceptedRunId = persistedJob
      ? String(persistedJob.data?.runId || job.data?.runId || runId)
      : null;

    if (acceptedRunId && acceptedRunId !== runId) {
      await writeQueuedAudit(req, "review.sync.queue", {
        ...auditTarget,
        metadata: {
          ...(auditTarget.metadata || {}),
          alreadyRunning: true,
          force,
          mode: "full",
          since: null,
        },
      });
      return sendSuccess(res, { data: {
        queued: true,
        alreadyRunning: true,
        jobId: String(persistedJob.id || job.id),
        since: null,
      }, message: "Review synchronization already queued" });
    }

    if (acceptedRunId) {
      await setSyncQueuedForLocation(loc, {
        last_job_id: String(job.id),
        last_run_id: acceptedRunId,
        mode: "full",
        since: null,
        organization_id: loc.organization_id,
        client_id: loc.client_id,
      }, getCollection, acceptedRunId, queuedAt);
    }

    await writeQueuedAudit(req, "review.sync.queue", {
      ...auditTarget,
      metadata: { ...(auditTarget.metadata || {}), jobId: String(job.id), force, mode: "full", since: null },
    });

    return sendSuccess(res, { data: { queued: true, jobId: String(job.id), since: null }, message: "Review synchronization queued" });
  } catch (e) {
    await writeFailureAudit(req, "review.sync.queue", {
      ...auditTarget,
      metadata: { ...(auditTarget.metadata || {}), reason: e?.message || e?.code || "server_error" },
    });
    return toApiError(res, e);
  }
}

// POST /api/v1/reviews/sync  { locationId, force?: boolean }
router.post("/sync", authenticate, syncRateLimit, queueReviewSync);

export async function replyToReview(req, res, {
  getCollection = col,
  requireAccess = requireOwnedOrganizationLocationAccess,
  getIntegration = getGoogleIntegrationById,
  ensureToken = ensureAccessToken,
  updateProviderReply = updateReviewReply,
  auditSuccess: writeSuccessAudit = auditSuccess,
  auditFailure: writeFailureAudit = auditFailure,
  logger = console,
} = {}) {
  let auditTarget = {};
  try {
    const userId = req.user.user_id;
    const id = String(req.params.id || "").trim();
    const comment = String(req.body?.comment || "").trim();

    if (!comment) {
      return reviewError(res, 400, "bad_request", "comment required");
    }

    const c = await getCollection("reviews");
    const review = await c.findOne({ id, user_id: userId, provider: "google" });

    if (!review) {
      return reviewError(res, 404, "not_found", "review not found");
    }

    const { location: loc, membership } = await requireAccess({
      userId,
      locationId: review.location_id,
      provider: "google",
      allowedRoles: LOCATION_OPERATION_ROLES,
    });
    assertDocMatchesLocationScope(review, loc, "review");
    auditTarget = {
      target_type: "review",
      target_id: id,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
      provider: "google",
      metadata: { membership_role: membership.role },
    };

    if (!loc.integration_id) {
      return reviewError(res, 409, "location_not_bound", "Location is not bound to Google");
    }

    const integ = await getIntegration(userId, loc.integration_id);
    if (!integ) {
      return reviewError(res, 409, "no_integration_for_location", "Google connection for this location not found");
    }

    const { access_token } = await ensureToken(integ);

    await writeSuccessAudit(req, "review.reply.attempt", {
      ...auditTarget,
      metadata: {
        ...(auditTarget.metadata || {}),
        provider_review_name: review.provider_review_name,
      },
    });

    await updateProviderReply(review.provider_review_name, comment, access_token);

    const repliedAt = new Date();
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
          reviewReply: { comment, updateTime: repliedAt.toISOString() },
          local_reply_updated_at: repliedAt,
          updated_at: repliedAt,
        },
      }
    );

    await writeSuccessAudit(req, "review.reply", {
      ...auditTarget,
      metadata: {
        ...(auditTarget.metadata || {}),
        provider_review_name: review.provider_review_name,
      },
    });

    return sendSuccess(res, { data: { ok: true }, message: "Review reply updated" });
  } catch (e) {
    await writeFailureAudit(req, "review.reply", {
      ...auditTarget,
      metadata: { ...(auditTarget.metadata || {}), reason: e?.message || e?.code || "server_error" },
    });
    const mapped = classifyGoogleReviewReplyError(e);
    if (auditTarget.target_id) {
      const diagnostics = mapped?.diagnostics || providerErrorDetails(e);
      logger.warn?.({
        reviewId: auditTarget.target_id,
        locationId: auditTarget.location_id,
        providerStatus: diagnostics.providerStatus,
        providerErrorCode: diagnostics.providerErrorCode,
        providerReason: diagnostics.providerReason,
        correlationId: req.headers?.["x-request-id"] || req.headers?.["x-correlation-id"] || null,
      });
    }
    if (mapped) {
      return sendError(res, {
        statusCode: mapped.statusCode,
        message: mapped.message,
        errors: [{ code: mapped.code, message: mapped.errorMessage }],
      });
    }
    return toApiError(res, e);
  }
}

// PUT /api/v1/reviews/:id/reply { comment }
router.put("/:id/reply", authenticate, mutationRateLimit, replyToReview);

export default router;
