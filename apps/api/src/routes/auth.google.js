import { Router } from 'express'
import crypto from 'crypto'
import { config } from '../config.js'
import { signJwt, verifyJwt } from '../lib/jwt.js'
import { query } from '../lib/db.js'

const router = Router()

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'
const SCOPES = 'openid email profile'

function redirectUri() {
  return process.env.GOOGLE_OIDC_REDIRECT_URI || `http://localhost:${config.port}/api/v1/auth/google/callback`
}

function buildAuthUrl() {
  const state = signJwt(
    { r: (process.env.APP_URL || 'http://localhost:5173') + '/login' },
    { expiresIn: '10m' }
  )
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OIDC_CLIENT_ID || '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'select_account',
    state
  })
  return `${AUTH_BASE}?${params.toString()}`
}

// GET /api/v1/auth/google/start
router.get('/start', (_req, res) => res.redirect(buildAuthUrl()))

// GET /api/v1/auth/google/callback
router.get('/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code || !state) return res.status(400).send('Missing code/state')

  // Verify state and get return URL
  let st
  try { st = verifyJwt(state.toString()) }
  catch { return res.status(400).send('Bad state') }
  const returnUrl = typeof st?.r === 'string' ? st.r : (process.env.APP_URL || 'http://localhost:5173') + '/login'

  // 1) Exchange code for tokens
  const body = new URLSearchParams({
    code: code.toString(),
    client_id: process.env.GOOGLE_OIDC_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_OIDC_CLIENT_SECRET || '',
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code'
  })
  const tokRes = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!tokRes.ok) return res.status(502).send('Token exchange failed')
  const tok = await tokRes.json()
  const id_token = tok.id_token
  if (!id_token) return res.status(502).send('No id_token from Google')

  // 2) Validate ID token
  const infoRes = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(id_token)}`)
  if (!infoRes.ok) return res.status(502).send('Invalid id_token')
  const info = await infoRes.json()

  if (info.aud !== (process.env.GOOGLE_OIDC_CLIENT_ID || '')) return res.status(400).send('Token aud mismatch')
  const email = info.email
  const sub = info.sub
  if (!email || !sub) return res.status(400).send('Missing email/sub')

  // 3) Upsert user
  const { rows } = await query('select id, role from users where email=$1 limit 1', [email])
  let id, role
  if (rows.length) {
    id = rows[0].id
    role = rows[0].role
    await query('update users set oauth_provider=$2, oauth_sub=$3, updated_at=now() where id=$1', [id, 'google', sub])
  } else {
    id = crypto.randomUUID()
    role = 'individual'
    await query('insert into users (id, email, name, role, oauth_provider, oauth_sub) values ($1,$2,$3,$4,$5,$6)',
      [id, email, info.name || null, role, 'google', sub])
  }

  // 4) Issue our app JWT and send back to the app (Login page consumes it)
  const appJwt = signJwt({ user_id: id, role })
  return res.redirect(`${returnUrl}?gjwt=${encodeURIComponent(appJwt)}`)
})

export default router
