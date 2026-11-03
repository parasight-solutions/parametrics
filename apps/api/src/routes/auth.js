import { Router } from "express";
import bcrypt from "bcryptjs";

import { col } from "../lib/mongo.js";
import { authenticate as defaultAuthenticate } from "../middleware/auth.js";
import { authRateLimit } from "../middleware/rateLimit.js";
import { auditFailure as defaultAuditFailure, auditSuccess as defaultAuditSuccess } from "../services/auditLog.js";
import {
  clearSessionCookie as defaultClearSessionCookie,
  createSession as defaultCreateSession,
  readSessionToken as defaultReadSessionToken,
  resolveSession as defaultResolveSession,
  revokeSession as defaultRevokeSession,
  setSessionCookie as defaultSetSessionCookie,
} from "../services/authSessions.js";

function publicUser(user) {
  return {
    id: String(user.id),
    email: user.email,
    role: user.role || "user",
  };
}

export function createAuthRouter({
  getUsers = () => col("users"),
  comparePassword = bcrypt.compare,
  createSession = defaultCreateSession,
  resolveSession = defaultResolveSession,
  revokeSession = defaultRevokeSession,
  readSessionToken = defaultReadSessionToken,
  setSessionCookie = defaultSetSessionCookie,
  clearSessionCookie = defaultClearSessionCookie,
  auditSuccess = defaultAuditSuccess,
  auditFailure = defaultAuditFailure,
  authenticate = defaultAuthenticate,
} = {}) {
  const router = Router();

  router.post("/login", authRateLimit, async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        await auditFailure(req, "auth.login", {
          target_type: "user",
          metadata: {
            email: email ? String(email).trim().toLowerCase() : null,
            reason: "missing_credentials",
          },
        });
        return res.status(400).json({ error: { code: "bad_request" } });
      }

      const normalized = String(email).trim().toLowerCase();
      const users = await getUsers();
      const user =
        (await users.findOne({ normalized_email: normalized })) ||
        (await users.findOne({ email: new RegExp(`^${normalized}$`, "i") }));

      if (!user || !user.password || !(await comparePassword(password, user.password))) {
        await auditFailure(req, "auth.login", {
          target_type: "user",
          target_id: user?.id,
          metadata: { email: normalized, reason: "invalid_credentials" },
        });
        return res.status(401).json({ error: { code: "invalid" } });
      }

      const currentToken = readSessionToken(req);
      if (currentToken) await revokeSession(currentToken);

      const userData = publicUser(user);
      const rawSession = await createSession(userData.id);
      setSessionCookie(res, rawSession);

      await auditSuccess(req, "auth.login", {
        actor_user_id: userData.id,
        actor_role: userData.role,
        target_type: "user",
        target_id: userData.id,
        metadata: { email: normalized },
      });

      return res.json({ user: userData });
    } catch (error) {
      console.error("[auth/login] error", error);
      return res.status(500).json({ error: { code: "server_error" } });
    }
  });

  router.get("/session", authenticate, async (req, res) => {
    try {
      const users = await getUsers();
      const user = await users.findOne({ id: String(req.user.user_id) });
      if (!user) return res.status(401).json({ error: { code: "unauthorized" } });
      return res.json({ user: publicUser(user) });
    } catch (error) {
      console.error("[auth/session] error", error);
      return res.status(500).json({ error: { code: "server_error" } });
    }
  });

  router.post("/logout", async (req, res) => {
    const rawToken = readSessionToken(req);
    let session = null;

    try {
      if (rawToken) {
        session = await resolveSession(rawToken);
        await revokeSession(rawToken);
      }

      if (session?.user_id || req.user?.user_id) {
        await auditSuccess(req, "auth.logout", {
          actor_user_id: req.user?.user_id || session.user_id,
          actor_role: req.user?.role,
          target_type: "user",
          target_id: req.user?.user_id || session.user_id,
        });
      }
    } catch (error) {
      console.error("[auth/logout] error", error);
    } finally {
      clearSessionCookie(res);
    }

    return res.status(204).send();
  });

  return router;
}

export const auth = createAuthRouter();
export default auth;
