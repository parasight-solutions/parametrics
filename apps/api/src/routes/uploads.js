import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { uploadRateLimit } from '../middleware/rateLimit.js'

const router = Router()
const dir = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(dir)) fs.mkdirSync(dir)

const storage = multer.diskStorage({
  destination: (_req, _file, cb)=>cb(null, dir),
  filename: (_req, file, cb)=>cb(null, Date.now()+'-'+(file.originalname||'file'))
})
const upload = multer({ storage })
router.post('/', uploadRateLimit, upload.single('file'), (req,res)=>{
  const url = `${process.env.APP_PUBLIC_API_BASE || `http://localhost:${process.env.PORT||5050}`}/uploads/${req.file.filename}`
  res.json({ url, filename: req.file.filename })
})
export default router
