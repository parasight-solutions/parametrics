// apps/api/src/routes/orgs.js
import { Router } from "express";
import crypto from "crypto";
import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import { getOrCreateDefaultClientForOrganization } from "../services/clients.js";
import { normalizeLocationBinding } from "../services/locationBinding.js";
import { auditSuccess } from "../services/auditLog.js";

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

function makeSlug(value) {
  const base = cleanStr(value, 200).toLowerCase();
  if (!base) return "";
  return base
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeStatus(value) {
  const v = cleanStr(value, 40).toLowerCase();
  if (v === "archived") return "archived";
  return "active";
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
  if (!name) {
    return res.status(400).json({
      error: { code: "bad_request", message: "name required" },
    });
  }

  const website = cleanStr(body.website, 300);
  const industry = cleanStr(body.industry, 120);
  const description = cleanStr(body.description, 2000);
  const slug = cleanStr(body.slug, 120) || makeSlug(name);
  const status = normalizeStatus(body.status);

  const onboarding = body.onboarding || {};
  const doc = {
    id,
    user_id: userId,
    owner_user_id: userId,
    name,
    slug,
    status,
    website,
    industry,
    description,

    onboarding: {
      targetAudience: cleanStr(onboarding.targetAudience, 300),
      services: arrOfStrings(onboarding.services, 30, 60),
      keywords: arrOfStrings(onboarding.keywords, 50, 40),
      tone: cleanStr(onboarding.tone, 80),
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
  const existing = await orgs.findOne(
    { user_id: userId, id },
    { projection: { _id: 0, created_at: 1 } }
  );

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

  const saved = await orgs.findOne(
    { user_id: userId, id },
    { projection: { _id: 0 } }
  );

  return res.json({ org: saved });
});

// bind location -> organization
// dual-writes:
// - locations.organization_id  (canonical)
// - locations.client_id        (canonical)
// - locations.org_id           (legacy compatibility)
// - location_org_map           (legacy bridge, still kept for now)
router.post("/bind-location", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const { locationId, orgId } = req.body || {};

  const locId = cleanStr(locationId, 200);
  const oId = cleanStr(orgId, 200);

  if (!locId || !oId) {
    return res.status(400).json({
      error: {
        code: "bad_request",
        message: "locationId and orgId required",
      },
    });
  }

  const orgs = await col("orgs");
  const org = await orgs.findOne(
    { user_id: userId, id: oId },
    { projection: { _id: 0, id: 1, name: 1 } }
  );
  if (!org) {
    return res.status(404).json({
      error: { code: "not_found", message: "org not found" },
    });
  }

  const locations = await col("locations");
  const existingLocation = await locations.findOne(
    { user_id: userId, id: locId },
    { projection: { _id: 0, id: 1 } }
  );
  if (!existingLocation) {
    return res.status(404).json({
      error: { code: "not_found", message: "location not found" },
    });
  }

  const defaultClient = await getOrCreateDefaultClientForOrganization({
    organizationId: org.id,
    organizationName: org.name,
  });

  const now = new Date();

  await locations.updateOne(
    { user_id: userId, id: locId },
    {
      $set: {
        org_id: org.id,
        organization_id: org.id,
        client_id: defaultClient.id,
        updated_at: now,
      },
    }
  );

  const mapCol = await col("location_org_map");
  await mapCol.updateOne(
    { user_id: userId, location_id: locId },
    {
      $set: {
        user_id: userId,
        location_id: locId,
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

  const binding = normalizeLocationBinding({
    locationId: locId,
    organizationId: org.id,
    clientId: defaultClient.id,
  });

  await auditSuccess(req, "location.bind", {
    target_type: "location",
    target_id: locId,
    organization_id: org.id,
    client_id: defaultClient.id,
    location_id: locId,
  });

  return res.json({
    ok: true,
    binding,
  });
});

export default router;
