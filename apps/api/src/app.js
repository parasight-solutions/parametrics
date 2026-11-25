import cors from "cors";
import express from "express";
import helmet from "helmet";

import { createCorsOptions } from "./lib/corsConfig.js";
import { validateRequestOrigin } from "./middleware/validateRequestOrigin.js";
import auth from "./routes/auth.js";
import googleAuthRouter from "./routes/auth.google.js";
import debugRoutes from "./routes/debug.js";
import debugGoogle from "./routes/debug.google.js";
import googleExtras from "./routes/integrations.google.extras.js";
import googleIntegration from "./routes/integrations.google.js";
import locationsRoutes from "./routes/locations.js";
import locationOrgRouter from "./routes/locationOrg.js";
import orgsRouter from "./routes/orgs.js";
import postsRoutes from "./routes/posts.js";
import recurrenceRouter from "./routes/recurrence.js";
import reportsRouter from "./routes/reports.js";
import reviewsRoutes from "./routes/reviews.js";
import uploads from "./routes/uploads.js";
import { resolvePostUploadConfig } from "./services/postImageStorage.js";
import { sendError, sendSuccess } from "./utils/apiResponse.js";

function wrapAsyncLayers(stack, visited = new Set()) {
  for (const layer of stack || []) {
    if (visited.has(layer)) continue;
    visited.add(layer);

    if (layer.route?.stack) {
      wrapAsyncLayers(layer.route.stack, visited);
      continue;
    }
    if (layer.handle?.stack) {
      wrapAsyncLayers(layer.handle.stack, visited);
      continue;
    }
    const original = layer.handle;
    if (typeof original !== "function" || original.length === 4) continue;
    layer.handle = function asyncSafeLayer(req, res, next) {
      try {
        const result = original.call(this, req, res, next);
        if (result && typeof result.then === "function") result.catch(next);
        return result;
      } catch (error) {
        return next(error);
      }
    };
  }
}

export function createApp({ configureApiRoutes, logger = console } = {}) {
  const app = express();

  app.use(cors(createCorsOptions()));
  app.use(helmet());
  app.use(express.json());
  app.use("/api", validateRequestOrigin);

  app.use("/uploads", express.static(resolvePostUploadConfig().root));

  app.get("/api/v1/health", (_req, res) =>
    sendSuccess(res, {
      data: { ok: true, ts: new Date().toISOString() },
      message: "API is healthy",
    }),
  );

  app.use("/api/v1/auth", auth);
  app.use("/api/v1/auth/google", googleAuthRouter);
  app.use("/api/v1/integrations/google", googleIntegration);
  app.use("/api/v1/integrations/google", googleExtras);
  app.use("/api/v1/locations", locationsRoutes);
  app.use("/api/v1/posts", postsRoutes);
  app.use("/api/v1/reviews", reviewsRoutes);
  app.use("/api/v1/uploads", uploads);
  app.use("/api/v1/reports", reportsRouter);
  app.use("/api/v1", debugRoutes);
  app.use("/api/v1/debug", debugGoogle);
  app.use("/api/v1/recurrence", recurrenceRouter);
  app.use("/api/v1/orgs", orgsRouter);
  app.use("/api/v1/location-org", locationOrgRouter);

  configureApiRoutes?.(app);
  wrapAsyncLayers(app._router?.stack);

  app.use("/api/v1", (_req, res) =>
    sendError(res, {
      statusCode: 404,
      message: "API route not found",
      errors: [{ code: "not_found", message: "API route not found" }],
    }),
  );

  app.use((error, req, res, next) => {
    if (!req.originalUrl?.startsWith("/api/v1")) return next(error);
    logger.error?.("[api] unhandled request error", error);
    const parserStatus = [400, 413].includes(error?.status) ? error.status : 500;
    const parserCode =
      parserStatus === 400
        ? "invalid_json"
        : parserStatus === 413
          ? "payload_too_large"
          : "server_error";
    const message =
      parserStatus === 400
        ? "Request body contains invalid JSON"
        : parserStatus === 413
          ? "Request body is too large"
          : "An unexpected error occurred";
    return sendError(res, {
      statusCode: parserStatus,
      message,
      errors: [{ code: parserCode, message }],
    });
  });

  return app;
}

export default createApp;
