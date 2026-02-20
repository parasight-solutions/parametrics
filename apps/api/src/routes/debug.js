import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { ensureAccessToken } from '../integrations/google.store.js';
import { col } from '../lib/mongo.js';

const router = Router();

router.get('/debug/google/access', authenticate, async (req, res) => {
  try {
    const { access_token } = await ensureAccessToken(req.user.id);
    res.json({ ok: true, token_length: access_token ? access_token.length : 0 });
  } catch (e) {
    res.status(200).json({ ok:false, message:e.message, status:e.status||null, body:e.body||null, hint:e.hint||null });
  }
});

router.post('/debug/google/clear', authenticate, async (req, res) => {
  const r = await (await col('integrations')).deleteMany({ provider:'google', user_id:req.user.id });
  res.json({ ok:true, deleted:r.deletedCount });
});

export default router;
