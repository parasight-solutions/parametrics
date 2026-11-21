import "../startup/env.js";
import { Worker, UnrecoverableError } from "bullmq";
import pino from "pino";
import { resolvePostAutoSyncConfig } from "../config/postAutoSyncConfig.js";
import { ensureAccessToken, getGoogleIntegrationById } from "../integrations/google.store.js";
import { listAccounts, listLocations, listLocalPosts } from "../integrations/google.js";
import { col, withMongoTransaction } from "../lib/mongo.js";
import { connection } from "../lib/queues.js";
import { requireOrganizationLocationAccess } from "../services/organizationAccess.js";
import { buildPostSyncWorkerOptions, runAutoPostSyncJob } from "../services/autoPostSync.js";
import { syncGooglePosts } from "../services/postSync.js";

const log = pino({ name: "postSync" });
const config = resolvePostAutoSyncConfig();

export const postSyncWorker = new Worker(
  "post-sync",
  async (job) => {
    try {
      return await runAutoPostSyncJob(job.data || {}, {
        config,
        locations: await col("locations"),
        users: await col("users"),
        requireLocationAccess: requireOrganizationLocationAccess,
        getIntegrationById: getGoogleIntegrationById,
        syncGooglePosts,
        syncDependencies: {
          posts: await col("posts"),
          tombstones: await col("post_deletion_tombstones"),
          ensureAccessToken,
          listAccounts,
          listLocations,
          listLocalPosts,
        },
        withTransaction: withMongoTransaction,
      });
    } catch (error) {
      if (error?.retryable === false) {
        throw new UnrecoverableError(error.code || "post_auto_sync_unrecoverable");
      }
      throw error;
    }
  },
  buildPostSyncWorkerOptions(config, connection),
);

postSyncWorker.on("completed", (job, result) => {
  log.info({ jobId: job.id, locationId: job.data?.locationId, result }, "Post auto-sync completed");
});

postSyncWorker.on("failed", (job, error) => {
  log.error({
    jobId: job?.id,
    locationId: job?.data?.locationId,
    code: error?.code || error?.message || "post_auto_sync_failed",
  }, "Post auto-sync failed");
});

let closing = false;
async function shutdownPostSyncWorker() {
  if (closing) return;
  closing = true;
  const timeout = new Promise((resolve) => setTimeout(resolve, 30_000));
  await Promise.race([postSyncWorker.close(), timeout]);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdownPostSyncWorker()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
