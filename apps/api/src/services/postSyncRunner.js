import {
  assertPostSyncLease,
  claimPostSyncLease,
  completePostSyncLease,
  releasePostSyncLease,
  renewPostSyncLease,
  startPostSyncHeartbeat,
} from "./postSyncLease.js";
import { calculateNextAutoSyncAt } from "./postAutoSyncScheduler.js";

function syncError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

export function mapPostSyncError(error) {
  if (error?.code) return error;
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) {
    return syncError(409, "google_post_sync_auth_failed", "Reconnect or verify this location's Google access.");
  }
  if (status === 429) {
    return syncError(429, "google_post_sync_rate_limited", "Google temporarily rate-limited synchronization. Please retry later.");
  }
  if (status >= 500 && status <= 599) {
    return syncError(502, "google_post_sync_unavailable", "Google synchronization is temporarily unavailable.");
  }
  if (status) {
    return syncError(502, "google_post_sync_failed", "Google could not complete post synchronization.");
  }
  return error;
}

export async function runPostSync(
  { location, integration, operationId, operationKind, now = new Date() },
  {
    locations,
    config,
    syncGooglePosts,
    syncDependencies,
    withTransaction,
    claimLease = claimPostSyncLease,
    renewLease = renewPostSyncLease,
    assertLease = assertPostSyncLease,
    completeLease = completePostSyncLease,
    releaseLease = releasePostSyncLease,
    startHeartbeat = startPostSyncHeartbeat,
    clock = () => new Date(),
    onFailure,
  },
) {
  const claimed = await claimLease(locations, {
    location,
    operationId,
    operationKind,
    now,
    leaseMs: config.leaseMs,
  });
  const fence = claimed.fence;
  const heartbeat = startHeartbeat({
    intervalMs: config.heartbeatMs,
    renew: () => renewLease(locations, {
      locationId: location.id,
      operationId,
      fence,
      now: clock(),
      leaseMs: config.leaseMs,
    }),
  });
  let heartbeatLost = false;
  const heartbeatLoss = heartbeat.lost.then((lost) => {
    heartbeatLost = lost;
    return lost;
  });

  try {
    const providerWork = syncGooglePosts(
      { location: claimed.location || location, integration, now },
      {
        ...syncDependencies,
        withTransaction,
        assertOwnership: (session) => {
          if (heartbeatLost) {
            throw syncError(409, "post_sync_lease_lost", "Post synchronization ownership was lost.");
          }
          return assertLease(locations, {
            location,
            operationId,
            fence,
            now: clock(),
            session,
          });
        },
      },
    );
    const lostOwnership = heartbeatLoss.then((lost) => {
      if (!lost) return new Promise(() => {});
      throw syncError(409, "post_sync_lease_lost", "Post synchronization ownership was lost.");
    });
    const result = await Promise.race([providerWork, lostOwnership]);
    const completedAt = clock();
    const nextAutoSyncAt = calculateNextAutoSyncAt({
      locationId: location.id,
      completedAt,
      intervalMinutes: config.intervalMinutes,
    });
    await completeLease(locations, {
      locationId: location.id,
      operationId,
      fence,
      operationKind,
      summary: result.summary,
      now: completedAt,
      nextAutoSyncAt,
    });
    return result;
  } catch (error) {
    const mapped = mapPostSyncError(error);
    if (onFailure) {
      await onFailure({ error: mapped, operationId, fence, failedAt: clock() });
    }
    await releaseLease(locations, { locationId: location.id, operationId, fence });
    throw mapped;
  } finally {
    heartbeat.stop();
  }
}
