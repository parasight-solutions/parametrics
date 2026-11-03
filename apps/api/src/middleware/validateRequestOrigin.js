import { isAllowedCorsOrigin } from "../lib/corsConfig.js";

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

    return res.status(403).json({
      error: {
        code: "origin_forbidden",
        message: "Request origin is not allowed",
      },
    });
  };
}

export const validateRequestOrigin = createValidateRequestOrigin();
