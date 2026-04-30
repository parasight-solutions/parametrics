import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { uploadRateLimit } from '../middleware/rateLimit.js'
import { auditFailure, auditSuccess } from '../services/auditLog.js'

const router = Router()
const dir = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(dir)) fs.mkdirSync(dir)

const storage = multer.diskStorage({
  destination: (_req, _file, cb)=>cb(null, dir),
  filename: (_req, file, cb)=>cb(null, Date.now()+'-'+(file.originalname||'file'))
})
const upload = multer({ storage })
router.post('/', uploadRateLimit, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      await auditFailure(req, 'upload.file', {
        target_type: 'upload',
        metadata: { reason: err?.message || 'upload_failed' },
      })
      return res.status(400).json({ error: { code: 'upload_failed' } })
    }

    if (!req.file) {
      await auditFailure(req, 'upload.file', {
        target_type: 'upload',
        metadata: { reason: 'missing_file' },
      })
      return res.status(400).json({ error: { code: 'missing_file' } })
    }

    const url = `${process.env.APP_PUBLIC_API_BASE || `http://localhost:${process.env.PORT||5050}`}/uploads/${req.file.filename}`
    await auditSuccess(req, 'upload.file', {
      target_type: 'upload',
      target_id: req.file.filename,
      metadata: {
        filename: req.file.filename,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
    })
    return res.json({ url, filename: req.file.filename })
  })
})
export default router
