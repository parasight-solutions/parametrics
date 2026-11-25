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
import { sendError, sendSuccess } from "../utils/apiResponse.js";

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
        return sendError(res, {
          statusCode: 400,
          message: "Email and password are required",
          errors: [{ code: "bad_request", message: "Email and password are required" }],
        });
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
        return sendError(res, {
          statusCode: 401,
          message: "Invalid email or password",
          errors: [{ code: "invalid", message: "Invalid email or password" }],
        });
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

      return sendSuccess(res, { data: { user: userData }, message: "Login successful" });
    } catch (error) {
      console.error("[auth/login] error", error);
      return sendError(res, {
        statusCode: 500,
        message: "Unable to log in",
        errors: [{ code: "server_error", message: "Unable to log in" }],
      });
    }
  });

  router.get("/session", authenticate, async (req, res) => {
    try {
      const users = await getUsers();
      const user = await users.findOne({ id: String(req.user.user_id) });
      if (!user) return sendError(res, {
        statusCode: 401,
        message: "Authentication required",
        errors: [{ code: "unauthorized", message: "Authentication required" }],
      });
      return sendSuccess(res, {
        data: { user: publicUser(user) },
        message: "Session restored",
      });
    } catch (error) {
      console.error("[auth/session] error", error);
      return sendError(res, {
        statusCode: 500,
        message: "Unable to restore session",
        errors: [{ code: "server_error", message: "Unable to restore session" }],
      });
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
