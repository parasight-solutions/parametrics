import { randomUUID } from "node:crypto";
import { runPostSync } from "./postSyncRunner.js";
import { isActiveUserAccount } from "./organizationMembers.js";

const TRANSIENT_RETRY_DELAY_MS = 15 * 60_000;
const AUTH_RETRY_DELAY_MS = 24 * 60 * 60_000;

function autoSyncError(code, message, { retryable = true, status = 409 } = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  return error;
}

function isCompleteLocation(location) {
  return Boolean(
    location?.id &&
    location?.user_id &&
    location?.organization_id &&
    location?.client_id &&
    location?.integration_id &&
    location?.provider_account_name &&
    location?.provider_location_name,
  );
}

export function buildPostSyncWorkerOptions(config, connection) {
  return { connection, concurrency: config.concurrency };
}

export async function runAutoPostSyncJob(
  { locationId, enqueueClaimId, dueAt },
  {
    config,
    locations,
    users,
    requireLocationAccess,
    getIntegrationById,
    syncGooglePosts,
    syncDependencies,
    withTransaction,
    runSync = runPostSync,
    operationId = randomUUID,
    now = () => new Date(),
  },
) {
  if (!config.enabled) return { skipped: true, reason: "auto_sync_disabled" };
  const id = String(locationId || "").trim();
  if (!id) throw autoSyncError("bad_job_payload", "locationId is required", { retryable: false, status: 400 });

  const location = await locations.findOne({ id, provider: "google" });
  const eligible =
    location &&
    location.provider === "google" &&
    location.status === "active" &&
    location.post_sync?.auto_enabled === true &&
    isCompleteLocation(location);
  if (!eligible) {
    if (location) {
      await locations.updateOne(
        { id, "post_sync.enqueue_claim_id": enqueueClaimId },
        { $unset: { "post_sync.enqueue_claim_id": "", "post_sync.enqueue_claim_expires_at": "" } },
      );
    }
    return { skipped: true, reason: "location_not_eligible" };
  }

  const owner = users ? await users.findOne({ id: location.user_id }) : null;
  if (!isActiveUserAccount(owner)) {
    const attemptedAt = now();
    await locations.updateOne(
      { id, "post_sync.enqueue_claim_id": enqueueClaimId },
      {
        $set: {
          "post_sync.auto_state": "auth_required",
          "post_sync.last_auto_attempt_at": attemptedAt,
          "post_sync.last_auto_failure_at": attemptedAt,
          "post_sync.last_auto_failure_code": "post_sync_owner_inactive",
          "post_sync.next_auto_sync_at": new Date(attemptedAt.getTime() + AUTH_RETRY_DELAY_MS),
        },
        $unset: { "post_sync.enqueue_claim_id": "", "post_sync.enqueue_claim_expires_at": "" },
      },
    );
    throw autoSyncError("post_sync_owner_inactive", "The location owner is no longer active.", { retryable: false });
  }

  try {
    await requireLocationAccess({
      organizationId: location.organization_id,
      clientId: location.client_id,
      locationId: location.id,
      userId: location.user_id,
      allowedRoles: ["owner", "admin", "manager"],
    });
  } catch {
    const attemptedAt = now();
    await locations.updateOne(
      { id, "post_sync.enqueue_claim_id": enqueueClaimId, "post_sync.auto_enabled": true },
      {
        $set: {
          "post_sync.auto_state": "auth_required",
          "post_sync.last_auto_attempt_at": attemptedAt,
          "post_sync.last_auto_failure_at": attemptedAt,
          "post_sync.last_auto_failure_code": "post_sync_owner_access_revoked",
          "post_sync.next_auto_sync_at": new Date(attemptedAt.getTime() + AUTH_RETRY_DELAY_MS),
        },
        $unset: { "post_sync.enqueue_claim_id": "", "post_sync.enqueue_claim_expires_at": "" },
      },
    );
    throw autoSyncError("post_sync_owner_access_revoked", "The location owner no longer has access.", { retryable: false });
  }

  const integration = await getIntegrationById(location.user_id, location.integration_id);
  if (
    !integration ||
    integration.id !== location.integration_id ||
    integration.active === false ||
    integration.needs_reauth === true
  ) {
    const attemptedAt = now();
    await locations.updateOne(
      {
        id: location.id,
        integration_id: location.integration_id,
        "post_sync.enqueue_claim_id": enqueueClaimId,
        "post_sync.auto_enabled": true,
      },
      {
        $set: {
          "post_sync.auto_state": "auth_required",
          "post_sync.last_auto_attempt_at": attemptedAt,
          "post_sync.last_auto_failure_at": attemptedAt,
          "post_sync.last_auto_failure_code": "google_post_sync_auth_failed",
          "post_sync.next_auto_sync_at": new Date(attemptedAt.getTime() + AUTH_RETRY_DELAY_MS),
        },
        $unset: { "post_sync.enqueue_claim_id": "", "post_sync.enqueue_claim_expires_at": "" },
      },
    );
    throw autoSyncError(
      "google_post_sync_auth_failed",
      "The bound Google integration requires reconnection.",
      { retryable: false },
    );
  }

  const startedAt = now();
  const expectedDueAt = dueAt ? new Date(dueAt) : location.post_sync?.next_auto_sync_at;
  const claim = await locations.updateOne(
    {
      id: location.id,
      user_id: location.user_id,
      organization_id: location.organization_id,
      client_id: location.client_id,
      integration_id: location.integration_id,
      provider: "google",
      status: "active",
      "post_sync.auto_enabled": true,
      "post_sync.enqueue_claim_id": enqueueClaimId,
      ...(expectedDueAt ? { "post_sync.next_auto_sync_at": expectedDueAt } : {}),
    },
    {
      $set: {
        "post_sync.auto_state": "running",
        "post_sync.last_auto_attempt_at": startedAt,
      },
      $unset: { "post_sync.enqueue_claim_id": "", "post_sync.enqueue_claim_expires_at": "" },
    },
  );
  if (Number(claim?.matchedCount || 0) !== 1) {
    return { skipped: true, reason: "enqueue_claim_lost" };
  }

  const recordFailure = async ({ error, operationId: activeOperationId, fence, failedAt }) => {
    const safeCode = /^[a-z0-9_]{1,100}$/.test(String(error?.code || ""))
      ? error.code
      : "post_auto_sync_failed";
    await locations.updateOne(
      {
        id: location.id,
        "post_sync.operation_id": activeOperationId,
        "post_sync.operation_fence": fence,
        "post_sync.auto_enabled": true,
      },
      {
        $set: {
          "post_sync.auto_state": error?.retryable === false ? "failed" : "retrying",
          "post_sync.last_auto_failure_at": failedAt,
          "post_sync.last_auto_failure_code": safeCode,
          "post_sync.next_auto_sync_at": new Date(failedAt.getTime() +
            (error?.retryable === false ? AUTH_RETRY_DELAY_MS : TRANSIENT_RETRY_DELAY_MS)),
        },
      },
    );
  };

  try {
    return await runSync({
      location,
      integration,
      operationId: operationId(),
      operationKind: "automatic",
      now: startedAt,
    }, {
      locations,
      config,
      syncGooglePosts,
      syncDependencies,
      withTransaction,
      onFailure: recordFailure,
    });
  } catch (error) {
    throw error;
  }
}
