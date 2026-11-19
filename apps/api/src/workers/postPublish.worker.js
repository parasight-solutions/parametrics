// apps/api/src/workers/postPublish.worker.js
import "../startup/env.js";
import { Worker, Queue, UnrecoverableError } from "bullmq";
import { randomUUID } from "crypto";
import { connection } from "../lib/queues.js";
import pino from "pino";
import { col } from "../lib/mongo.js";
import { publishPostNow } from "../routes/posts.js";
import { buildPostPublishFailureDecision } from "../services/postPublishFailure.js";
import { markPostPublishFailure } from "../services/postPublishLifecycle.js";

const log = pino({ name: "postPublish" });
const postPublishQueue = new Queue("post-publish", { connection });

function pickGoogleError(e) {
  const status = e?.status || null;
  const body = e?.body || null;
  const msg =
    body?.error?.message ||
    body?.error?.status ||
    e?.message ||
    "publish_failed";
  return {
    message: String(msg),
    detail: { status, body },
  };
}

async function markFailure(postId, userId, attemptId, e, final, meta = {}) {
  try {
    const posts = await col("posts");
    const picked = pickGoogleError(e);

    return markPostPublishFailure(posts, {
      scope: e?.postScope || {
        id: postId,
        ...(userId ? { user_id: userId } : {}),
      },
      attemptId,
      status: final ? "failed" : "retrying",
      providerError: picked.message,
      detail: picked.detail,
      metadata: meta,
    });
  } catch (err) {
    log.error(
      { postId, userId, err: err?.message || err },
      "Failed to update post error",
    );
    return false;
  }
}

export const postPublishWorker = new Worker(
  "post-publish",
  async (job) => {
    const { postId, userId } = job.data || {};
    if (!postId) throw new Error("missing_postId");

    const max = Number(job.opts?.attempts || 1);
    const attempt = Number(job.attemptsMade || 0) + 1;
    const attemptId = `${job.id || postId}:${attempt}:${randomUUID()}`;

    log.info(
      { postId, userId, jobId: job.id, attempt, max },
      "Publishing post",
    );

    try {
      const res = await publishPostNow(postId, { userId, attemptId });
      log.info({ postId, userId, name: res?.name }, "Published");
      return { name: res?.name || null };
    } catch (e) {
      if (e?.code === "post_publish_not_claimed") {
        log.info(
          { postId, userId, jobId: job.id },
          "Publish skipped because post is not claimable",
        );
        return { skipped: true };
      }

      const classification = buildPostPublishFailureDecision({
        error: e,
        attempt,
        maxAttempts: max,
      });
      const final = classification.final;
      const picked = pickGoogleError(e);

      await markFailure(postId, userId, attemptId, e, final, {
        jobId: job.id,
        attempt,
      });

      log.error(
        {
          postId,
          userId,
          attempt,
          max,
          permanent: classification.permanent,
          failureReason: classification.reason,
          err: picked.message,
          status: picked.detail.status,
          body: picked.detail.body,
        },
        "Publish failed",
      );
      if (classification.permanent) {
        throw new UnrecoverableError(picked.message);
      }
      throw e;
    }
  },
  { connection, concurrency: 3 },
);
