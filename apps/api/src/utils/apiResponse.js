const DEFAULT_SUCCESS_MESSAGE = "Operation completed successfully";
const DEFAULT_ERROR_MESSAGE = "An unexpected error occurred";
const GOOGLE_REAUTH_REASONS = new Set([
  "missing_refresh_token",
  "invalid_grant",
  "access_revoked",
  "permission_denied",
]);
const PUBLIC_ERROR_CODES = new Set(["VALIDATION_ERROR"]);

function cleanString(value, fallback, maxLength = 500) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLength);
}

function normalizeStatus(value, fallback) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : fallback;
}

function isApiEnvelope(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.success === "boolean" &&
      Number.isInteger(value.statusCode) &&
      typeof value.message === "string" &&
      (Object.hasOwn(value, "data") || Object.hasOwn(value, "errors")),
  );
}

function normalizeDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;

  if (details.provider === "google" && GOOGLE_REAUTH_REASONS.has(details.reason)) {
    return { provider: "google", reason: details.reason };
  }

  if (Number.isInteger(details.retryAfterSeconds) && details.retryAfterSeconds > 0) {
    return { retryAfterSeconds: details.retryAfterSeconds };
  }

  return undefined;
}

function normalizeErrorEntry(entry, fallbackMessage) {
  const source = entry && typeof entry === "object" ? entry : {};
  const code = cleanString(source.code, "server_error", 120);
  const message = cleanString(source.message, fallbackMessage);
  const normalized = { code, message };
  const field = cleanString(source.field, "", 200);
  const details = normalizeDetails(source.details);

  if (field) normalized.field = field;
  if (details) normalized.details = details;
  return normalized;
}

const SENSITIVE_DATA_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "token",
  "body",
  "raw",
  "stack",
  "request",
  "response",
]);

function sanitizePublicData(value, errorContext = false, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePublicData(item, errorContext, seen));
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return null;
  seen.add(value);

  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_DATA_KEYS.has(key.toLowerCase())) continue;
    const nestedErrorContext =
      errorContext ||
      key === "errors" ||
      key === "error" ||
      key === "last_error" ||
      key === "provider_error_detail";
    if (key === "message" && nestedErrorContext) {
      out.message = "Provider operation failed";
      continue;
    }
    out[key] = sanitizePublicData(nested, nestedErrorContext, seen);
  }
  if (errorContext && !Object.hasOwn(out, "message")) {
    out.message = "Provider operation failed";
  }
  seen.delete(value);
  return out;
}

export function buildSuccess({
  statusCode = 200,
  data = null,
  message = DEFAULT_SUCCESS_MESSAGE,
} = {}) {
  if (isApiEnvelope(data)) throw new TypeError("Nested API response envelope is not allowed");

  return {
    statusCode: normalizeStatus(statusCode, 200),
    data: sanitizePublicData(data),
    message: cleanString(message, DEFAULT_SUCCESS_MESSAGE),
    success: true,
  };
}

export function buildError({
  statusCode = 500,
  message = DEFAULT_ERROR_MESSAGE,
  errors,
} = {}) {
  const safeStatus = normalizeStatus(statusCode, 500);
  const safeMessage = cleanString(message, DEFAULT_ERROR_MESSAGE);
  const entries = Array.isArray(errors) ? errors : errors ? [errors] : [];
  const normalizedErrors = entries.map((entry) => normalizeErrorEntry(entry, safeMessage));

  if (normalizedErrors.length === 0) {
    normalizedErrors.push({ code: "server_error", message: safeMessage });
  }

  return {
    statusCode: safeStatus,
    message: safeMessage,
    success: false,
    errors: normalizedErrors,
  };
}

export function normalizeApiError(error, defaults = {}) {
  const source = error && typeof error === "object" ? error : {};
  const fallbackStatus = normalizeStatus(defaults.statusCode ?? defaults.status, 500);
  const statusCode = normalizeStatus(
    source.statusCode ?? source.status ?? source.http_status,
    fallbackStatus,
  );
  const code = cleanString(source.code, cleanString(defaults.code, "server_error", 120), 120);
  const isPublicClientError = statusCode >= 400 && statusCode < 500;
  const hasProviderDiagnostics =
    Object.hasOwn(source, "body") ||
    Object.hasOwn(source, "response") ||
    (/[A-Z]/.test(code) && !PUBLIC_ERROR_CODES.has(code));
  const isRecognizedApplicationError =
    !hasProviderDiagnostics &&
    code !== "server_error" &&
    (/^[a-z][a-z0-9_]*$/.test(code) || PUBLIC_ERROR_CODES.has(code));
  const publicCode = hasProviderDiagnostics
    ? cleanString(defaults.code, "server_error", 120)
    : code;
  const defaultMessage = cleanString(defaults.message, DEFAULT_ERROR_MESSAGE);
  const message = isRecognizedApplicationError || defaults.exposeMessage === true
    ? cleanString(source.message, defaultMessage)
    : defaultMessage;
  const entry = { code: publicCode, message };
  const field = cleanString(source.field, "", 200);
  const details = normalizeDetails(source.details);

  if (field) entry.field = field;
  if (details) entry.details = details;

  return { statusCode, message, errors: [entry] };
}

export function sendSuccess(res, options = {}) {
  const body = buildSuccess(options);
  return res.status(body.statusCode).json(body);
}

export function sendError(res, options = {}) {
  const body = buildError(options);
  return res.status(body.statusCode).json(body);
}
