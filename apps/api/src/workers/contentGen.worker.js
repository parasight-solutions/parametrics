import { Worker } from 'bullmq'
import { connection } from '../lib/queues.js'
import { query } from '../lib/db.js'
import crypto from 'crypto'

new Worker('content-gen', async job => {
  const { locationId, title='Auto Draft', body='Generated body...', scheduled_for=null } = job.data
  const id = crypto.randomUUID()
  await query(
    'insert into posts (id, location_id, type, title, body, status, scheduled_for, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, locationId, 'update', title, body, 'draft', scheduled_for, null]
  )
  return { postId: id }
}, { connection })
