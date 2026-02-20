import { Worker } from 'bullmq'
import { connection } from '../lib/queues.js'

new Worker('notify', async job => {
  // TODO: send email/Slack
  return { ok: true, type: job.data?.type || 'generic' }
}, { connection })
