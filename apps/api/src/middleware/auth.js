// apps/api/src/middleware/auth.js
import { col } from "../lib/mongo.js";
import { readSessionToken, resolveSession } from "../services/authSessions.js";

function sendUnauthorized(res) {
  return res.status(401).json({
    error: {
      code: "unauthorized",
      message: "Unauthorized",
    },
  });
}

function isActiveUser(user) {
  if (!user || user.deleted === true || user.disabled === true) return false;
  const status = String(user.status || "").trim().toLowerCase();
  return !["disabled", "deleted", "inactive"].includes(status);
}

export function createAuthenticate({
  readToken = readSessionToken,
  resolve = resolveSession,
  findUser = async (userId) => {
    const users = await col("users");
    return users.findOne(
      { id: String(userId) },
      { projection: { id: 1, role: 1, status: 1, disabled: 1, deleted: 1 } },
    );
  },
} = {}) {
  return async function authenticate(req, res, next) {
    const token = readToken(req);
    if (!token) return sendUnauthorized(res);

    try {
      const session = await resolve(token);
      if (!session?.user_id) return sendUnauthorized(res);

      const user = await findUser(session.user_id);
      if (!isActiveUser(user)) return sendUnauthorized(res);

      req.authSession = session;
      req.user = {
        user_id: String(user.id),
        role: user.role || "individual",
      };
      return next();
    } catch (error) {
      console.error("[auth] session lookup failed", error);
      return res.status(500).json({
        error: { code: "server_error", message: "Authentication unavailable" },
      });
    }
  };
}

export const authenticate = createAuthenticate();
