import { Router } from "express";
import { resolvePostAutoSyncConfig } from "../config/postAutoSyncConfig.js";
import { col, withMongoTransaction } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import { mutationRateLimit } from "../middleware/rateLimit.js";
import {
  requireOrganizationLocationAccess,
  requireOrganizationMembership,
} from "../services/organizationAccess.js";
import { toApiError } from "../services/ownership.js";
import {
  listPostAutoSyncSettings,
  setLocationPostAutoSync,
  setScopedPostAutoSync,
} from "../services/postAutoSyncSettings.js";

const router = Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const config = resolvePostAutoSyncConfig();
    const result = await listPostAutoSyncSettings({
      userId: req.user.user_id,
      organizationId: req.query.organizationId,
      integrationId: req.query.integrationId,
    }, {
      locations: await col("locations"),
      requireMembership: requireOrganizationMembership,
      intervalMinutes: config.intervalMinutes,
    });
    return res.json(result);
  } catch (error) {
    return toApiError(res, error);
  }
});

router.patch("/locations/:locationId", authenticate, mutationRateLimit, async (req, res) => {
  try {
    const result = await setLocationPostAutoSync({
      userId: req.user.user_id,
      locationId: req.params.locationId,
      enabled: req.body?.enabled,
    }, {
      locations: await col("locations"),
      requireLocationAccess: requireOrganizationLocationAccess,
    });
    return res.json(result);
  } catch (error) {
    return toApiError(res, error);
  }
});

router.patch("/", authenticate, mutationRateLimit, async (req, res) => {
  try {
    const result = await setScopedPostAutoSync({
      userId: req.user.user_id,
      organizationId: req.body?.organizationId,
      integrationId: req.body?.integrationId,
      enabled: req.body?.enabled,
    }, {
      locations: await col("locations"),
      requireMembership: requireOrganizationMembership,
      withTransaction: withMongoTransaction,
    });
    return res.json(result);
  } catch (error) {
    return toApiError(res, error);
  }
});

export default router;
