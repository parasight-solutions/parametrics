import { Worker } from 'bullmq'
import { connection } from '../lib/queues.js'
import { query } from '../lib/db.js'

new Worker('image-gen', async job => {
  const { postId } = job.data
  // TODO: generate images and store references
  await query(`update posts set images = coalesce(images, '[]'::jsonb) || $$[{"key":"s3://mock/image.jpg"}]$$::jsonb where id=$1`, [postId])
  return { ok: true }
}, { connection })
