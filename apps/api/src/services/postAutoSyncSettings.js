import { isMembershipAssignedToLocation } from "./organizationAccess.js";
import { calculateInitialAutoSyncAt } from "./postAutoSyncScheduler.js";

const READ_ROLES = new Set(["owner", "admin", "manager", "viewer"]);
const WRITE_ROLES = new Set(["owner", "admin", "manager"]);

function settingsError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  return error;
}

function clean(value) {
  return String(value ?? "").trim();
}

function requireId(value, name) {
  const normalized = clean(value);
  if (!normalized) throw settingsError(400, "bad_request", `${name} is required`);
  return normalized;
}

function roleOf(membership) {
  return clean(membership?.role).toLowerCase();
}

function canSeeLocation(membership, location) {
  const role = roleOf(membership);
  if (!READ_ROLES.has(role)) return false;
  return isMembershipAssignedToLocation(membership, {
    clientId: location.client_id,
    locationId: location.id,
  });
}

function canManageLocation(membership, location) {
  return WRITE_ROLES.has(roleOf(membership)) && canSeeLocation(membership, location);
}

async function loadScopedLocations(locations, { organizationId, integrationId }) {
  const filter = { organization_id: organizationId, provider: "google" };
  if (integrationId) filter.integration_id = integrationId;
  return locations.find(filter).sort({ title: 1, id: 1 }).toArray();
}

function serializeLocation(location, membership) {
  const sync = location.post_sync || {};
  return {
    id: location.id,
    organizationId: location.organization_id,
    clientId: location.client_id,
    integrationId: location.integration_id,
    accountName: location.provider_account_name,
    providerLocationName: location.provider_location_name,
    title: location.title || location.name || location.provider_location_name || location.id,
    autoEnabled: sync.auto_enabled === true,
    canManage: canManageLocation(membership, location),
    lastSuccessAt: sync.last_success_at || null,
    lastAutoAttemptAt: sync.last_auto_attempt_at || null,
    lastAutoSuccessAt: sync.last_auto_success_at || null,
    lastAutoFailureAt: sync.last_auto_failure_at || null,
    lastAutoFailureCode: sync.last_auto_failure_code || null,
    nextAutoSyncAt: sync.next_auto_sync_at || null,
    syncState: sync.auto_state || (sync.auto_enabled === true ? "idle" : "disabled"),
  };
}

export async function listPostAutoSyncSettings(
  { userId, organizationId, integrationId },
  { locations, requireMembership, intervalMinutes = 120 },
) {
  const organization = requireId(organizationId, "organizationId");
  const membership = await requireMembership({ organizationId: organization, userId });
  if (!READ_ROLES.has(roleOf(membership))) {
    throw settingsError(403, "organization_role_required", "Required organization role is missing.");
  }
  const rows = await loadScopedLocations(locations, {
    organizationId: organization,
    integrationId: clean(integrationId),
  });
  const visible = rows.filter((location) => canSeeLocation(membership, location));
  const accounts = [];
  const seen = new Set();
  for (const location of visible) {
    if (!location.integration_id || seen.has(location.integration_id)) continue;
    seen.add(location.integration_id);
    accounts.push({
      integrationId: location.integration_id,
      accountName: location.provider_account_name || null,
    });
  }
  return {
    organizationId: organization,
    intervalMinutes,
    intervalLabel: intervalMinutes === 120 ? "Every 2 hours" : `Every ${intervalMinutes} minutes`,
    accounts,
    locations: visible.map((location) => serializeLocation(location, membership)),
  };
}

export async function setLocationPostAutoSync(
  { userId, locationId, enabled, now = new Date() },
  { locations, requireLocationAccess },
) {
  if (typeof enabled !== "boolean") {
    throw settingsError(400, "bad_request", "enabled must be a boolean");
  }
  const id = requireId(locationId, "locationId");
  const location = await locations.findOne({ id, provider: "google" });
  if (!location) throw settingsError(404, "not_found", "location not found");
  await requireLocationAccess({
    organizationId: location.organization_id,
    clientId: location.client_id,
    locationId: location.id,
    userId,
    allowedRoles: ["owner", "admin", "manager"],
  });
  if (!location.integration_id || !location.provider_account_name || !location.provider_location_name) {
    throw settingsError(409, "location_not_bound", "Location is not completely bound to Google.");
  }
  const nextAutoSyncAt = enabled
    ? location.post_sync?.auto_enabled === true && location.post_sync?.next_auto_sync_at
      ? location.post_sync.next_auto_sync_at
      : calculateInitialAutoSyncAt({ locationId: location.id, enabledAt: now })
    : null;
  const update = {
    $set: {
      "post_sync.auto_enabled": enabled,
      "post_sync.auto_state": enabled ? "idle" : "disabled",
      updated_at: now,
      ...(enabled ? { "post_sync.next_auto_sync_at": nextAutoSyncAt } : {}),
    },
  };
  if (!enabled) update.$unset = { "post_sync.next_auto_sync_at": "" };
  const result = await locations.updateOne({
    id: location.id,
    user_id: location.user_id,
    organization_id: location.organization_id,
    client_id: location.client_id,
    provider: "google",
    integration_id: location.integration_id,
  }, update);
  if (Number(result?.matchedCount || 0) !== 1) {
    throw settingsError(409, "post_auto_sync_scope_changed", "Location scope changed before saving.");
  }
  return { locationId: location.id, autoEnabled: enabled, nextAutoSyncAt };
}

export async function setScopedPostAutoSync(
  { userId, organizationId, integrationId, enabled, now = new Date() },
  { locations, requireMembership, withTransaction },
) {
  if (typeof enabled !== "boolean") {
    throw settingsError(400, "bad_request", "enabled must be a boolean");
  }
  const organization = requireId(organizationId, "organizationId");
  const membership = await requireMembership({ organizationId: organization, userId });
  if (!WRITE_ROLES.has(roleOf(membership))) {
    throw settingsError(403, "organization_role_required", "Required organization role is missing.");
  }
  const normalizedIntegrationId = clean(integrationId);
  const rows = await loadScopedLocations(locations, {
    organizationId: organization,
    integrationId: normalizedIntegrationId,
  });
  const targets = rows.filter((location) => canManageLocation(membership, location));
  if (!targets.length) return { updated: 0, autoEnabled: enabled };
  if (targets.some((location) =>
    !location.integration_id || !location.provider_account_name || !location.provider_location_name
  )) throw settingsError(409, "location_not_bound", "Every manageable location must be completely bound to Google.");
  if (typeof withTransaction !== "function") {
    throw settingsError(500, "transaction_required", "Atomic bulk settings updates require MongoDB transactions.");
  }

  const identities = targets.map((location) => ({
    id: location.id,
    user_id: location.user_id,
    organization_id: location.organization_id,
    client_id: location.client_id,
    provider: "google",
    integration_id: location.integration_id,
    provider_account_name: location.provider_account_name,
    provider_location_name: location.provider_location_name,
  }));
  await withTransaction(async (session) => {
    const currentById = new Map();
    for (const identity of identities) {
      const current = await locations.findOne(identity, { session });
      if (!current) throw settingsError(409, "post_auto_sync_scope_changed", "Location scope changed before saving.");
      currentById.set(identity.id, current);
    }
    for (const identity of identities) {
      const current = currentById.get(identity.id);
      const update = {
        $set: {
          "post_sync.auto_enabled": enabled,
          "post_sync.auto_state": enabled ? "idle" : "disabled",
          updated_at: now,
        },
      };
      if (enabled && current.post_sync?.auto_enabled !== true) {
        update.$set["post_sync.next_auto_sync_at"] = calculateInitialAutoSyncAt({
          locationId: identity.id,
          enabledAt: now,
        });
      } else if (!enabled) {
        update.$unset = { "post_sync.next_auto_sync_at": "" };
      }
      const result = await locations.updateOne(identity, update, { session });
      if (Number(result?.matchedCount || 0) !== 1) {
        throw settingsError(409, "post_auto_sync_scope_changed", "Location scope changed before saving.");
      }
    }
  });
  return { updated: targets.length, autoEnabled: enabled };
}
