// apps/api/src/routes/orgs.js
import { Router } from "express";
import crypto from "crypto";
import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

function cleanStr(s, max = 5000) {
  const v = String(s ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function arrOfStrings(v, maxItems = 50, maxLen = 80) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => cleanStr(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

// list orgs
router.get("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const orgs = await col("orgs");

  const rows = await orgs
    .find({ user_id: userId }, { projection: { _id: 0 } })
    .sort({ updated_at: -1 })
    .limit(50)
    .toArray();

  return res.json({ orgs: rows });
});

// upsert org
router.post("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const body = req.body || {};

  const id = cleanStr(body.id) || crypto.randomUUID();
  const name = cleanStr(body.name, 200);
  if (!name) return res.status(400).json({ error: { code: "bad_request", message: "name required" } });

  const website = cleanStr(body.website, 300);
  const industry = cleanStr(body.industry, 120);
  const description = cleanStr(body.description, 2000);

  const onboarding = body.onboarding || {};
  const doc = {
    id,
    user_id: userId,
    name,
    website,
    industry,
    description,

    // onboarding drives AI behavior
    onboarding: {
      targetAudience: cleanStr(onboarding.targetAudience, 300),
      services: arrOfStrings(onboarding.services, 30, 60),
      keywords: arrOfStrings(onboarding.keywords, 50, 40),
      tone: cleanStr(onboarding.tone, 80), // e.g. professional, friendly, luxury
      offers: cleanStr(onboarding.offers, 300),
      doNotMention: cleanStr(onboarding.doNotMention, 300),
      language: cleanStr(onboarding.language, 20) || "en",
      goals: arrOfStrings(onboarding.goals, 20, 60),
    },

    brand: {
      primaryColor: cleanStr(body.brand?.primaryColor, 32),
      logoUrl: cleanStr(body.brand?.logoUrl, 500),
    },

    created_at: body.created_at ? new Date(body.created_at) : undefined,
    updated_at: new Date(),
  };

  const orgs = await col("orgs");
  const existing = await orgs.findOne({ user_id: userId, id }, { projection: { _id: 0, created_at: 1 } });

  await orgs.updateOne(
    { user_id: userId, id },
    {
      $set: {
        ...doc,
        created_at: existing?.created_at || new Date(),
      },
    },
    { upsert: true }
  );

  const saved = await orgs.findOne({ user_id: userId, id }, { projection: { _id: 0 } });
  return res.json({ org: saved });
});

// bind location -> org (stores org_id inside locations doc)
router.post("/bind-location", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const { locationId, orgId } = req.body || {};

  const locId = cleanStr(locationId, 200);
  const oId = cleanStr(orgId, 200);
  if (!locId || !oId) {
    return res.status(400).json({ error: { code: "bad_request", message: "locationId and orgId required" } });
  }

  const orgs = await col("orgs");
  const org = await orgs.findOne({ user_id: userId, id: oId }, { projection: { _id: 0, id: 1 } });
  if (!org) return res.status(404).json({ error: { code: "not_found", message: "org not found" } });

  const locations = await col("locations");
  const r = await locations.updateOne(
    { user_id: userId, id: locId },
    { $set: { org_id: oId, updated_at: new Date() } }
  );

  if (!r.matchedCount) return res.status(404).json({ error: { code: "not_found", message: "location not found" } });
  return res.json({ ok: true });
});

export default router;
