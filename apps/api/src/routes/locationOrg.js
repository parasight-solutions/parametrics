// apps/api/src/routes/locationOrg.js
import { Router } from "express";
import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

/**
 * Maps a GBP location to an org (company).
 * doc: { user_id, location_id, org_id, created_at, updated_at }
 */

router.get("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const locationId = String(req.query.locationId || "").trim();
  if (!locationId) return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });

  const mapCol = await col("location_org_map");
  const map = await mapCol.findOne({ user_id: userId, location_id: locationId }, { projection: { _id: 0 } });

  if (!map) return res.json({ map: null, org: null });

  const orgs = await col("orgs");
  const org = await orgs.findOne({ user_id: userId, id: map.org_id }, { projection: { _id: 0 } });

  res.json({ map, org: org || null });
});

router.put("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const locationId = String(req.query.locationId || "").trim();
  const orgId = String(req.body?.orgId || "").trim();

  if (!locationId) return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });
  if (!orgId) return res.status(400).json({ error: { code: "bad_request", message: "orgId required" } });

  // Validate location belongs to user
  const locations = await col("locations");
  const loc = await locations.findOne({ user_id: userId, id: locationId });
  if (!loc) return res.status(404).json({ error: { code: "not_found", message: "location not found" } });

  // Validate org belongs to user
  const orgs = await col("orgs");
  const org = await orgs.findOne({ user_id: userId, id: orgId }, { projection: { _id: 0 } });
  if (!org) return res.status(404).json({ error: { code: "not_found", message: "org not found" } });

  const mapCol = await col("location_org_map");
  const now = new Date();
  await mapCol.updateOne(
    { user_id: userId, location_id: locationId },
    { $set: { user_id: userId, location_id: locationId, org_id: orgId, updated_at: now }, $setOnInsert: { created_at: now } },
    { upsert: true }
  );

  const map = await mapCol.findOne({ user_id: userId, location_id: locationId }, { projection: { _id: 0 } });
  res.json({ map, org });
});

export default router;
