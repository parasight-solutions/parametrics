// apps/api/src/routes/locationOrg.js
import { Router } from "express";
import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import { getOrCreateDefaultClientForOrganization } from "../services/clients.js";

const router = Router();

function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

/**
 * Legacy compatibility route.
 *
 * Canonical write path after this change:
 * - location_org_map.org_id / organization_id
 * - locations.org_id / organization_id / client_id
 */

router.get("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const locationId = cleanStr(req.query.locationId, 200);

  if (!locationId) {
    return res.status(400).json({
      error: { code: "bad_request", message: "locationId required" },
    });
  }

  const mapCol = await col("location_org_map");
  const map = await mapCol.findOne(
    { user_id: userId, location_id: locationId },
    { projection: { _id: 0 } }
  );

  if (!map) return res.json({ map: null, org: null });

  const orgId = cleanStr(map.organization_id || map.org_id, 200);

  const orgs = await col("orgs");
  const org = orgId
    ? await orgs.findOne(
      { user_id: userId, id: orgId },
      { projection: { _id: 0 } }
    )
    : null;

  return res.json({ map, org: org || null });
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

  return res.json({
    map,
    org,
    binding: {
      location_id: locationId,
      org_id: org.id,
      organization_id: org.id,
      client_id: defaultClient.id,
    },
  });
});

export default router;