// apps/api/src/lib/queues.js
import IORedis from 'ioredis'
import { Queue } from 'bullmq'

const host = process.env.REDIS_HOST || '127.0.0.1'
const port = Number(process.env.REDIS_PORT || 6379)
const tls  = (process.env.REDIS_TLS || 'false') === 'true'

export const connection = new IORedis({
  host, port,
  tls: tls ? {} : undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
})

export const makeQueue = (name) => new Queue(name, { connection })
export const queues = { postPublish: makeQueue('post-publish') }
