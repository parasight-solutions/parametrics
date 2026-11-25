import { isAllowedCorsOrigin } from "../lib/corsConfig.js";
import { sendError } from "../utils/apiResponse.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createValidateRequestOrigin({
  isAllowedOrigin = (origin) => isAllowedCorsOrigin(origin),
} = {}) {
  return function validateRequestOrigin(req, res, next) {
    if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase())) {
      return next();
    }

    const origin = req.headers?.origin;
    if (!origin || isAllowedOrigin(origin)) return next();

    return sendError(res, {
      statusCode: 403,
      message: "Request origin is not allowed",
      errors: [{ code: "origin_forbidden", message: "Request origin is not allowed" }],
    });
  };
}

export const validateRequestOrigin = createValidateRequestOrigin();
