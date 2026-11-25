import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { ensureAccessToken } from '../integrations/google.store.js';
import { col } from '../lib/mongo.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';

const router = Router();

router.get('/debug/google/access', authenticate, async (req, res) => {
  try {
    const { access_token } = await ensureAccessToken(req.user.id);
    return sendSuccess(res, { data: { ok: true, token_present: Boolean(access_token) }, message: 'Google access check completed' });
  } catch (e) {
    console.error('[debug/google/access] error', e);
    return sendError(res, { statusCode: 502, message: 'Google access check failed', errors: [{ code: 'google_access_failed', message: 'Google access check failed' }] });
  }
});

router.post('/debug/google/clear', authenticate, async (req, res) => {
  const r = await (await col('integrations')).deleteMany({ provider:'google', user_id:req.user.id });
  return sendSuccess(res, { data: { ok: true, deleted: r.deletedCount }, message: 'Google debug data cleared' });
});

export default router;
