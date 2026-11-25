// apps/api/src/routes/locations.js
import { Router } from "express";
import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import {
  getActiveGoogleIntegration,
  getGoogleIntegrationById,
} from "../integrations/google.store.js";
import {
  requireOwnedLocation,
  toApiError,
} from "../services/ownership.js";
import { requireOrganizationLocationAccess } from "../services/organizationAccess.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

const router = Router();
const LOCATION_MUTATION_ROLES = Object.freeze(["owner", "admin"]);

export function serializeLocationForList(location) {
  if (!location?.post_sync) return location;
  const safeKeys = [
    "last_success_at", "last_fetched_count", "last_inserted_count",
    "last_updated_count", "last_unchanged_count", "last_missing_count",
    "last_tombstone_skipped_count", "last_conflict_count",
  ];
  const safePostSync = Object.fromEntries(
    safeKeys.filter((key) => Object.prototype.hasOwnProperty.call(location.post_sync, key))
      .map((key) => [key, location.post_sync[key]]),
  );
  return { ...location, post_sync: safePostSync };
}

router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const provider = String(req.query.provider || "google");
    const all = String(req.query.all || "") === "1";
    const integrationIdParam = String(req.query.integrationId || "");

    const locations = await col("locations");

    const q = { user_id: userId };
    if (provider) q.provider = provider;

    if (provider === "google" && !all) {
      const integ = integrationIdParam
        ? await getGoogleIntegrationById(userId, integrationIdParam)
        : await getActiveGoogleIntegration(userId);

      if (!integ) return sendSuccess(res, { data: { locations: [], activeIntegrationId: null }, message: "Locations loaded" });

      q.integration_id = integ.id;
      const list = await locations
        .find(q)
        .sort({ updated_at: -1 })
        .project({ _id: 0 })
        .toArray();

      return sendSuccess(res, { data: { locations: list.map(serializeLocationForList), activeIntegrationId: integ.id }, message: "Locations loaded" });
    }

    if (integrationIdParam) q.integration_id = integrationIdParam;

    const list = await locations
      .find(q)
      .sort({ updated_at: -1 })
      .project({ _id: 0 })
      .toArray();

    return sendSuccess(res, { data: { locations: list.map(serializeLocationForList), activeIntegrationId: null }, message: "Locations loaded" });
  } catch (e) {
    console.error("[locations/list] error", e);
    return sendError(res, { statusCode: 500, message: "Unable to load locations", errors: [{ code: "server_error", message: "Unable to load locations" }] });
  }
});

router.delete("/:id", authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const id = String(req.params.id || "").trim();

    const loc = await requireOwnedLocation(userId, id);
    await requireOrganizationLocationAccess({
      organizationId: loc.organization_id,
      clientId: loc.client_id,
      locationId: loc.id,
      userId,
      allowedRoles: LOCATION_MUTATION_ROLES,
    });

    const c = await col("locations");
    await c.deleteOne({
      id: loc.id,
      user_id: loc.user_id,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
    });

    return sendSuccess(res, { data: { ok: true }, message: "Location deleted" });
  } catch (e) {
    return toApiError(res, e);
  }
});

export default router;
