import "../startup/env.js";
import { closeDb, col } from "../lib/mongo.js";
import { getGoogleIntegrationById, ensureAccessToken } from "../integrations/google.store.js";
import { listAccounts, listLocations, listLocalPosts } from "../integrations/google.js";
import { recoverGooglePosts } from "../services/postSync.js";
import { parsePostRecoveryArgs, runPostRecoveryCli } from "../services/postRecoveryCli.js";

async function main() {
  const options = parsePostRecoveryArgs(process.argv.slice(2));
  const result = await runPostRecoveryCli(options, {
    locations: await col("locations"),
    organizationMembers: await col("organization_members"),
    getIntegrationById: getGoogleIntegrationById,
    recoverGooglePosts,
    recoveryDependencies: {
      posts: await col("posts"), ensureAccessToken, listAccounts, listLocations, listLocalPosts,
    },
  });
  console.log(JSON.stringify({ task: "google_post_recovery", ...result }, null, 2));
  if (!options.apply) console.log("No writes were performed. Re-run with --apply only after reviewing this summary.");
}

main().catch((error) => {
  console.error(JSON.stringify({ task: "google_post_recovery", ok: false, code: error?.code || "recovery_failed", message: "Google post recovery failed. Review the error code." }));
  process.exitCode = 1;
}).finally(closeDb);
