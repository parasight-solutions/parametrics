import "../startup/env.js";
import { closeDb, col } from "../lib/mongo.js";
import {
  getGoogleIntegrationById,
  ensureAccessToken,
} from "../integrations/google.store.js";
import { getLocalPost, listLocalPosts } from "../integrations/google.js";
import { backfillGooglePostUrls } from "../services/googlePostUrlBackfill.js";

const apply = new Set(process.argv.slice(2)).has("--apply");

async function main() {
  const summary = await backfillGooglePostUrls({
    posts: await col("posts"),
    locations: await col("locations"),
    getIntegrationById: getGoogleIntegrationById,
    ensureAccessToken,
    listLocalPosts,
    getLocalPost,
    apply,
  });

  console.log(JSON.stringify({ task: "google_post_url_backfill", ...summary }, null, 2));
  if (!apply) console.log("No writes were performed. Re-run with --apply after reviewing the summary.");
}

main()
  .catch((error) => {
    console.error("[google post URL backfill] failed", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
