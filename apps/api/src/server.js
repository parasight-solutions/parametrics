// apps/api/src/server.js
// import "dotenv/config"
import "./startup/env.js"
import { ensureIndexes } from "./startup/ensureIndexes.js"
import { validateReportStorageConfig } from "./services/reportStorage.js";
import { validatePostImageStorageConfig } from "./services/postImageStorage.js";
import { createApp } from "./app.js";

const app = createApp();

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
  const uploadStorageCfg = await validatePostImageStorageConfig()
  console.log(`[post_upload_storage] root=${uploadStorageCfg.safeRootLabel}`)
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
