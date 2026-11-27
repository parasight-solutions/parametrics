import "../startup/env.js";
import { closeDb, col } from "../lib/mongo.js";
import { cleanupDuplicateGoogleReviews } from "../services/reviewDuplicateCleanup.js";

function readOption(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || null;
}

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const backupConfirmed = args.has("--backup-confirmed");
const userId = readOption("user-id");
const locationId = readOption("location-id");

async function main() {
  if (!userId && !locationId) throw new Error("review_cleanup_scope_required");
  const result = await cleanupDuplicateGoogleReviews({
    reviews: await col("reviews"),
    locations: await col("locations"),
    archive: await col("review_duplicate_archive"),
    references: [{
      collection: await col("audit_logs"),
      baseFilter: { target_type: "review" },
      fields: ["target_id"],
    }],
    apply,
    backupConfirmed,
    userId,
    locationId,
  });
  console.log(JSON.stringify({ task: "duplicate_google_review_cleanup", ...result }, null, 2));
  if (!apply) {
    console.log("No writes were performed. Back up the scoped records, then re-run with --apply --backup-confirmed.");
  }
}

main()
  .catch((error) => {
    console.error("[duplicate Google review cleanup] failed", error?.message || error);
    process.exitCode = 1;
  })
  .finally(closeDb);
