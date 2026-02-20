// apps/api/src/jobs/scheduler.js
import "../startup/env.js";
import cron from "node-cron";
import { col } from "../lib/mongo.js";
import { makeQueue } from "../lib/queues.js";

const q = makeQueue("post-publish");
const JOB_ID = (postId) => `publish_${postId}`;

console.log("Scheduler booted (DB poller)");

// Every minute: scheduled -> queued (ONLY if AI is done)
cron.schedule("* * * * *", async () => {
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
