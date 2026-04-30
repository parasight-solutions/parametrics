// apps/api/src/routes/auth.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import { col } from "../lib/mongo.js";
import { signJwt } from "../lib/jwt.js";
import { authRateLimit } from "../middleware/rateLimit.js";
import { auditFailure, auditSuccess } from "../services/auditLog.js";

export const auth = Router();

/**
 * POST /api/v1/auth/login
 * body: { email, password }
 */
auth.post("/login", authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      await auditFailure(req, "auth.login", {
        target_type: "user",
        metadata: { email: email ? String(email).trim().toLowerCase() : null, reason: "missing_credentials" },
      });
      return res.status(400).json({ error: { code: "bad_request" } });
    }

    const normalized = String(email).trim().toLowerCase();
    const users = await col("users");

    const user =
      (await users.findOne({ normalized_email: normalized })) ||
      (await users.findOne({ email: new RegExp(`^${normalized}$`, "i") }));

    if (!user || !user.password) {
      await auditFailure(req, "auth.login", {
        target_type: "user",
        metadata: { email: normalized, reason: "invalid_credentials" },
      });
      return res.status(401).json({ error: { code: "invalid" } });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      await auditFailure(req, "auth.login", {
        target_type: "user",
        target_id: user.id,
        metadata: { email: normalized, reason: "invalid_credentials" },
      });
      return res.status(401).json({ error: { code: "invalid" } });
    }

    const role = user.role || "user";
    const token = signJwt({ user_id: user.id, role, email: user.email });
    await auditSuccess(req, "auth.login", {
      actor_user_id: user.id,
      actor_role: role,
      target_type: "user",
      target_id: user.id,
      metadata: { email: normalized },
    });

    return res.json({
      token,
      user: { id: user.id, email: user.email, role },
    });
  } catch (e) {
    console.error("[auth/login] error", e);
    return res.status(500).json({ error: { code: "server_error" } });
  }
});

export default auth;
