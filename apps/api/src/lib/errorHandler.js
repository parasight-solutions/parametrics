import { CORS_ORIGIN_NOT_ALLOWED } from "./corsConfig.js";

// Final Express error handler. Replaces the default finalhandler so that no
// stack trace or raw error text reaches a client under any NODE_ENV, and CORS
// rejections are a bounded 403 instead of a logged 500.

const CLIENT_ERROR_CODES = {
  400: "bad_request",
  413: "payload_too_large",
  415: "unsupported_media_type",
};

const MAX_LOG_TEXT = 200;
const MAX_STACK = 4000;

export function safeLogText(value, max = MAX_LOG_TEXT) {
  const v = String(value ?? "").replace(/[^\x20-\x7e]/g, "?");
  return v.length > max ? `${v.slice(0, max)}...` : v;
}

// Path only: query strings can carry credentials and must not be logged.
function requestPath(req) {
  return safeLogText(`${req?.baseUrl || ""}${req?.path || ""}`);
}

export function createErrorHandler({
  logger = console,
  now = () => Date.now(),
  corsLogIntervalMs = 60_000,
} = {}) {
  let lastCorsLogAt = -Infinity;
  let suppressedCorsLogs = 0;

  function logCorsRejection(req) {
    const t = now();
    if (t - lastCorsLogAt < corsLogIntervalMs) {
      suppressedCorsLogs += 1;
      return;
    }
    logger.warn(
      `[cors] rejected origin=${safeLogText(req?.headers?.origin)} method=${safeLogText(req?.method, 16)}` +
        ` suppressed_since_last=${suppressedCorsLogs}`
    );
    lastCorsLogAt = t;
    suppressedCorsLogs = 0;
  }

  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    if (err?.code === CORS_ORIGIN_NOT_ALLOWED) {
      logCorsRejection(req);
      return res.status(403).json({
        error: { code: CORS_ORIGIN_NOT_ALLOWED, message: "Origin not allowed" },
      });
    }

    const status = Number(err?.status || err?.statusCode);
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return res.status(status).json({
        error: { code: CLIENT_ERROR_CODES[status] || "request_error", message: "Request could not be processed" },
      });
    }

    const stack = String(err?.stack || err?.message || err || "unknown error");
    logger.error(`[error] ${safeLogText(req?.method, 16)} ${requestPath(req)} ${stack.slice(0, MAX_STACK)}`);
    return res.status(500).json({
      error: { code: "internal_error", message: "Internal server error" },
    });
  };
}
