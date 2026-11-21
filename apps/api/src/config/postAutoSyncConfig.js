const DEFAULTS = Object.freeze({
  enabled: false,
  intervalMinutes: 120,
  concurrency: 1,
  maxAttempts: 3,
  leaseMs: 120_000,
  heartbeatMs: 40_000,
});

function configError(name, message) {
  const error = new Error(`${name} ${message}`);
  error.code = "invalid_post_auto_sync_config";
  return error;
}

function parseBoolean(env, name, fallback) {
  const raw = env?.[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw configError(name, "must be true or false");
}

function parseInteger(env, name, fallback, min, max) {
  const raw = env?.[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw configError(name, `must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function resolvePostAutoSyncConfig(env = process.env) {
  return {
    enabled: parseBoolean(env, "POST_AUTO_SYNC_ENABLED", DEFAULTS.enabled),
    intervalMinutes: parseInteger(env, "POST_AUTO_SYNC_INTERVAL_MINUTES", DEFAULTS.intervalMinutes, 15, 1440),
    concurrency: parseInteger(env, "POST_AUTO_SYNC_CONCURRENCY", DEFAULTS.concurrency, 1, 20),
    maxAttempts: parseInteger(env, "POST_AUTO_SYNC_MAX_ATTEMPTS", DEFAULTS.maxAttempts, 1, 10),
    leaseMs: DEFAULTS.leaseMs,
    heartbeatMs: DEFAULTS.heartbeatMs,
  };
}
