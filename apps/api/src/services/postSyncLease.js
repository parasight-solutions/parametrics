function syncStateError(code, message) {
  const error = new Error(message || code);
  error.status = 409;
  error.code = code;
  return error;
}

function unwrap(result) {
  return result && Object.prototype.hasOwnProperty.call(result, "value")
    ? result.value
    : result;
}

export async function claimPostSyncLease(
  locations,
  { location, operationId, operationKind, now = new Date(), leaseMs = 120_000 },
) {
  const claimed = unwrap(await locations.findOneAndUpdate(
    {
      id: location.id,
      user_id: location.user_id,
      organization_id: location.organization_id,
      client_id: location.client_id,
      provider: location.provider,
      integration_id: location.integration_id,
      provider_account_name: location.provider_account_name,
      provider_location_name: location.provider_location_name,
      ...(operationKind === "automatic" ? {
        status: "active",
        "post_sync.auto_enabled": true,
      } : {}),
      $or: [
        { "post_sync.operation_id": { $exists: false } },
        { "post_sync.operation_expires_at": { $lte: now } },
      ],
    },
    {
      $inc: { "post_sync.operation_fence": 1 },
      $set: {
        "post_sync.operation_id": operationId,
        "post_sync.operation_kind": operationKind,
        "post_sync.operation_expires_at": new Date(now.getTime() + leaseMs),
      },
    },
    { returnDocument: "after", includeResultMetadata: false },
  ));
  if (!claimed) {
    throw syncStateError(
      "post_sync_in_progress",
      "Post synchronization is already in progress for this location.",
    );
  }
  return {
    location: claimed,
    fence: Number(claimed.post_sync?.operation_fence || 0),
  };
}

export async function renewPostSyncLease(
  locations,
  { locationId, operationId, fence, now = new Date(), leaseMs = 120_000 },
) {
  const result = await locations.updateOne(
    {
      id: locationId,
      "post_sync.operation_id": operationId,
      "post_sync.operation_fence": fence,
      "post_sync.operation_expires_at": { $gt: now },
    },
    {
      $set: {
        "post_sync.operation_expires_at": new Date(now.getTime() + leaseMs),
      },
    },
  );
  return Number(result?.matchedCount || 0) === 1;
}

export async function releasePostSyncLease(
  locations,
  { locationId, operationId, fence },
) {
  const result = await locations.updateOne(
    {
      id: locationId,
      "post_sync.operation_id": operationId,
      "post_sync.operation_fence": fence,
    },
    {
      $unset: {
        "post_sync.operation_id": "",
        "post_sync.operation_kind": "",
        "post_sync.operation_expires_at": "",
      },
    },
  );
  return Number(result?.matchedCount || 0) === 1;
}

export async function assertPostSyncLease(
  locations,
  { location, locationId = location?.id, operationId, fence, now = new Date(), session },
) {
  const owned = unwrap(await locations.findOneAndUpdate(
    {
      id: locationId,
      "post_sync.operation_id": operationId,
      "post_sync.operation_fence": fence,
      "post_sync.operation_expires_at": { $gt: now },
      ...(location ? {
        user_id: location.user_id,
        organization_id: location.organization_id,
        client_id: location.client_id,
        integration_id: location.integration_id,
        provider: "google",
        provider_account_name: location.provider_account_name,
        provider_location_name: location.provider_location_name,
      } : {}),
    },
    { $set: { "post_sync.operation_guard_at": now } },
    { session, returnDocument: "after", includeResultMetadata: false },
  ));
  if (!owned) {
    throw syncStateError(
      "post_sync_lease_lost",
      "Post synchronization ownership was lost.",
    );
  }
  return owned;
}

export async function completePostSyncLease(
  locations,
  {
    locationId,
    operationId,
    fence,
    operationKind,
    summary,
    now = new Date(),
    nextAutoSyncAt,
  },
) {
  const set = {
    "post_sync.last_success_at": now,
    "post_sync.last_fetched_count": summary.fetched,
    "post_sync.last_inserted_count": summary.inserted,
    "post_sync.last_updated_count": summary.updated,
    "post_sync.last_unchanged_count": summary.unchanged,
    "post_sync.last_missing_count": summary.missingOnGoogle,
    "post_sync.last_tombstone_skipped_count": summary.tombstoneSkipped,
    "post_sync.last_conflict_count": summary.conflicts,
    "post_sync.auto_state": operationKind === "automatic" ? "idle" : undefined,
  };
  if (set["post_sync.auto_state"] === undefined) delete set["post_sync.auto_state"];
  if (nextAutoSyncAt) set["post_sync.next_auto_sync_at"] = nextAutoSyncAt;
  if (operationKind === "automatic") {
    set["post_sync.last_auto_success_at"] = now;
  }
  const unset = {
    "post_sync.operation_id": "",
    "post_sync.operation_kind": "",
    "post_sync.operation_expires_at": "",
  };
  if (operationKind === "automatic") {
    unset["post_sync.last_auto_failure_code"] = "";
  }
  const completed = unwrap(await locations.findOneAndUpdate(
    {
      id: locationId,
      "post_sync.operation_id": operationId,
      "post_sync.operation_fence": fence,
      ...(operationKind === "automatic" ? { "post_sync.auto_enabled": true } : {}),
    },
    {
      $set: set,
      $unset: unset,
    },
    { returnDocument: "after", includeResultMetadata: false },
  ));
  if (!completed) {
    throw syncStateError(
      "post_sync_state_changed",
      "Post synchronization ownership changed before completion.",
    );
  }
  return completed;
}

export function startPostSyncHeartbeat({
  renew,
  intervalMs,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let stopped = false;
  let inFlight = false;
  let resolveLost;
  const lost = new Promise((resolve) => {
    resolveLost = resolve;
  });
  const timer = setIntervalFn(async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const renewed = await renew();
      if (!renewed && !stopped) {
        stopped = true;
        clearIntervalFn(timer);
        resolveLost(true);
      }
    } catch {
      if (!stopped) {
        stopped = true;
        clearIntervalFn(timer);
        resolveLost(true);
      }
    } finally {
      inFlight = false;
    }
  }, intervalMs);

  return {
    lost,
    stop() {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(timer);
      resolveLost(false);
    },
  };
}
