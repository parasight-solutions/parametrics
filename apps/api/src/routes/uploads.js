import { Router } from 'express'
import multer from 'multer'
import { authenticate as defaultAuthenticate } from '../middleware/auth.js'
import { uploadRateLimit } from '../middleware/rateLimit.js'
import { auditFailure, auditSuccess } from '../services/auditLog.js'
import { requireOwnedOrganizationLocationAccess } from '../services/organizationAccess.js'
import { UPLOAD_MAX_BYTES, sniffImageType, storeUpload } from '../services/uploadStorage.js'

// Same roles that may create a post for the location the image is for.
const UPLOAD_ROLES = Object.freeze(['owner', 'admin', 'manager'])

function defaultPublicBase() {
  return process.env.APP_PUBLIC_API_BASE || `http://localhost:${process.env.PORT || 5050}`
}

// Order: authenticate -> rate limit (keyed on the user) -> location access ->
// parse. Unauthenticated or unauthorized requests are refused before any
// file bytes are parsed.
export function createUploadsRouter({
  uploadDir,
  authenticate = defaultAuthenticate,
  rateLimit = uploadRateLimit,
  requireLocationAccess = requireOwnedOrganizationLocationAccess,
  audit = { success: auditSuccess, failure: auditFailure },
  publicBase = defaultPublicBase,
  maxBytes = UPLOAD_MAX_BYTES,
} = {}) {
  if (!uploadDir) throw new Error('createUploadsRouter requires uploadDir')

  const router = Router()
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 0 },
  }).single('file')

  async function fail(req, res, status, code, metadata = {}) {
    await audit.failure(req, 'upload.file', { target_type: 'upload', metadata: { reason: code, ...metadata } })
    return res.status(status).json({ error: { code } })
  }

  async function requireUploadLocation(req, res, next) {
    const locationId = typeof req.query?.locationId === 'string' ? req.query.locationId.trim() : ''
    if (!locationId || locationId.length > 200) return fail(req, res, 400, 'location_required')
    try {
      await requireLocationAccess({
        userId: req.user.user_id,
        locationId,
        provider: 'google',
        allowedRoles: UPLOAD_ROLES,
      })
    } catch (e) {
      const status = Number(e?.status || 0)
      if (status >= 400 && status < 500) {
        const code = /^[a-z_]{1,64}$/.test(String(e?.code || '')) ? e.code : 'forbidden'
        return fail(req, res, status, code)
      }
      return fail(req, res, 500, 'upload_failed')
    }
    req.uploadLocationId = locationId
    return next()
  }

  router.post('/', authenticate, rateLimit, requireUploadLocation, (req, res) => {
    parse(req, res, async (err) => {
      if (err) {
        if (err?.code === 'LIMIT_FILE_SIZE') return fail(req, res, 413, 'file_too_large')
        return fail(req, res, 400, 'upload_invalid', { multer: String(err?.code || 'error').slice(0, 40) })
      }
      if (!req.file) return fail(req, res, 400, 'missing_file')

      const type = sniffImageType(req.file.buffer)
      if (!type) return fail(req, res, 415, 'unsupported_media_type')

      let filename
      try {
        ;({ filename } = await storeUpload({ dir: uploadDir, buffer: req.file.buffer, ext: type.ext }))
      } catch {
        return fail(req, res, 500, 'upload_failed')
      }

      await audit.success(req, 'upload.file', {
        target_type: 'upload',
        target_id: filename,
        location_id: req.uploadLocationId,
        metadata: { content_type: type.contentType, size: req.file.size },
      })
      return res.json({ url: `${publicBase()}/uploads/${filename}`, filename })
    })
  })

  return router
}
