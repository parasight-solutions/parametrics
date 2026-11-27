import "../startup/env.js";
import { Worker } from "bullmq";
import pino from "pino";

import { connection } from "../lib/queues.js";
import { runReviewSyncJob } from "../services/reviewSync.js";

const log = pino({ name: "reviewSync" });

export const processReviewSyncJob = (job) => runReviewSyncJob(job, { logger: log });

export const reviewSyncWorker = new Worker(
  "review-sync",
  processReviewSyncJob,
  { connection, concurrency: 2 },
);

reviewSyncWorker.on("failed", (job, error) => {
  log.error({
    userId: String(job?.data?.userId || ""),
    locationId: String(job?.data?.locationId || ""),
    jobId: job?.id,
    error: error?.message || "review_sync_failed",
  }, "Review sync job exhausted an attempt");
});
