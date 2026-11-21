// apps/api/src/jobs/scheduler.js
import "../startup/env.js";
import cron from "node-cron";
import { randomUUID } from "node:crypto";
import { resolvePostAutoSyncConfig } from "../config/postAutoSyncConfig.js";
import { col } from "../lib/mongo.js";
import { makeQueue } from "../lib/queues.js";
import {
  claimDuePostSyncLocations,
  enqueueClaimedPostSync,
} from "../services/postAutoSyncScheduler.js";

const q = makeQueue("post-publish");
const postSyncQueue = makeQueue("post-sync");
const postAutoSyncConfig = resolvePostAutoSyncConfig();
const JOB_ID = (postId) => `publish_${postId}`;

console.log("Scheduler booted (DB poller)");
let shuttingDown = false;

// Every minute: scheduled -> queued (ONLY if AI is done)
const publishSchedule = cron.schedule("* * * * *", async () => {
  if (shuttingDown) return;
  const posts = await col("posts");
  const now = new Date();

  const due = await posts
    .find({
      status: "scheduled",
      scheduled_at: { $lte: now },
      $or: [
        { ai_status: "done" },
        { ai_status: { $exists: false } },
        { ai_status: null },
      ],
    })
    .sort({ scheduled_at: 1 })
    .limit(50)
    .toArray();

  for (const p of due) {
    const updated = await posts.updateOne(
      { id: p.id, status: "scheduled", scheduled_at: { $lte: now }, ai_status: "done" },
      { $set: { status: "queued", updated_at: new Date() } }
    );
    if (!updated.modifiedCount) continue;

    const jobId = JOB_ID(p.id);

    try {
      const existing = await q.getJob(jobId);
      if (existing) await existing.remove();

      await q.add(
        "scheduled-publish",
        { postId: p.id, userId: p.user_id },
        {
          jobId,
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        }
      );
    } catch (e) {
      console.error("[scheduler] enqueue failed", { postId: p.id, err: e?.message || e });
    }
  }
});

const postSyncSchedule = cron.schedule("* * * * *", async () => {
  if (shuttingDown || !postAutoSyncConfig.enabled) return;
  const locations = await col("locations");
  const now = new Date();
  try {
    const claimed = await claimDuePostSyncLocations(
      { now, limit: 50, claimMs: 2 * 60_000 },
      { locations, claimIdFactory: randomUUID },
    );
    for (const record of claimed) {
      try {
        await enqueueClaimedPostSync(record, {
          queue: postSyncQueue,
          locations,
          maxAttempts: postAutoSyncConfig.maxAttempts,
        });
      } catch (error) {
        console.error("[scheduler] post auto-sync enqueue failed", {
          locationId: record.locationId,
          code: error?.code || error?.message || "enqueue_failed",
        });
      }
    }
  } catch (error) {
    console.error("[scheduler] post auto-sync scan failed", {
      code: error?.code || error?.message || "scan_failed",
    });
  }
});

async function shutdownScheduler() {
  if (shuttingDown) return;
  shuttingDown = true;
  publishSchedule.stop();
  postSyncSchedule.stop();
  await Promise.allSettled([q.close(), postSyncQueue.close()]);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdownScheduler()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
