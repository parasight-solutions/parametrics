// apps/api/src/middleware/auth.js
import { verifyJwt } from "../lib/jwt.js";

const IS_PROD = (process.env.NODE_ENV || "development") === "production";

function unsafeParseJwt(t) {
  try {
    const parts = String(t).split(".");
    if (parts.length < 2) return null;
    const p = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (p.length % 4)) % 4);
    return JSON.parse(Buffer.from(p + pad, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function authenticate(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  const q = (req.query?.t || "").toString();

  const token = (m?.[1] || q || "").trim();
  if (!token) return res.status(401).json({ error: { code: "unauthorized" } });

  try {
    const tok = verifyJwt(token);
    req.user = { user_id: tok.user_id, role: tok.role || "individual" };
    return next();
  } catch (e) {
    // DEV-only fallback (same behavior you already rely on in /integrations/google/start)
    if (!IS_PROD) {
      const dec = unsafeParseJwt(token);
      if (dec?.user_id) {
        console.warn("[auth] DEV accept unsigned jwt for user_id=", dec.user_id);
        req.user = { user_id: dec.user_id, role: dec.role || "individual" };
        return next();
      }
    }
    return res.status(401).json({ error: { code: "unauthorized" } });
  }
}
