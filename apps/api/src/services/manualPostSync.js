import { randomUUID } from "node:crypto";

const LEASE_MS = 120_000;

function syncError(status, code, message) {
  const error = new Error(message || code); error.status = status; error.code = code; return error;
}

function mapProviderSyncError(error) {
  if (error?.code) return error;
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) return syncError(409, "google_post_sync_auth_failed", "Reconnect or verify this location's Google access.");
  if (status === 429) return syncError(429, "google_post_sync_rate_limited", "Google temporarily rate-limited synchronization. Please retry later.");
  if (status >= 500 && status <= 599) return syncError(502, "google_post_sync_unavailable", "Google synchronization is temporarily unavailable.");
  if (status) return syncError(502, "google_post_sync_failed", "Google could not complete post synchronization.");
  return error;
}

function unwrap(result) {
  return result && Object.prototype.hasOwnProperty.call(result, "value") ? result.value : result;
}

export async function claimPostSyncLease(locations, { location, operationId, now, leaseMs = LEASE_MS }) {
  const claimed = unwrap(await locations.findOneAndUpdate(
    {
      id: location.id,
      user_id: location.user_id,
      $or: [
        { "post_sync.operation_id": { $exists: false } },
        { "post_sync.operation_expires_at": { $lte: now } },
      ],
    },
    { $set: { "post_sync.operation_id": operationId, "post_sync.operation_expires_at": new Date(now.getTime() + leaseMs) } },
    { returnDocument: "after" },
  ));
  if (!claimed) throw syncError(409, "post_sync_in_progress", "Post synchronization is already in progress for this location.");
  return claimed;
}

export async function releasePostSyncLease(locations, { locationId, operationId }) {
  await locations.updateOne(
    { id: locationId, "post_sync.operation_id": operationId },
    { $unset: { "post_sync.operation_id": "", "post_sync.operation_expires_at": "" } },
  );
}

export async function completePostSyncLease(locations, { locationId, operationId, summary, now }) {
  const postSync = {
    last_success_at: now,
    last_fetched_count: summary.fetched,
    last_inserted_count: summary.inserted,
    last_updated_count: summary.updated,
    last_unchanged_count: summary.unchanged,
    last_missing_count: summary.missingOnGoogle,
    last_tombstone_skipped_count: summary.tombstoneSkipped,
    last_conflict_count: summary.conflicts,
  };
  const completed = unwrap(await locations.findOneAndUpdate(
    { id: locationId, "post_sync.operation_id": operationId },
    { $set: { post_sync: postSync } },
    { returnDocument: "after" },
  ));
  if (!completed) throw syncError(409, "post_sync_state_changed", "Post synchronization ownership changed before completion.");
  return completed;
}

export async function runManualPostSync(
  { userId, locationId, now = new Date() },
  { locations, requireLocationAccess, getIntegrationById, syncGooglePosts, syncDependencies, operationId = randomUUID },
) {
  const normalized = String(locationId || "").trim();
  if (!normalized) throw syncError(400, "bad_request", "locationId is required.");
  const { location } = await requireLocationAccess({
    userId, locationId: normalized, provider: "google", allowedRoles: ["owner", "admin", "manager"],
  });
  const id = operationId();
  await claimPostSyncLease(locations, { location, operationId: id, now });
  try {
    const integration = await getIntegrationById(userId, location.integration_id);
    if (!integration || integration.id !== location.integration_id || integration.active === false || integration.needs_reauth === true) {
      throw syncError(409, "google_integration_unavailable", "The bound Google integration is unavailable.");
    }
    const { summary } = await syncGooglePosts({ location, integration, now, operationId: id }, syncDependencies);
    await completePostSyncLease(locations, { locationId: location.id, operationId: id, summary, now });
    return { success: true, locationId: location.id, summary, lastSyncedAt: now.toISOString() };
  } catch (error) {
    await releasePostSyncLease(locations, { locationId: location.id, operationId: id });
    throw mapProviderSyncError(error);
  }
}
