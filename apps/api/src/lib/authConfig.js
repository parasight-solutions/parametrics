const LOCAL_JWT_SECRET =
  "parametrics-local-development-only-jwt-secret-do-not-use-in-production";

const MIN_JWT_SECRET_LENGTH = 32;

const WEAK_JWT_SECRETS = new Set([
  "dev",
  "dev_change_me",
  "changeme",
  "change_me",
  "secret",
  "jwt_secret",
  "replace_with_long_random_string",
]);

export function runtimeEnv() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase();
}

export function isLocalAuthEnvironment() {
  const env = runtimeEnv();
  return env === "development" || env === "test";
}

export function isWeakJwtSecret(secret) {
  const value = String(secret || "").trim();
  return (
    value.length < MIN_JWT_SECRET_LENGTH ||
    WEAK_JWT_SECRETS.has(value.toLowerCase())
  );
}

export function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();

  if (!secret) {
    if (isLocalAuthEnvironment()) return LOCAL_JWT_SECRET;
    throw new Error(
      "JWT_SECRET is required when NODE_ENV is not development or test"
    );
  }

  if (!isLocalAuthEnvironment() && isWeakJwtSecret(secret)) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters and must not be a placeholder outside local development`
    );
  }

  return secret;
}

export function assertSafeJwtConfig() {
  getJwtSecret();
}

export function assertLocalDevOnly(actionName) {
  if (isLocalAuthEnvironment()) return;

  throw new Error(
    `${actionName} may only run with NODE_ENV=development or NODE_ENV=test`
  );
}
