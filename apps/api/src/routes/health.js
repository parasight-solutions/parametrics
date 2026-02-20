import { Router } from 'express'
export const health = Router()
health.get('/', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }))
