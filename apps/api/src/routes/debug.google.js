import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { getActiveGoogleIntegration, ensureAccessToken } from '../integrations/google.store.js'

const r = Router()

r.get('/google/status', authenticate, async (req,res)=>{
  try {
    const integ = await getActiveGoogleIntegration(req.user.user_id)
    if (!integ) return res.json({ ok:false, reason:'no_integration' })
    const at = await ensureAccessToken(integ)
    res.json({ ok:true, token_present: !!at.access_token, token_prefix: (at.access_token||'').slice(0,10) })
  } catch (e) {
    res.json({ ok:false, reason:e?.message || 'error' })
  }
})

export default r
