// apps/api/src/workers/postGenerate.worker.js
import "../startup/env.js";

import { Worker } from "bullmq";
import { DateTime } from "luxon";
import { col } from "../lib/mongo.js";
import { makeQueue } from "../lib/queues.js";
import { generateGbpPost } from "../services/postAi.js";

const q = makeQueue("post-generate");

console.log("post-generate worker booted");
console.log(
  "[post-generate] OPENAI_API_KEY set =",
  !!process.env.OPENAI_API_KEY,
  "cwd =",
  process.cwd()
);

const concurrency = Number(process.env.POST_GEN_CONCURRENCY || 2);
const attempts = Number(process.env.POST_GEN_ATTEMPTS || 3);
const requeueMs = Number(process.env.POST_GEN_REQUEUE_MS || 30000);

const staleWorkingMs = Number(process.env.POST_GEN_STALE_WORKING_MS || 10 * 60 * 1000);

async function resetStaleWorking({ limit = 500 } = {}) {
  const posts = await col("posts");
  const cutoff = new Date(Date.now() - staleWorkingMs);

  const r = await posts.updateMany(
    { ai_status: "working", updated_at: { $lte: cutoff } },
    { $set: { ai_status: "pending", ai_error: "reset_stale_working", updated_at: new Date() } }
  );

  if (r.modifiedCount) {
    console.log(`[post-generate] reset ${r.modifiedCount} stale working -> pending`);
  }
}

async function enqueue(postId) {
  if (!postId) return;

  const jobId = `gen_${postId}`;

  try {
    const existing = await q.getJob(jobId);
    if (existing) {
      const state = await existing.getState().catch(() => null);
      if (state === "completed" || state === "failed") {
        await existing.remove().catch(() => {});
      } else {
        return; // waiting/active/delayed
      }
    }

    await q.add(
      "generate",
      { postId },
      {
        jobId,
        removeOnComplete: 1000,
        removeOnFail: 1000,
        attempts,
        backoff: { type: "exponential", delay: 5000 },
      }
    );
  } catch (e) {
    console.error("[post-generate] enqueue failed", { postId, err: e?.message || e });
  }
}

// Safety net: if Mongo has pending posts, ensure they have queue jobs
async function requeuePendingFromDb({ limit = 500 } = {}) {
  const posts = await col("posts");

  const windowHours = Number(process.env.POST_GEN_WINDOW_HOURS || 24);
  const until = new Date(Date.now() + windowHours * 60 * 60 * 1000);

  const cur = posts.find(
    { ai_status: "pending", planned_for: { $lte: until } },
    { projection: { id: 1, _id: 0 } }
  ).limit(limit);

  let n = 0;
  while (await cur.hasNext()) {
    const doc = await cur.next();
    const id = String(doc?.id || "").trim();
    if (!id) continue;
    await enqueue(id);
    n++;
  }

  if (n) console.log(`[post-generate] ensured jobs for ${n} pending posts`);
}

async function handler(job) {
  const postId = String(job.data?.postId || "").trim();
  if (!postId) return;

  const posts = await col("posts");

  // Atomic claim to avoid duplicate processing
  const claimedAt = new Date();
  const claim = await posts.updateOne(
    { id: postId, ai_status: "pending" },
    { $set: { ai_status: "working", ai_error: null, updated_at: claimedAt } }
  );

  if (claim.modifiedCount !== 1) return;

  const post = await posts.findOne({ id: postId }, { projection: { _id: 0 } });
  if (!post) {
    await posts.updateOne(
      { id: postId },
      { $set: { ai_status: "pending", updated_at: new Date() } }
    );
    return;
  }

  const orgs = await col("orgs");
  const org = await orgs.findOne(
    { user_id: post.user_id, id: post.ai_org_id },
    { projection: { _id: 0 } }
  );

  if (!org) {
    await posts.updateOne(
      { id: postId },
      { $set: { ai_status: "error", ai_error: "org_not_found", updated_at: new Date() } }
    );
    return;
  }

  const locationTitle = post.provider_location_name || post.location_id;
  const tz = org.timezone || "Asia/Kolkata";
  const whenLocal = post.planned_for
    ? DateTime.fromJSDate(new Date(post.planned_for)).setZone(tz).toFormat("dd LLL yyyy, HH:mm")
    : DateTime.now().setZone(tz).toFormat("dd LLL yyyy, HH:mm");

  const seedPrompt = String(post.summary || "").includes("Generating content")
    ? ""
    : String(post.summary || "");

  try {
    const out = await generateGbpPost({
      org,
      locationTitle,
      whenLocalStr: whenLocal,
      seedPrompt,
    });

    const now = new Date();

    const patch = {
      summary: out.summary,
      ai_status: "done",
      ai_error: null,
      ai_model: out.modelUsed,
      ai_generated_at: now,
      updated_at: now,
    };

    if (post.recurrence_mode === "auto" && post.auto_publish_at) {
      patch.status = "scheduled";
      patch.scheduled_at = new Date(post.auto_publish_at);
    } else {
      patch.status = "draft";
      patch.scheduled_at = null;
    }

    await posts.updateOne({ id: postId }, { $set: patch });
  } catch (e) {
    const msg = String(e?.message || e || "").trim();

    // Distinguish "quota exceeded" (billing) vs rate-limit (pace/auto-retry)
    const isQuotaExceeded =
      msg.includes("You exceeded your current quota") ||
      msg.includes("insufficient_quota") ||
      msg.includes("check your plan and billing details");

    const now = new Date();

    await posts.updateOne(
      { id: postId },
      {
        $set: {
          ai_status: "error",
          ai_error: isQuotaExceeded
            ? "openai_quota_exceeded (add credits / increase limits)"
            : (msg || "ai_failed"),
          updated_at: now,
        },
      }
    );

    // 🔴 If it's quota/billing, DO NOT throw — retries are pointless until billing is fixed.
    if (isQuotaExceeded) return;

    // 🟠 For transient errors, keep BullMQ retry behavior
    throw e;
  }
}

new Worker("post-generate", handler, {
  connection: q.opts.connection,
  concurrency,
});

// Run safety net on boot + interval
resetStaleWorking().then(() => requeuePendingFromDb()).catch((e) =>
  console.error("[post-generate] boot heal failed:", e)
);

setInterval(() => {
  resetStaleWorking().then(() => requeuePendingFromDb()).catch((e) =>
    console.error("[post-generate] interval heal failed:", e)
  );
}, requeueMs);

