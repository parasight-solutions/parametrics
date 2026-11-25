import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { getActiveGoogleIntegration, ensureAccessToken } from '../integrations/google.store.js'
import { sendError, sendSuccess } from '../utils/apiResponse.js'

const r = Router()

r.get('/google/status', authenticate, async (req,res)=>{
  try {
    const integ = await getActiveGoogleIntegration(req.user.user_id)
    if (!integ) return sendSuccess(res, { data: { ok: false, reason: 'no_integration' }, message: 'No Google integration found' })
    const at = await ensureAccessToken(integ)
    return sendSuccess(res, { data: { ok: true, token_present: Boolean(at.access_token) }, message: 'Google token check completed' })
  } catch (e) {
    console.error('[debug/google] error', e)
    return sendError(res, { statusCode: 502, message: 'Google token check failed', errors: [{ code: 'google_token_check_failed', message: 'Google token check failed' }] })
  }
})

export default r
