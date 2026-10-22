import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { getActiveGoogleIntegration, ensureAccessToken } from '../integrations/google.store.js'
import { requireDebugRoutesEnabled, debugReason } from '../lib/debugRoutes.js'

// Mounted at /api/v1/debug only when isDebugRoutesEnabled() (local + opt-in).
const r = Router()

r.use(requireDebugRoutesEnabled)

r.get('/google/status', authenticate, async (req,res)=>{
  try {
    const integ = await getActiveGoogleIntegration(req.user.user_id)
    if (!integ) return res.json({ ok:false, reason:'no_integration' })
    const at = await ensureAccessToken(integ)
    res.json({ ok:true, token_present: !!at.access_token })
  } catch (e) {
    res.json({ ok:false, reason: debugReason(e) })
  }
})

export default r
