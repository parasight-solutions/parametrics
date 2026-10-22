// Debug routes are local-only and opt-in: they are mounted (and served) only
// when NODE_ENV is development/test AND ENABLE_DEBUG_ROUTES=true.
const LOCAL_ENVS = new Set(["development", "test"]);

export function isDebugRoutesEnabled(env = process.env) {
  const envName = String(env.NODE_ENV || "").trim().toLowerCase();
  const flag = String(env.ENABLE_DEBUG_ROUTES || "").trim().toLowerCase();
  return LOCAL_ENVS.has(envName) && flag === "true";
}

// Defense in depth for a router that is mounted anyway: re-check at request
// time and fall through as if the router did not exist.
export function requireDebugRoutesEnabled(_req, _res, next) {
  if (!isDebugRoutesEnabled()) return next("router");
  return next();
}

// Error reasons are fixed codes only; provider messages and bodies can carry
// token or account details.
export function debugReason(err) {
  const code = String(err?.code || "");
  return /^[a-z_]{1,64}$/.test(code) ? code : "error";
}
