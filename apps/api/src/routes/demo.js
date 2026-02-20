import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { queues } from '../lib/queues.js'

export const demo = Router()

// Enqueue a demo publish (requires postId)
demo.post('/enqueue/publish', authenticate, async (req, res) => {
  const { postId } = req.body || {}
  if (!postId) return res.status(400).json({ error: { code: 'bad_request', message: 'postId required' }})
  await queues.postPublish.add('publish', { postId }, { attempts: 5, backoff: { type: 'exponential', delay: 2000 } })
  res.json({ ok: true })
})
