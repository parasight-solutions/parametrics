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

export function authenticate(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  const q = (req.query?.t || "").toString();

  const token = (m?.[1] || q || "").trim();
  if (!token) return sendUnauthorized(res);

  try {
    const tok = verifyJwt(token);
    req.user = { user_id: tok.user_id, role: tok.role || "individual" };
    return next();
  } catch {
    return sendUnauthorized(res);
  }
}
