const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function cleanStr(value, max = 1000) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function normalizeOrigin(value) {
  const raw = cleanStr(value);
  if (!raw) return "";

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function parseCorsOrigins(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((item) => normalizeOrigin(item))
        .filter(Boolean)
    )
  );
}

function runtimeEnv(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase();
}

function isLocalEnvironment(env = process.env) {
  const envName = runtimeEnv(env);
  return envName === "development" || envName === "test";
}

function hasWildcardOrigin(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .some((item) => item === "*");
}

export function isLocalhostOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  try {
    const url = new URL(normalized);
    return LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function resolveAllowedOrigins(env = process.env) {
  if (hasWildcardOrigin(env.CORS_ORIGINS)) {
    throw new Error("CORS_ORIGINS must not include wildcard origins");
  }

  const configured = parseCorsOrigins(env.CORS_ORIGINS);
  const local = isLocalEnvironment(env);

  if (local) return configured;

  if (!configured.length) {
    const name = runtimeEnv(env) || "non-local";
    throw new Error(`CORS_ORIGINS is required when NODE_ENV=${name}`);
  }

  return configured;
}

export function createCorsOptions(env = process.env) {
  const allowedOrigins = resolveAllowedOrigins(env);
  const local = isLocalEnvironment(env);

  return {
    origin(origin, cb) {
      if (!origin) return cb(null, false);

      const normalized = normalizeOrigin(origin);
      const allowed =
        allowedOrigins.includes(normalized) ||
        (local && isLocalhostOrigin(normalized));

      if (allowed) return cb(null, normalized);

      return cb(new Error(`CORS origin not allowed: ${origin}`), false);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  };
}
