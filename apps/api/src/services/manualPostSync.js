import { randomUUID } from "node:crypto";
import { resolvePostAutoSyncConfig } from "../config/postAutoSyncConfig.js";
import { withMongoTransaction as defaultWithMongoTransaction } from "../lib/mongo.js";
import {
  claimPostSyncLease,
  completePostSyncLease,
  releasePostSyncLease,
} from "./postSyncLease.js";
import { runPostSync } from "./postSyncRunner.js";

function syncError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

export { claimPostSyncLease, completePostSyncLease, releasePostSyncLease };

export async function runManualPostSync(
  { userId, locationId, now = new Date() },
  {
    locations,
    requireLocationAccess,
    getIntegrationById,
    syncGooglePosts,
    syncDependencies,
    operationId = randomUUID,
    withTransaction,
    config = resolvePostAutoSyncConfig(),
    runSync = runPostSync,
  },
) {
  const normalized = String(locationId || "").trim();
  if (!normalized) throw syncError(400, "bad_request", "locationId is required.");

  const { location } = await requireLocationAccess({
    userId,
    locationId: normalized,
    provider: "google",
    allowedRoles: ["owner", "admin", "manager"],
  });
  const integration = await getIntegrationById(userId, location.integration_id);
  if (
    !integration ||
    integration.id !== location.integration_id ||
    integration.active === false ||
    integration.needs_reauth === true
  ) {
    throw syncError(
      409,
      "google_integration_unavailable",
      "The bound Google integration is unavailable.",
    );
  }

  const result = await runSync({
    location,
    integration,
    operationId: operationId(),
    operationKind: "manual",
    now,
  }, {
    locations,
    config,
    syncGooglePosts,
    syncDependencies,
    withTransaction: withTransaction || defaultWithMongoTransaction,
  });

  return {
    success: true,
    locationId: location.id,
    summary: result.summary,
    lastSyncedAt: now.toISOString(),
  };
}
