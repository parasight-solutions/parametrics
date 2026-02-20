// apps/api/src/workers/postPublish.worker.js
import "../startup/env.js";
import { Worker, Queue } from 'bullmq'
import { connection } from '../lib/queues.js'
import pino from 'pino'
import { col } from '../lib/mongo.js'
import { publishPostNow } from '../routes/posts.js'

const log = pino({ name: 'postPublish' })
const postPublishQueue = new Queue('post-publish', { connection })

function pickGoogleError(e) {
  const status = e?.status || null
  const body = e?.body || null
  const msg =
    body?.error?.message ||
    body?.error?.status ||
    e?.message ||
    'publish_failed'
  return {
    message: String(msg),
    detail: { status, body },
  }
}

function postFilter(postId, userId) {
  // If we have userId, ALWAYS scope updates to that user.
  // If older jobs don't have userId, fall back to postId only.
  return userId ? { id: postId, user_id: userId } : { id: postId }
}

async function markFailure(postId, userId, e, final, meta = {}) {
  try {
    const posts = await col('posts')
    const picked = pickGoogleError(e)

    await posts.updateOne(
      postFilter(postId, userId),
      {
        $set: {
          status: final ? 'failed' : 'retrying',
          provider_error: picked.message,
          provider_error_detail: picked.detail,
          last_attempt_at: new Date(),
          last_job_id: meta.jobId || null,
          attempts_made: meta.attempt || null,
          updated_at: new Date(),
        }
      }
    )
  } catch (err) {
    log.error({ postId, userId, err: err?.message || err }, 'Failed to update post error')
  }
}

async function markPublishing(postId, userId, meta = {}) {
  try {
    const posts = await col('posts')
    await posts.updateOne(
      postFilter(postId, userId),
      {
        $set: {
          status: 'publishing',
          provider_error: null,
          last_attempt_at: new Date(),
          last_job_id: meta.jobId || null,
          attempts_made: meta.attempt || null,
          updated_at: new Date(),
        }
      }
    )
  } catch (err) {
    log.error({ postId, userId, err: err?.message || err }, 'Failed to mark publishing')
  }
}

export const postPublishWorker = new Worker(
  'post-publish',
  async (job) => {
    const { postId, userId } = job.data || {}
    if (!postId) throw new Error('missing_postId')

    const max = Number(job.opts?.attempts || 1)
    const attempt = Number(job.attemptsMade || 0) + 1

    log.info({ postId, userId, jobId: job.id, attempt, max }, 'Publishing post')

    // optional: reflect state early in DB (nice for UI)
    await markPublishing(postId, userId, { jobId: job.id, attempt })

    try {
      const res = await publishPostNow(postId)
      log.info({ postId, userId, name: res?.name }, 'Published')
      return { name: res?.name || null }
    } catch (e) {
      const final = attempt >= max
      const picked = pickGoogleError(e)

      await markFailure(postId, userId, e, final, { jobId: job.id, attempt })

      log.error(
        { postId, userId, attempt, max, err: picked.message, status: picked.detail.status, body: picked.detail.body },
        'Publish failed'
      )
      throw e
    }
  },
  { connection, concurrency: 3 }
)

