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

const router = Router();

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

      if (!integ) return res.json({ locations: [], activeIntegrationId: null });

      q.integration_id = integ.id;
      const list = await locations
        .find(q)
        .sort({ updated_at: -1 })
        .project({ _id: 0 })
        .toArray();

      return res.json({ locations: list, activeIntegrationId: integ.id });
    }

    if (integrationIdParam) q.integration_id = integrationIdParam;

    const list = await locations
      .find(q)
      .sort({ updated_at: -1 })
      .project({ _id: 0 })
      .toArray();

    return res.json({ locations: list, activeIntegrationId: null });
  } catch (e) {
    console.error("[locations/list] error", e);
    return res.status(500).json({ error: { code: "server_error" } });
  }
});

router.delete("/:id", authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const id = String(req.params.id || "").trim();

    const loc = await requireOwnedLocation(userId, id);

    const c = await col("locations");
    await c.deleteOne({
      id: loc.id,
      user_id: loc.user_id,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
    });

    return res.json({ ok: true });
  } catch (e) {
    return toApiError(res, e);
  }
});

export default router;