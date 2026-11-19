import { randomUUID } from "crypto";

const DELETE_LEASE_MS = 120_000;
const LOCAL_ONLY_STATUSES = new Set(["scheduled", "queued", "retrying"]);
const DELETABLE_STATUSES = new Set([
  ...LOCAL_ONLY_STATUSES,
  "failed",
  "published",
  "deleting",
]);

function makeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function unwrapFindOneAndUpdate(result) {
  if (!result) return null;
  return Object.prototype.hasOwnProperty.call(result, "value")
    ? result.value
    : result;
}

function scopeFor(post, location, userId) {
  const expected = {
    id: post.id,
    user_id: userId,
    organization_id: location.organization_id,
    client_id: location.client_id,
    location_id: location.id,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (!value || post[key] !== value) {
      throw makeError(
        409,
        "post_scope_mismatch",
        "Post does not match its authorized location scope.",
      );
    }
  }
  return expected;
}

function validateProviderReference(post, location) {
  const account = String(location.provider_account_name || "").trim();
  const locationName = String(location.provider_location_name || "").trim();
  const postName = String(post.provider_post_name || "").trim();
  const integrationId = String(location.integration_id || "").trim();

  const valid =
    /^accounts\/[^/]+$/.test(account) &&
    /^locations\/[^/]+$/.test(locationName) &&
    /^accounts\/[^/]+\/locations\/[^/]+\/localPosts\/[^/]+$/.test(postName) &&
    postName.startsWith(`${account}/${locationName}/localPosts/`) &&
    integrationId &&
    (!post.integration_id || post.integration_id === integrationId) &&
    (!post.provider_account_name || post.provider_account_name === account) &&
    (!post.provider_location_name ||
      post.provider_location_name === locationName);

  if (!valid) {
    throw makeError(
      409,
      "post_delete_reconciliation_required",
      "The published post reference does not match its Google location. Reconciliation is required before deletion.",
    );
  }

  return { postName, integrationId };
}

function mapGoogleDeleteError(error) {
  const providerStatus = Number(error?.status || 0);
  if (providerStatus === 401 || providerStatus === 403) {
    return makeError(
      409,
      "google_post_delete_auth_failed",
      "Google could not authorize this deletion. Reconnect or verify the location's Google access.",
    );
  }
  if (providerStatus === 429) {
    return makeError(
      429,
      "google_post_delete_rate_limited",
      "Google temporarily rate-limited this deletion. Please retry later.",
    );
  }
  if (providerStatus >= 500 && providerStatus <= 599) {
    return makeError(
      502,
      "google_post_delete_unavailable",
      "Google could not complete this deletion. Please retry later.",
    );
  }
  return makeError(
    502,
    "google_post_delete_failed",
    "Google did not confirm deletion of this post.",
  );
}

async function releaseOperation(posts, scope, operationId, error, now) {
  await posts.updateOne(
    { ...scope, status: "deleting", deletion_operation_id: operationId },
    {
      $set: {
        deletion_error: {
          code: error.code || "post_delete_failed",
          status: Number(error.status || 500),
          message: error.message || "Post deletion failed.",
          at: now,
        },
        updated_at: now,
      },
      $unset: {
        deletion_operation_id: "",
        deletion_operation_expires_at: "",
      },
    },
  );
}

async function claimDeletion(
  posts,
  { post, scope, operationId, now, leaseMs },
) {
  if (post.status === "publishing") {
    throw makeError(
      409,
      "post_publishing",
      "This post is currently publishing and cannot be deleted.",
    );
  }
  if (!DELETABLE_STATUSES.has(post.status)) {
    throw makeError(
      409,
      "post_delete_status_conflict",
      `Post cannot be deleted while its status is ${post.status || "unknown"}.`,
    );
  }

  const leaseUntil = new Date(now.getTime() + leaseMs);
  const filter = { ...scope, status: post.status };
  const set = {
    status: "deleting",
    deletion_operation_id: operationId,
    deletion_operation_expires_at: leaseUntil,
    deletion_last_attempt_at: now,
    deletion_started_at: post.deletion_started_at || now,
    updated_at: now,
  };

  if (post.status === "deleting") {
    filter.$or = [
      { deletion_operation_id: { $exists: false } },
      { deletion_operation_expires_at: { $exists: false } },
      { deletion_operation_expires_at: { $lte: now } },
    ];
  } else {
    set.deletion_previous_status = post.status;
  }

  const claimed = unwrapFindOneAndUpdate(
    await posts.findOneAndUpdate(
      filter,
      { $set: set, $unset: { deletion_error: "" } },
      { returnDocument: "after" },
    ),
  );
  if (claimed) return claimed;

  const current = await posts.findOne(scope);
  if (!current) return null;
  if (current.status === "publishing") {
    throw makeError(
      409,
      "post_publishing",
      "This post is currently publishing and cannot be deleted.",
    );
  }
  if (current.status === "deleting") {
    throw makeError(
      409,
      "post_deletion_in_progress",
      "Post deletion is already in progress.",
    );
  }
  throw makeError(
    409,
    "post_delete_status_conflict",
    "Post status changed before deletion could be claimed.",
  );
}

export async function deletePostWithProvider(
  { post, location, userId, now = new Date() },
  {
    posts,
    removePublishJob,
    getIntegrationById,
    ensureAccessToken,
    deleteLocalPost,
    operationId: createOperationId = randomUUID,
    leaseMs = DELETE_LEASE_MS,
  },
) {
  const scope = scopeFor(post, location, userId);
  const operationId = createOperationId();
  const claimed = await claimDeletion(posts, {
    post,
    scope,
    operationId,
    now,
    leaseMs,
  });
  if (!claimed) return { ok: true, remote: "already_deleted" };

  try {
    await removePublishJob(claimed.id);
  } catch (cause) {
    const error = makeError(
      503,
      "post_queue_cancel_failed",
      "The pending publish job could not be cancelled. Please retry.",
    );
    await releaseOperation(posts, scope, operationId, error, now);
    throw error;
  }

  const previousStatus =
    claimed.deletion_previous_status ||
    post.deletion_previous_status ||
    post.status;
  const remoteRequired =
    previousStatus === "published" || Boolean(claimed.provider_post_name);
  let remote = remoteRequired ? "deleted" : "not_required";

  if (remoteRequired && claimed.provider_deleted_at) {
    remote = "already_deleted";
  } else if (remoteRequired) {
    try {
      const { postName, integrationId } = validateProviderReference(
        claimed,
        location,
      );
      const integration = await getIntegrationById(userId, integrationId);
      if (!integration || integration.id !== integrationId) {
        throw makeError(
          409,
          "post_delete_reconciliation_required",
          "The Google integration bound to this post is unavailable.",
        );
      }
      const access = await ensureAccessToken(integration);
      try {
        await deleteLocalPost(access, postName);
      } catch (error) {
        if (Number(error?.status) === 404) {
          remote = "absent";
        } else {
          throw mapGoogleDeleteError(error);
        }
      }

      const providerProgress = await posts.updateOne(
        { ...scope, status: "deleting", deletion_operation_id: operationId },
        {
          $set: {
            provider_deleted_at: now,
            provider_delete_outcome: remote,
            updated_at: now,
          },
          $unset: { deletion_error: "" },
        },
      );
      if (Number(providerProgress?.matchedCount || 0) !== 1) {
        throw makeError(
          409,
          "post_delete_state_changed",
          "Post deletion state changed before provider progress could be recorded.",
        );
      }
    } catch (error) {
      const actionableError =
        error?.code === "reauth_required"
          ? mapGoogleDeleteError({ status: 401 })
          : error;
      await releaseOperation(posts, scope, operationId, actionableError, now);
      throw actionableError;
    }
  }

  try {
    const deleted = await posts.deleteOne({
      ...scope,
      status: "deleting",
      deletion_operation_id: operationId,
    });
    if (Number(deleted?.deletedCount || 0) === 1) return { ok: true, remote };

    const remaining = await posts.findOne(scope);
    if (!remaining) return { ok: true, remote };

    const error = makeError(
      409,
      "post_delete_state_changed",
      "Post deletion state changed before local cleanup completed.",
    );
    await releaseOperation(posts, scope, operationId, error, now);
    throw error;
  } catch (cause) {
    if (cause?.code === "post_delete_state_changed") throw cause;
    const error = makeError(
      500,
      "post_local_delete_failed",
      "Google deletion completed, but local cleanup failed. Retry deletion to finish cleanup.",
    );
    await releaseOperation(posts, scope, operationId, error, now);
    throw error;
  }
}
