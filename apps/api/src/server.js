// apps/api/src/server.js
// import "dotenv/config"
import "./startup/env.js"
import express from "express"
import helmet from "helmet"
import cors from "cors"
import { createCorsOptions } from "./lib/corsConfig.js"
import { createErrorHandler } from "./lib/errorHandler.js"
import { resolveTrustProxy, describeTrustProxy } from "./lib/trustProxy.js"
import { isDebugRoutesEnabled } from "./lib/debugRoutes.js"
import { ensureIndexes } from "./startup/ensureIndexes.js"
import auth from "./routes/auth.js"
import googleIntegration from "./routes/integrations.google.js"
import googleExtras from "./routes/integrations.google.extras.js"
import { createUploadsRouter } from "./routes/uploads.js"
import { validateUploadConfig, createUploadStaticHandler } from "./services/uploadStorage.js"
import debugRoutes from "./routes/debug.js"
import debugGoogle from "./routes/debug.google.js"
// Robust route imports: support either `export default` OR `export const locations/posts/reviews = Router()`
import * as locationsMod from "./routes/locations.js"
import * as postsMod from "./routes/posts.js"
import * as reviewsMod from "./routes/reviews.js"
import orgsRouter from "./routes/orgs.js";
import locationOrgRouter from "./routes/locationOrg.js";
import recurrenceRouter from "./routes/recurrence.js";
import googleAuthRouter from "./routes/auth.google.js";
import reportsRouter from "./routes/reports.js";
import { validateReportStorageConfig } from "./services/reportStorage.js";


const locationsRoutes = locationsMod.default || locationsMod.locations
const postsRoutes = postsMod.default || postsMod.posts
const reviewsRoutes = reviewsMod.default || reviewsMod.reviews

if (!locationsRoutes) throw new Error("routes/locations.js must export default or named `locations`")
if (!postsRoutes) throw new Error("routes/posts.js must export default or named `posts`")
if (!reviewsRoutes) throw new Error("routes/reviews.js must export default or named `reviews`")

// Fail fast on unsafe upload storage (UPLOAD_DIR is required in production).
let uploadCfg
try {
  uploadCfg = validateUploadConfig()
  console.log(
    `[uploads] dir=${uploadCfg.safeDirLabel}`,
    `configured=${uploadCfg.configured}`,
    `production=${uploadCfg.production}`,
    `legacy_dirs=${uploadCfg.legacyDirs.length}`,
  )
} catch (error) {
  console.error(`[uploads] startup validation failed: ${error?.code || "upload_config_error"}: ${error?.message || ""}`)
  process.exit(1)
}

const app = express()

// Fail fast on an unsafe TRUST_PROXY (e.g. `true`); default is off.
let trustProxy
try {
  trustProxy = resolveTrustProxy()
} catch (error) {
  console.error(`[trust_proxy] startup validation failed: ${error?.code || "trust_proxy_config_invalid"}: ${error?.message || ""}`)
  process.exit(1)
}
app.set("trust proxy", trustProxy)
console.log(`[trust_proxy] ${describeTrustProxy(trustProxy)}`)

app.use(helmet())
app.use(cors(createCorsOptions()))
app.use(express.json())

// Public post media: UPLOAD_DIR first, then read-only legacy in-checkout dirs.
// Raster images only, nosniff + sandbox CSP.
app.use("/uploads", createUploadStaticHandler({ getDirs: () => [uploadCfg.dir, ...uploadCfg.legacyDirs] }))

app.get("/api/v1/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
)

app.use("/api/v1/auth", auth)
app.use("/api/v1/auth/google", googleAuthRouter)

// Google routes (same base path; both routers mounted)
app.use("/api/v1/integrations/google", googleIntegration)
app.use("/api/v1/integrations/google", googleExtras)

// Core app resources
app.use("/api/v1/locations", locationsRoutes)
app.use("/api/v1/posts", postsRoutes)
app.use("/api/v1/reviews", reviewsRoutes)
app.use("/api/v1/uploads", createUploadsRouter({ uploadDir: uploadCfg.dir }))
app.use("/api/v1/reports", reportsRouter)

// Debug: local-only and opt-in (NODE_ENV development/test + ENABLE_DEBUG_ROUTES=true)
const debugRoutesEnabled = isDebugRoutesEnabled()
if (debugRoutesEnabled) {
  app.use("/api/v1/debug", debugRoutes)
  app.use("/api/v1/debug", debugGoogle)
}
console.log(`[debug_routes] mounted=${debugRoutesEnabled}`)

app.use("/api/v1/recurrence", recurrenceRouter);
app.use("/api/v1/orgs", orgsRouter);
app.use("/api/v1/location-org", locationOrgRouter);

// Must stay last: JSON errors only, no stack traces to clients.
app.use(createErrorHandler())

console.log(
  "[env] APP_ENC_KEY set =",
  !!(process.env.APP_ENC_KEY || process.env.ENCRYPTION_KEY),
  " JWT_SECRET set =",
  !!process.env.JWT_SECRET,
  " MONGODB_URI set =",
  !!process.env.MONGODB_URI
)


const port = Number(process.env.PORT || 5050)

try {
  const reportStorageCfg = validateReportStorageConfig()
  console.log(
    `[report_storage] provider=${reportStorageCfg.provider}`,
    `configured=${reportStorageCfg.configured}`,
    `production=${reportStorageCfg.production}`,
    `root=${reportStorageCfg.safeRootLabel}`,
  )
} catch (error) {
  const code = error?.code || "report_storage_config_error"
  console.error(`[report_storage] startup validation failed: ${code}: ${error?.message || ""}`)
  process.exit(1)
}

ensureIndexes().then(() => {
  app.listen(port, () => console.log(`API listening on http://localhost:${port}`))
})
