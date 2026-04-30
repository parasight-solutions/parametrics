const DEFAULT_WINDOW_SECONDS = 10 * 60;

const DEFAULT_LIMITS = {
  auth: 10,
  oauth: 20,
  upload: 30,
  sync: 10,
  generation: 20,
  mutation: 120,
};

const DEFAULT_ENV_KEYS = {
  windowSeconds: "RATE_LIMIT_WINDOW_SECONDS",
  auth: "RATE_LIMIT_AUTH_MAX",
  oauth: "RATE_LIMIT_OAUTH_MAX",
  upload: "RATE_LIMIT_UPLOAD_MAX",
  sync: "RATE_LIMIT_SYNC_MAX",
  generation: "RATE_LIMIT_GENERATION_MAX",
  mutation: "RATE_LIMIT_MUTATION_MAX",
};

const sharedStore = new Map();

function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
}

export function resolveRateLimitConfig(env = process.env) {
  const windowSeconds = positiveInt(
    env[DEFAULT_ENV_KEYS.windowSeconds],
    DEFAULT_WINDOW_SECONDS
  );

  return {
    windowSeconds,
    limits: {
      auth: positiveInt(env[DEFAULT_ENV_KEYS.auth], DEFAULT_LIMITS.auth),
      oauth: positiveInt(env[DEFAULT_ENV_KEYS.oauth], DEFAULT_LIMITS.oauth),
      upload: positiveInt(env[DEFAULT_ENV_KEYS.upload], DEFAULT_LIMITS.upload),
      sync: positiveInt(env[DEFAULT_ENV_KEYS.sync], DEFAULT_LIMITS.sync),
      generation: positiveInt(env[DEFAULT_ENV_KEYS.generation], DEFAULT_LIMITS.generation),
      mutation: positiveInt(env[DEFAULT_ENV_KEYS.mutation], DEFAULT_LIMITS.mutation),
    },
  };
}

export function getClientIdentity(req) {
  const userId = cleanStr(req?.user?.user_id || req?.user?.id, 200);
  if (userId) return `user:${userId}`;

  const forwarded = cleanStr(req?.headers?.["x-forwarded-for"], 500)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0];

  const ip =
    forwarded ||
    cleanStr(req?.ip, 200) ||
    cleanStr(req?.socket?.remoteAddress, 200) ||
    "unknown";

  return `ip:${ip}`;
}

export function buildRateLimitKey({ action, req }) {
  return `${cleanStr(action, 120) || "default"}:${getClientIdentity(req)}`;
}

export function checkRateLimit({
  key,
  max,
  windowSeconds,
  nowMs = Date.now(),
  store = sharedStore,
}) {
  const windowMs = Math.max(1, Number(windowSeconds || DEFAULT_WINDOW_SECONDS)) * 1000;
  const limit = Math.max(1, Number(max || 1));
  const existing = store.get(key);

  if (!existing || existing.resetAt <= nowMs) {
    const fresh = { count: 1, resetAt: nowMs + windowMs };
    store.set(key, fresh);
    return {
      limited: false,
      remaining: limit - 1,
      retryAfterSeconds: 0,
      resetAt: fresh.resetAt,
    };
  }

  if (existing.count >= limit) {
    return {
      limited: true,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    limited: false,
    remaining: limit - existing.count,
    retryAfterSeconds: 0,
    resetAt: existing.resetAt,
  };
}

function sendRateLimited(res, outcome) {
  const retryAfter = Math.max(1, Number(outcome.retryAfterSeconds || 1));
  res.set?.("Retry-After", String(retryAfter));
  return res.status(429).json({
    error: {
      code: "rate_limited",
      message: "Too many requests. Please retry later.",
      retry_after_seconds: retryAfter,
    },
  });
}

export function createRateLimiter({
  action,
  max,
  windowSeconds,
  store = sharedStore,
  now = () => Date.now(),
} = {}) {
  const bucket = cleanStr(action, 120) || "default";
  const config = resolveRateLimitConfig();
  const resolvedMax = max ?? config.limits[bucket] ?? DEFAULT_LIMITS.mutation;
  const resolvedWindowSeconds = windowSeconds ?? config.windowSeconds;

  return function rateLimitMiddleware(req, res, next) {
    const key = buildRateLimitKey({ action: bucket, req });
    const outcome = checkRateLimit({
      key,
      max: resolvedMax,
      windowSeconds: resolvedWindowSeconds,
      nowMs: now(),
      store,
    });

    res.set?.("X-RateLimit-Limit", String(resolvedMax));
    res.set?.("X-RateLimit-Remaining", String(Math.max(0, outcome.remaining)));
    res.set?.("X-RateLimit-Reset", String(Math.ceil(outcome.resetAt / 1000)));

    if (outcome.limited) return sendRateLimited(res, outcome);
    return next();
  };
}

const config = resolveRateLimitConfig();

export const authRateLimit = createRateLimiter({
  action: "auth",
  max: config.limits.auth,
  windowSeconds: config.windowSeconds,
});

export const oauthRateLimit = createRateLimiter({
  action: "oauth",
  max: config.limits.oauth,
  windowSeconds: config.windowSeconds,
});

export const uploadRateLimit = createRateLimiter({
  action: "upload",
  max: config.limits.upload,
  windowSeconds: config.windowSeconds,
});

export const syncRateLimit = createRateLimiter({
  action: "sync",
  max: config.limits.sync,
  windowSeconds: config.windowSeconds,
});

export const generationRateLimit = createRateLimiter({
  action: "generation",
  max: config.limits.generation,
  windowSeconds: config.windowSeconds,
});

export const mutationRateLimit = createRateLimiter({
  action: "mutation",
  max: config.limits.mutation,
  windowSeconds: config.windowSeconds,
});

