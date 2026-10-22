import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { ensureAccessToken } from '../integrations/google.store.js';
import { col } from '../lib/mongo.js';
import { requireDebugRoutesEnabled, debugReason } from '../lib/debugRoutes.js';

// Mounted at /api/v1/debug only when isDebugRoutesEnabled() (local + opt-in).
const router = Router();

export const CLEAR_CONFIRMATION = 'delete-my-google-integration';

router.use(requireDebugRoutesEnabled);

router.get('/google/access', authenticate, async (req, res) => {
  try {
    const { access_token } = await ensureAccessToken(req.user.user_id);
    res.json({ ok: true, token_present: !!access_token });
  } catch (e) {
    res.status(200).json({ ok: false, reason: debugReason(e) });
  }
});

// Destructive: only the caller's own Google integration rows, and only with an
// explicit confirmation body.
router.post('/google/clear', authenticate, async (req, res) => {
  const userId = String(req.user?.user_id || '').trim();
  if (!userId) return res.status(401).json({ ok: false, reason: 'unauthorized' });
  if (req.body?.confirm !== CLEAR_CONFIRMATION) {
    return res.status(400).json({ ok: false, reason: 'confirmation_required' });
  }
  try {
    const r = await (await col('integrations')).deleteMany({ provider: 'google', user_id: userId });
    res.json({ ok: true, deleted: r.deletedCount });
  } catch {
    res.status(500).json({ ok: false, reason: 'delete_failed' });
  }
});

export default router;
