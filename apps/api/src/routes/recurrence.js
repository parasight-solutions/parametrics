// apps/api/src/routes/recurrence.js
import { Router } from "express";
import crypto from "crypto";
import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import { generationRateLimit, mutationRateLimit } from "../middleware/rateLimit.js";
import { planForRule } from "../services/recurrencePlanner.js";
import {
  buildLocationScopeFilter,
  toApiError,
} from "../services/ownership.js";
import { requireOwnedOrganizationLocationAccess } from "../services/organizationAccess.js";
import { auditFailure, auditSuccess } from "../services/auditLog.js";

const router = Router();
const LOCATION_READ_ROLES = Object.freeze(["owner", "admin", "manager", "viewer"]);
const LOCATION_OPERATION_ROLES = Object.freeze(["owner", "admin", "manager"]);

const BOOL = (v) => v === true || v === "true" || v === 1 || v === "1";

function isValidTz(tz) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normHHMM(s) {
  const m = String(s || "").trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function clampInt(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  const v = Math.floor(x);
  if (v < lo || v > hi) return null;
  return v;
}

const FREQ = new Set(["daily", "weekly", "monthly", "yearly"]);
const MODE = new Set(["auto", "manual"]);

router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locationId = String(req.query.locationId || "").trim();
    if (!locationId) {
      return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });
    }

    const { location: loc } = await requireOwnedOrganizationLocationAccess({
      userId,
      locationId,
      provider: "google",
      allowedRoles: LOCATION_READ_ROLES,
    });

    const rules = await col("recurrence_rules");
    const rule = await rules.findOne(
      buildLocationScopeFilter(loc),
      { projection: { _id: 0 } }
    );

    return res.json({ rule: rule || null });
  } catch (e) {
    return toApiError(res, e);
  }
});

router.put("/", authenticate, mutationRateLimit, async (req, res) => {
  let auditTarget = {};
  try {
    const userId = req.user.user_id;
    const locationId = String(req.query.locationId || "").trim();
    if (!locationId) {
      return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });
    }

    const { location: loc, membership } = await requireOwnedOrganizationLocationAccess({
      userId,
      locationId,
      provider: "google",
      allowedRoles: LOCATION_OPERATION_ROLES,
    });
    auditTarget = {
      target_type: "recurrence_rule",
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
      provider: "google",
      metadata: { membership_role: membership.role },
    };

    const body = req.body || {};

    const enabled = !!body.enabled;
    const mode = String(body.mode || "manual").trim().toLowerCase();
    const frequency = String(body.frequency || "weekly").trim().toLowerCase();
    const count = clampInt(body.count ?? body.postsPerPeriod ?? 1, 1, 30);

    const timezone = String(body.timezone || "Asia/Kolkata").trim();
    const windowStart = normHHMM(body.windowStart || body.window_start || "10:00");
    const windowEnd = normHHMM(body.windowEnd || body.window_end || "18:00");

    const template = body.template || {};
    const aiImageEnabled = BOOL(body.ai_image_enabled ?? body.aiImageEnabled ?? false);
    const templateSummary = String(template.summary ?? body.template_summary ?? "").trim();
    const templateImageUrl = template.imageUrl ?? body.template_image_url ?? null;
    const templateCtaUrl = template.callToActionUrl ?? body.template_cta_url ?? null;
    const templateCtaType = template.callToActionType ?? body.template_cta_type ?? null;
    const templateLanguageCode = template.languageCode ?? body.template_language_code ?? "en-US";
    const templateTopicType = template.topicType ?? body.template_topic_type ?? "STANDARD";

    if (!MODE.has(mode)) {
      return res.status(400).json({ error: { code: "bad_request", message: "mode must be auto|manual" } });
    }
    if (!FREQ.has(frequency)) {
      return res.status(400).json({ error: { code: "bad_request", message: "frequency must be daily|weekly|monthly|yearly" } });
    }
    if (!count) {
      return res.status(400).json({ error: { code: "bad_request", message: "count must be 1..30" } });
    }
    if (!isValidTz(timezone)) {
      return res.status(400).json({ error: { code: "bad_request", message: "invalid timezone" } });
    }
    if (!windowStart || !windowEnd) {
      return res.status(400).json({ error: { code: "bad_request", message: "windowStart/windowEnd must be HH:MM" } });
    }
    if (windowEnd <= windowStart) {
      return res.status(400).json({ error: { code: "bad_request", message: "windowEnd must be after windowStart" } });
    }
    if (enabled && !templateSummary) {
      return res.status(400).json({ error: { code: "bad_request", message: "template.summary is required when enabled" } });
    }

    const MAX_PER_DAY = 10;
    if (frequency === "daily" && count > MAX_PER_DAY) {
      return res.status(400).json({ error: { code: "bad_request", message: `daily count too high (max ${MAX_PER_DAY})` } });
    }

    const rules = await col("recurrence_rules");
    const now = new Date();

    const existing = await rules.findOne(
      buildLocationScopeFilter(loc),
      { projection: { id: 1, enabled: 1, mode: 1 } }
    );

    const doc = {
      id: existing?.id || crypto.randomUUID(),
      user_id: userId,
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: locationId,

      enabled,
      mode,
      frequency,
      count,
      timezone,
      window_start: windowStart,
      window_end: windowEnd,

      template_summary: templateSummary,
      template_image_url: templateImageUrl ? String(templateImageUrl) : null,
      template_cta_url: templateCtaUrl ? String(templateCtaUrl) : null,
      template_cta_type: templateCtaType ? String(templateCtaType).trim().toUpperCase() : null,
      template_language_code: String(templateLanguageCode || "en-US").trim(),
      template_topic_type: String(templateTopicType || "STANDARD").trim().toUpperCase(),

      last_planned_at: null,
      last_error: null,

      created_at: existing ? undefined : now,
      updated_at: now,
      ai_image_enabled: aiImageEnabled,
    };

    const setDoc = { ...doc };
    delete setDoc.created_at;

    await rules.updateOne(
      buildLocationScopeFilter(loc),
      {
        $set: setDoc,
        $setOnInsert: { created_at: now },
      },
      { upsert: true }
    );

    try {
      const posts = await col("posts");
      const now2 = new Date();
      const ruleId = doc.id;

      const disabling = !!existing?.enabled && !enabled;
      const autoToManual =
        String(existing?.mode || "").toLowerCase() === "auto" &&
        mode === "manual";

      if (disabling || autoToManual) {
        await posts.updateMany(
          {
            user_id: userId,
            organization_id: loc.organization_id,
            client_id: loc.client_id,
            location_id: locationId,
            recurrence_rule_id: ruleId,
            provider_post_name: null,
            status: { $in: ["scheduled", "queued"] },
            scheduled_at: { $gte: now2 },
          },
          {
            $set: {
              status: "draft",
              scheduled_at: null,
              auto_publish_at: null,
              recurrence_mode: "manual",
              updated_at: now2,
            },
          }
        );
      }
    } catch (e) {
      console.error("[recurrence] cancel future scheduled posts failed", e?.message || e);
    }

    const saved = await rules.findOne(
      buildLocationScopeFilter(loc),
      { projection: { _id: 0 } }
    );

    await auditSuccess(req, "recurrence.rule.upsert", {
      ...auditTarget,
      target_id: saved?.id || doc.id,
      metadata: { ...(auditTarget.metadata || {}), enabled, mode, frequency, count },
    });

    return res.json({ rule: saved });
  } catch (e) {
    await auditFailure(req, "recurrence.rule.upsert", {
      ...auditTarget,
      metadata: { ...(auditTarget.metadata || {}), reason: e?.message || e?.code || "server_error" },
    });
    return toApiError(res, e);
  }
});

router.get("/posts", authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locationId = String(req.query.locationId || "").trim();
    if (!locationId) {
      return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });
    }

    const { location: loc } = await requireOwnedOrganizationLocationAccess({
      userId,
      locationId,
      provider: "google",
      allowedRoles: LOCATION_READ_ROLES,
    });

    const posts = await col("posts");
    const rows = await posts
      .find(
        {
          user_id: userId,
          organization_id: loc.organization_id,
          client_id: loc.client_id,
          location_id: locationId,
          recurrence_rule_id: { $ne: null },
        },
        { projection: { _id: 0 } }
      )
      .sort({ planned_for: -1 })
      .limit(200)
      .toArray();

    return res.json({ posts: rows });
  } catch (e) {
    return toApiError(res, e);
  }
});

router.post("/plan-now", authenticate, generationRateLimit, async (req, res) => {
  let auditTarget = {};
  try {
    const userId = req.user.user_id;
    const locationId = String(req.query.locationId || "").trim();
    if (!locationId) {
      return res.status(400).json({ error: { code: "bad_request", message: "locationId required" } });
    }

    const { location: loc, membership } = await requireOwnedOrganizationLocationAccess({
      userId,
      locationId,
      provider: "google",
      allowedRoles: LOCATION_OPERATION_ROLES,
    });
    auditTarget = {
      target_type: "recurrence_rule",
      organization_id: loc.organization_id,
      client_id: loc.client_id,
      location_id: loc.id,
      provider: "google",
      metadata: { membership_role: membership.role },
    };

    const rules = await col("recurrence_rules");
    const rule = await rules.findOne(
      {
        ...buildLocationScopeFilter(loc),
        enabled: true,
      },
      { projection: { _id: 0 } }
    );

    if (!rule) {
      return res.status(404).json({ error: { code: "not_found", message: "enabled rule not found" } });
    }

    const out = await planForRule(rule);
    await auditSuccess(req, "recurrence.plan_now", {
      ...auditTarget,
      target_id: rule.id,
      metadata: {
        ...(auditTarget.metadata || {}),
        planned: out?.planned ?? null,
        skipped: out?.skipped ?? null,
      },
    });
    return res.json({ ok: true, ...out });
  } catch (e) {
    await auditFailure(req, "recurrence.plan_now", {
      ...auditTarget,
      metadata: { ...(auditTarget.metadata || {}), reason: e?.message || e?.code || "server_error" },
    });
    return toApiError(res, e);
  }
});

export default router;
