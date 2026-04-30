// apps/api/src/routes/locationOrg.js
import { Router } from "express";
import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import { getOrCreateDefaultClientForOrganization } from "../services/clients.js";
import {
  normalizeLocationBinding,
  resolveCanonicalLocationScope,
} from "../services/locationBinding.js";

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
    return res.status(400).json({
      error: { code: "bad_request", message: "locationId required" },
    });
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

  if (!loc && !map) return res.json({ map: null, org: null, binding: null });

  const binding = resolveCanonicalLocationScope(loc, map);
  const orgId = cleanStr(binding.effective.organization_id, 200);

  const orgs = await col("orgs");
  const org = orgId
    ? await orgs.findOne(
      { user_id: userId, id: orgId },
      { projection: { _id: 0 } }
    )
    : null;

  return res.json({ map: map || null, org: org || null, binding });
});

router.put("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const locationId = cleanStr(req.query.locationId, 200);
  const orgId = cleanStr(req.body?.orgId, 200);

  if (!locationId) {
    return res.status(400).json({
      error: { code: "bad_request", message: "locationId required" },
    });
  }

  if (!orgId) {
    return res.status(400).json({
      error: { code: "bad_request", message: "orgId required" },
    });
  }

  const locations = await col("locations");
  const loc = await locations.findOne(
    { user_id: userId, id: locationId },
    { projection: { _id: 0, id: 1, title: 1 } }
  );
  if (!loc) {
    return res.status(404).json({
      error: { code: "not_found", message: "location not found" },
    });
  }

  const orgs = await col("orgs");
  const org = await orgs.findOne(
    { user_id: userId, id: orgId },
    { projection: { _id: 0 } }
  );
  if (!org) {
    return res.status(404).json({
      error: { code: "not_found", message: "org not found" },
    });
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

  return res.json({
    map,
    org,
    binding,
  });
});

export default router;
