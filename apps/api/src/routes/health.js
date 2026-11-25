import { Router } from 'express'
import { sendSuccess } from '../utils/apiResponse.js'
export const health = Router()
health.get('/', (_req, res) => sendSuccess(res, { data: { ok: true, ts: new Date().toISOString() }, message: 'API is healthy' }))
