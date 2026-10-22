// apps/api/src/middleware/auth.js
import { verifyJwt } from "../lib/jwt.js";

function sendUnauthorized(res) {
  return res.status(401).json({
    error: {
      code: "unauthorized",
      message: "Unauthorized",
    },
  });
}

// Bearer header only: app JWTs are never accepted from the query string
// (S2-33). Signed tokens without a user_id (e.g. OAuth state JWTs that share
// the signing secret) are not app sessions.
export function authenticate(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);

  const token = (m?.[1] || "").trim();
  if (!token) return sendUnauthorized(res);

  try {
    const tok = verifyJwt(token);
    if (!tok?.user_id) return sendUnauthorized(res);
    req.user = { user_id: tok.user_id, role: tok.role || "individual" };
    return next();
  } catch {
    return sendUnauthorized(res);
  }
}
