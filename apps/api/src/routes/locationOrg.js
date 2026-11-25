// apps/api/src/routes/locationOrg.js
import { Router } from "express";
import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import { getOrCreateDefaultClientForOrganization } from "../services/clients.js";
import {
  normalizeLocationBinding,
  resolveCanonicalLocationScope,
} from "../services/locationBinding.js";
import { auditSuccess } from "../services/auditLog.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

const router = Router();

function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

/**
 * Legacy compatibility route.
 *
 * Canonical source of truth:
 * - locations.organization_id
 * - locations.client_id
 *
 * Legacy compatibility:
 * - locations.org_id
 * - location_org_map
 */

router.get("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const locationId = cleanStr(req.query.locationId, 200);

  if (!locationId) {
    return sendError(res, { statusCode: 400, message: "locationId required", errors: [{ code: "bad_request", message: "locationId required" }] });
  }

  const locations = await col("locations");
  const loc = await locations.findOne(
    { user_id: userId, id: locationId },
    {
      projection: {
        _id: 0,
        id: 1,
        org_id: 1,
        organization_id: 1,
        client_id: 1,
      },
    }
  );

  const mapCol = await col("location_org_map");
  const map = await mapCol.findOne(
    { user_id: userId, location_id: locationId },
    { projection: { _id: 0 } }
  );

  if (!loc && !map) return sendSuccess(res, { data: { map: null, org: null, binding: null }, message: "Location binding loaded" });

  const binding = resolveCanonicalLocationScope(loc, map);
  const orgId = cleanStr(binding.effective.organization_id, 200);

  const orgs = await col("orgs");
  const org = orgId
    ? await orgs.findOne(
      { user_id: userId, id: orgId },
      { projection: { _id: 0 } }
    )
    : null;

  return sendSuccess(res, { data: { map: map || null, org: org || null, binding }, message: "Location binding loaded" });
});

router.put("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const locationId = cleanStr(req.query.locationId, 200);
  const orgId = cleanStr(req.body?.orgId, 200);

  if (!locationId) {
    return sendError(res, { statusCode: 400, message: "locationId required", errors: [{ code: "bad_request", message: "locationId required" }] });
  }

  if (!orgId) {
    return sendError(res, { statusCode: 400, message: "orgId required", errors: [{ code: "bad_request", message: "orgId required" }] });
  }

  const locations = await col("locations");
  const loc = await locations.findOne(
    { user_id: userId, id: locationId },
    { projection: { _id: 0, id: 1, title: 1 } }
  );
  if (!loc) {
    return sendError(res, { statusCode: 404, message: "location not found", errors: [{ code: "not_found", message: "location not found" }] });
  }

  const orgs = await col("orgs");
  const org = await orgs.findOne(
    { user_id: userId, id: orgId },
    { projection: { _id: 0 } }
  );
  if (!org) {
    return sendError(res, { statusCode: 404, message: "org not found", errors: [{ code: "not_found", message: "org not found" }] });
  }

  const defaultClient = await getOrCreateDefaultClientForOrganization({
    organizationId: org.id,
    organizationName: org.name,
  });

  const now = new Date();

  const mapCol = await col("location_org_map");
  await mapCol.updateOne(
    { user_id: userId, location_id: locationId },
    {
      $set: {
        user_id: userId,
        location_id: locationId,
        org_id: org.id,
        organization_id: org.id,
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true }
  );

  await locations.updateOne(
    { user_id: userId, id: locationId },
    {
      $set: {
        org_id: org.id,
        organization_id: org.id,
        client_id: defaultClient.id,
        updated_at: now,
      },
    }
  );

  const map = await mapCol.findOne(
    { user_id: userId, location_id: locationId },
    { projection: { _id: 0 } }
  );

  const binding = normalizeLocationBinding({
    locationId,
    organizationId: org.id,
    clientId: defaultClient.id,
  });

  await auditSuccess(req, "location.bind", {
    target_type: "location",
    target_id: locationId,
    organization_id: org.id,
    client_id: defaultClient.id,
    location_id: locationId,
  });

  return sendSuccess(res, { data: {
    map,
    org,
    binding,
  }, message: "Location bound to organization" });
});

export default router;
