// apps/api/src/routes/integrations.google.js
import { Router } from 'express'
import crypto from 'crypto'
import { signJwt, verifyJwt } from '../lib/jwt.js'
import { col } from '../lib/mongo.js'
import { encJson, decJson } from '../lib/crypto.js'
import {
  listGoogleIntegrations,
  setActiveGoogleIntegration,
  getGoogleIntegrationBySubject,
  getActiveGoogleIntegration,
  upsertGoogleIntegration,
  ensureAccessToken,
  getGoogleIntegrationById
} from '../integrations/google.store.js'
import {
  listAccounts,
  listLocations,
  fetchPerformance,
  listLocationMedia
} from '../integrations/google.js'
import { authenticate } from '../middleware/auth.js'
import { ensureGoogleIntegrationIndexes } from "../integrations/google.indexes.js";

const router = Router()
const IS_PROD = (process.env.NODE_ENV || 'development') === 'production'

// --- Google OAuth constants ---
const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'
const SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'openid', 'email', 'profile'
].join(' ')

function reqOrigin(req) {
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

// Prefer env for prod, but in dev compute from actual request host+port (prevents 5000 vs 5050 mismatch)
function computeRedirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${reqOrigin(req)}/api/v1/integrations/google/callback`;
}

function postConnectRedirect() {
  return process.env.GOOGLE_POST_CONNECT_REDIRECT || 'http://localhost:5173/integrations/google/connected';
}

function decodeJwtPayload(idToken) {
  try {
    const parts = String(idToken || '').split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64 + pad, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function normalizeAccount(a) {
  const accountId = (a?.name || "").split("/").pop() || null
  return {
    name: a?.name || null,                // accounts/123
    accountId,
    accountName: a?.accountName || null,  // display name
    type: a?.type || null,
    role: a?.role || null,
    state: a?.state || null,
    verified: a?.verificationState || null,
  }
}

function formatAddress(addr) {
  if (!addr) return null
  const parts = [
    ...(addr.addressLines || []),
    addr.locality,
    addr.administrativeArea,
    addr.postalCode,
    addr.regionCode,
  ].filter(Boolean)
  return parts.join(", ")
}

function normalizeLocation(loc) {
  const locationId = (loc?.name || "").split("/").pop() || null // locations/XXXX
  const primaryPhone =
    loc?.phoneNumbers?.primaryPhone ||
    loc?.phoneNumbers?.additionalPhones?.[0] ||
    null

  return {
    name: loc?.name || null, // locations/xxxx
    locationId,
    title: loc?.title || null,
    storeCode: loc?.storeCode || null,
    websiteUri: loc?.websiteUri || null,
    primaryPhone,
    address: formatAddress(loc?.storefrontAddress),
    mapsUri: loc?.metadata?.mapsUri || null,
    placeId: loc?.metadata?.placeId || null,
    openInfo: loc?.openInfo || null,
  }
}

function normalizeAccountResourceName(v) {
  const s = String(v || "").trim();
  if (!s) return null;

  // valid formats
  if (/^accounts\/\d+$/.test(s)) return s;        // accounts/123
  if (/^\d+$/.test(s)) return `accounts/${s}`;   // 123

  const e = new Error(`accountName must be "accounts/<id>". You passed: "${s}". Use GET /accounts and pass the "name" field.`);
  e.http_status = 400;
  e.code = "bad_request";
  throw e;
}

// ---------- JWT helpers ----------
// function unsafeParseJwt(t) {
//   try {
//     const parts = String(t).split('.')
//     if (parts.length < 2) return null
//     const p = parts[1].replace(/-/g, '+').replace(/_/g, '/')
//     const pad = '='.repeat((4 - (p.length % 4)) % 4)
//     return JSON.parse(Buffer.from(p + pad, 'base64').toString('utf8'))
//   } catch { return null }
// }

// Accept JWT from Authorization: Bearer ... OR ?t=...
function userFromReq(req) {
  const header = req.headers.authorization || ''
  const m = header.match(/^Bearer\s+(.+)$/i)
  const q = (req.query?.t || '').toString()

  if (m) {
    try {
      const tok = verifyJwt(m[1])
      return { user_id: tok.user_id, role: tok.role }
    } catch (e) {
      // if (!IS_PROD) {
      //   const dec = unsafeParseJwt(m[1])
      //   if (dec?.user_id) {
      //     console.warn('[integrations.google/start] DEV accept unsigned header jwt for user_id=', dec.user_id)
      //     return { user_id: dec.user_id, role: dec.role || 'user' }
      //   }
      // }
      console.warn('[integrations.google/start] header token verify failed:', e?.message || e)
    }
  }

  if (q) {
    try {
      const tok = verifyJwt(q)
      return { user_id: tok.user_id, role: tok.role }
    } catch (e) {
      // if (!IS_PROD) {
      //   const dec = unsafeParseJwt(q)
      //   if (dec?.user_id) {
      //     console.warn('[integrations.google/start] DEV accept unsigned query jwt for user_id=', dec.user_id)
      //     return { user_id: dec.user_id, role: dec.role || 'user' }
      //   }
      // }
      console.warn('[integrations.google/start] query token verify failed:', e?.message || e)
    }
  }

  return null
}

// Map accountName ("accounts/..") -> integration doc (for multi-connection support)
const ACCOUNT_TO_INTEG_CACHE = new Map(); // userId -> { ts, map: Map(accountName -> integrationId) }
const ACCOUNT_TO_INTEG_TTL_MS = 60_000;

async function pickIntegrationForAccount(userId, accountName) {
  if (!accountName) return null;

  const now = Date.now();
  const cached = ACCOUNT_TO_INTEG_CACHE.get(userId);
  if (cached && (now - cached.ts) < ACCOUNT_TO_INTEG_TTL_MS) {
    const integId = cached.map?.get(accountName);
    if (integId) return getGoogleIntegrationById(userId, integId);
  }

  const integrations = await listGoogleIntegrations(userId);
  const map = new Map();

  for (const integ of integrations) {
    try {
      const { access_token } = await ensureAccessToken(integ);
      const data = await listAccounts(access_token);
      for (const a of (data?.accounts || [])) {
        if (a?.name) map.set(a.name, integ.id);
      }
    } catch (e) {
      // ignore per-connection failures; they may be revoked. status endpoint handles reauth separately.
      console.warn(
        "[pickIntegrationForAccount] integration failed",
        integ?.id,
        e?.status || "",
        e?.body || e?.message || e
      );
    }
  }

  ACCOUNT_TO_INTEG_CACHE.set(userId, { ts: now, map });

  const integId = map.get(accountName);
  if (!integId) return null;
  return getGoogleIntegrationById(userId, integId);
}

// ----------------------
// 1) START (no auth mw)
// ----------------------
router.get('/start', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  if (!clientId) {
    return res.status(500).json({ error: { code: 'config', message: 'GOOGLE_CLIENT_ID missing in .env' } });
  }

  const u = userFromReq(req);
  if (!u?.user_id) {
    console.error('[integrations.google/start] unauthorized: missing/invalid jwt. header=', !!req.headers.authorization, 'tParam=', !!req.query?.t);
    return res.status(401).json({ error: { code: 'unauthorized', message: 'pass JWT as Bearer or ?t=' } });
  }

  const ru = computeRedirectUri(req);

  // Put redirect_uri inside state so callback uses the same value (prevents port/host mismatch)
  const state = signJwt({ uid: u.user_id, ru, at: Date.now() }, { expiresIn: '10m' });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ru,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  res.redirect(`${AUTH_BASE}?${params.toString()}`);
});

// -------------------------
// 2) CALLBACK (no auth mw)
// -------------------------
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code/state');

    let uid, ru;
    try {
      const st = verifyJwt(String(state));
      uid = st?.uid;
      ru = st?.ru;
    } catch {
      return res.status(400).send('Bad state');
    }

    if (!uid) return res.status(400).send('Bad state (missing uid)');
    if (!ru) return res.status(400).send('Bad state (missing redirect_uri)');

    const body = new URLSearchParams({
      code: String(code),
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: String(ru),
      grant_type: 'authorization_code',
    });

    const tokRes = await fetchWithTimeout(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }, 15000);

    if (!tokRes.ok) {
      const msg = await tokRes.text().catch(() => '');
      console.error('[integrations.google/callback] token exchange failed:', tokRes.status, msg);
      return res.redirect(`${postConnectRedirect()}?google=fail&reason=token_exchange`);
    }

    const tok = await tokRes.json();

    if (!tok.id_token) {
      console.error('[integrations.google/callback] missing id_token');
      return res.redirect(`${postConnectRedirect()}?google=fail&reason=missing_id_token`);
    }

    // Decode id_token locally (faster + fewer failure points than tokeninfo)
    const info = decodeJwtPayload(tok.id_token) || {};
    const sub = info.sub || null;
    const email = info.email || null;

    if (!sub) {
      console.error('[integrations.google/callback] could not decode id_token sub');
      return res.redirect(`${postConnectRedirect()}?google=fail&reason=bad_id_token`);
    }

    // Preserve refresh_token for SAME identity
    let prev = {};
    try {
      const existing = await getGoogleIntegrationBySubject(uid, sub);
      if (existing?.secrets_json) prev = decJson(existing.secrets_json || "{}") || {};
    } catch { }

    const expiresInSec = Number(tok.expires_in || 3600);
    const expiryDateSec = Math.floor(Date.now() / 1000) + expiresInSec;

    const secrets = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || prev.refresh_token || null,

      // Store in SECONDS to match ensureAccessToken()
      expiry_date: expiryDateSec,

      scope: tok.scope,
      token_type: tok.token_type || 'Bearer',
      id_token: tok.id_token,
      email: email || prev.email || null,
      sub: sub || prev.sub || null,
    };

    await ensureGoogleIntegrationIndexes();

    try {
      await upsertGoogleIntegration(uid, {
        provider: "google",
        provider_email: email || prev.email || null,
        provider_subject: sub || prev.sub || null,
        needs_reauth: false,
        revoked_at: null,
        reauth_reason: null,
        scopes: (tok.scope || "").split(" ").filter(Boolean),
        secrets_json: encJson({ ...prev, ...secrets }),
      });
    } catch (e) {
      if (e?.code === 11000 && e?.keyPattern?.user_id === 1 && e?.keyPattern?.provider === 1) {
        console.warn("[integrations.google/callback] duplicate on {user_id,provider}; fixing indexes and retrying once");
        await ensureGoogleIntegrationIndexes();
        await upsertGoogleIntegration(uid, {
          provider: "google",
          provider_email: email || prev.email || null,
          provider_subject: sub || prev.sub || null,
          needs_reauth: false,
          revoked_at: null,
          reauth_reason: null,
          scopes: (tok.scope || "").split(" ").filter(Boolean),
          secrets_json: encJson({ ...prev, ...secrets }),
        });
      } else {
        throw e;
      }
    }

    return res.redirect(`${postConnectRedirect()}?google=ok`);
  } catch (e) {
    console.error('[integrations.google/callback] fatal error:', e);
    return res.redirect(`${postConnectRedirect()}?google=fail&reason=server_error`);
  }
});

// ---------------------------
// 3) STATUS (Bearer auth)
// ---------------------------
router.get("/status", authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const integ = await getActiveGoogleIntegration(userId);

    if (!integ) {
      return res.json({
        connected: false,
        needs_reauth: false,
        email: null,
        scopes: [],
        updated_at: null,
        activeIntegrationId: null,
      });
    }

    let email = integ.provider_email || null;
    try {
      const secrets = decJson(integ.secrets_json || "{}");
      email = secrets.email || email;
    } catch { }

    try {
      // This will clear needs_reauth on success, or throw reauth_required on invalid_grant
      await ensureAccessToken(integ);
    } catch (e) {
      if (e?.code === "reauth_required") {
        return res.json({
          connected: false,
          needs_reauth: true,
          email,
          scopes: integ.scopes || [],
          updated_at: integ.updated_at || null,
          activeIntegrationId: integ.id || null,
        });
      }

      return res.status(502).json({
        error: {
          code: "status_failed",
          message: e?.message || "status_failed",
          status: e?.status || 502,
          body: e?.body || null,
        },
      });
    }

    // Re-read after ensureAccessToken may have cleared flags
    const fresh = await getActiveGoogleIntegration(userId);

    return res.json({
      connected: true,
      needs_reauth: false,
      email,
      scopes: fresh?.scopes || integ.scopes || [],
      updated_at: fresh?.updated_at || integ.updated_at || null,
      activeIntegrationId: fresh?.id || integ.id || null,
    });
  } catch (e) {
    console.error("[integrations.google/status] failed", e);
    return res.status(502).json({ error: { code: "status_failed" } });
  }
});

router.get("/connections", authenticate, async (req, res) => {
  const list = await listGoogleIntegrations(req.user.user_id);
  const connections = list.map((x) => ({
    id: x.id,

    // return BOTH shapes to avoid breaking older UI code
    email: x.provider_email || null,
    provider_email: x.provider_email || null,

    provider_subject: x.provider_subject || null,
    // is_active: !!x.is_active || x.active === true,
    is_active: !!x.is_active,
    active: x.active !== false,

    scopes: Array.isArray(x.scopes) ? x.scopes : [],
    needs_reauth: !!x.needs_reauth,

    updated_at: x.updated_at || null,
  }));
  res.json({ connections });
});

router.post("/connections/:id/activate", authenticate, async (req, res) => {
  const updated = await setActiveGoogleIntegration(req.user.user_id, req.params.id);
  if (!updated) return res.status(404).json({ error: { code: "connection_not_found" } });
  res.json({ ok: true, activeIntegrationId: updated.id });
});

router.post("/disconnect", authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const integrations = await col("integrations");

    // Disable all google integrations for safety
    await integrations.updateMany(
      { user_id: userId, provider: "google" },
      {
        $set: {
          active: false,
          is_active: false,
          needs_reauth: true,
          revoked_at: new Date(),
          updated_at: new Date(),
        },
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("[integrations.google/disconnect] failed", e);
    return res.status(500).json({ error: { code: "server_error" } });
  }
});

// ---------------------------
// 4) ACCOUNTS (Bearer auth)
// ---------------------------
const ACCOUNTS_CACHE = new Map() // user_id -> { ts, data, inflight, cooldownUntil }
const ACCOUNTS_TTL_MS = 60_000
const COOLDOWN_MS = 60_000

// --- accountName -> integration mapping (multi-account) ---
const ACCOUNT_OWNER_CACHE = new Map(); // key: `${userId}:${accountName}` -> { ts, integrationId }
const ACCOUNT_OWNER_TTL_MS = 5 * 60 * 1000;

async function getIntegrationForAccountName(userId, accountName) {
  const key = `${userId}:${accountName}`;
  const cached = ACCOUNT_OWNER_CACHE.get(key);
  const now = Date.now();

  if (cached && (now - cached.ts) < ACCOUNT_OWNER_TTL_MS) {
    const integ = await getGoogleIntegrationById(userId, cached.integrationId);
    if (integ && integ.active !== false) return integ;
    ACCOUNT_OWNER_CACHE.delete(key);
  }

  const integrations = await listGoogleIntegrations(userId);

  for (const integ of integrations) {
    try {
      const { access_token } = await ensureAccessToken(integ);
      const data = await listAccounts(access_token);
      const ok = (data?.accounts || []).some(a => a?.name === accountName);
      if (ok) {
        ACCOUNT_OWNER_CACHE.set(key, { ts: now, integrationId: integ.id });
        return integ;
      }
    } catch (e) {
      // Ignore and try next integration
    }
  }

  return null;
}

async function getAccessTokenForAccount(userId, accountName, integrationId = null) {
  // If UI passes integrationId, use it directly
  if (integrationId) {
    const integ = await getGoogleIntegrationById(userId, integrationId);
    if (integ && integ.active !== false) {
      const { access_token } = await ensureAccessToken(integ);
      return { access_token, integ };
    }
  }

  // Fallback: find integration that owns this accountName
  const integ =
    (accountName ? await getIntegrationForAccountName(userId, accountName) : null) ||
    await getActiveGoogleIntegration(userId);

  if (!integ) {
    const e = new Error("no_integration");
    e.code = "no_integration";
    throw e;
  }

  const { access_token } = await ensureAccessToken(integ);
  return { access_token, integ };
}

async function listAllAccountsForUser(userId) {
  const integrations = await listGoogleIntegrations(userId);

  const raw = [];
  const errors = [];

  for (const integ of integrations) {
    // skip disconnected/revoked integrations
    if (integ?.active === false) continue;

    try {
      const { access_token } = await ensureAccessToken(integ);
      const data = await listAccounts(access_token);

      for (const a of (data?.accounts || [])) {
        const norm = normalizeAccount(a);
        if (!norm?.name) continue;

        raw.push({
          ...norm,
          integration_id: integ.id,
          owner_email: integ.provider_email || null,
          owner_subject: integ.provider_subject || null,
        });
      }
    } catch (e) {
      errors.push({
        integration_id: integ?.id || null,
        provider_email: integ?.provider_email || null,
        code: e?.code || null,
        status: e?.status || null,
        message: e?.message || "integration_failed",
        body: e?.body || null,
      });
    }
  }

  // Dedupe by accountName, but keep owners list
  const byName = new Map();
  for (const row of raw) {
    const key = row.name;
    const existing = byName.get(key);
    const owner = { integration_id: row.integration_id, email: row.owner_email };

    if (!existing) {
      byName.set(key, {
        ...row,
        owners: [owner],
      });
    } else {
      existing.owners.push(owner);
    }
  }

  return { accounts: Array.from(byName.values()), errors };
}

router.get('/accounts', authenticate, async (req, res) => {
  const uid = req.user.user_id
  const entry = ACCOUNTS_CACHE.get(uid) || {}
  const now = Date.now()

  if (entry.cooldownUntil && now < entry.cooldownUntil) {
    if (entry.data) return res.json({ accounts: entry.data.accounts || [], errors: entry.data.errors || [] })
    return res.status(502).json({ error: { code: 'accounts_list_failed' } })
  }

  const fresh = entry.ts && (now - entry.ts < ACCOUNTS_TTL_MS)
  if (fresh && entry.data) return res.json({ accounts: entry.data.accounts || [], errors: entry.data.errors || [] })

  if (entry.inflight) {
    try {
      const data = await entry.inflight
      return res.json({ accounts: data.accounts || [], errors: data.errors || [] })
    } catch (err) {
      console.error("[integrations.google/accounts] inflight failed", err?.status || "", err?.body || err?.message || err)
      return res.status(502).json({
        error: {
          code: "accounts_list_failed",
          message: err?.message || "accounts_list_failed",
          status: err?.status || null,
          body: err?.body || null,
        },
      })
    }
  }

  const p = (async () => {
    try {
      const data = await listAllAccountsForUser(uid)
      ACCOUNTS_CACHE.set(uid, { ts: Date.now(), data, inflight: null })
      return data
    } catch (err) {
      if (err?.status === 429) {
        ACCOUNTS_CACHE.set(uid, { ...entry, inflight: null, cooldownUntil: Date.now() + COOLDOWN_MS })
      } else {
        ACCOUNTS_CACHE.set(uid, { ...entry, inflight: null })
      }
      throw err
    }
  })()

  ACCOUNTS_CACHE.set(uid, { ts: 0, data: null, inflight: p })

  try {
    const data = await p
    return res.json({ accounts: data.accounts || [], errors: data.errors || [] })
  } catch (err) {
    console.error('[integrations.google/accounts] failed', err?.status || '', err?.body || err?.message || err)
    return res.status(502).json({
      error: {
        code: "accounts_list_failed",
        message: err?.message || "accounts_list_failed",
        status: err?.status || null,
        body: err?.body || null,
      },
    })
  }
})


// ---------------------------
// 5) LOCATIONS (Bearer auth)
// ---------------------------
router.get('/locations', authenticate, async (req, res) => {
  try {
    let accountName;
    try {
      accountName = normalizeAccountResourceName(req.query.accountName);
    } catch (e) {
      return res.status(e.http_status || 400).json({ error: { code: e.code || "bad_request", message: e.message } });
    }

    if (!accountName) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'accountName required' } });
    }

    const integrationId = String(req.query.integrationId || "") || null;
    const { access_token } = await getAccessTokenForAccount(req.user.user_id, accountName, integrationId);
    const data = await listLocations(access_token, accountName);

    return res.json({ locations: (data.locations || []).map(normalizeLocation) });
  } catch (err) {
    console.error('[integrations.google/locations] failed', err?.status || '', err?.body || err?.message || err);

    if (err?.code === "reauth_required") {
      return res.status(409).json({
        error: { code: "reauth_required", message: "Google connection expired/revoked. Please reconnect Google." },
      });
    }

    return res.status(502).json({
      error: {
        code: 'locations_list_failed',
        message: err?.message || 'locations_list_failed',
        status: err?.status || 502,
        body: err?.body || null,
      }
    });
  }
});


// ---------------------------
// 6) LOCATIONS IMPORT (Bearer auth)
// ---------------------------
router.post('/locations/import', authenticate, async (req, res) => {
  try {
    let accountName;
    try {
      accountName = normalizeAccountResourceName(req.body?.accountName);
    } catch (e) {
      return res.status(e.http_status || 400).json({ error: { code: e.code || "bad_request", message: e.message } });
    }

    if (!accountName) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'accountName required' } });
    }

    // const integ = await getActiveGoogleIntegration(req.user.user_id)
    const integrationId = String(req.body?.integrationId || "") || null;
    const { access_token, integ } = await getAccessTokenForAccount(req.user.user_id, accountName, integrationId);
    if (!integ) return res.status(404).json({ error: { code: 'no_integration' } })

    // const { access_token } = await ensureAccessToken(integ)
    const data = await listLocations(access_token, accountName)

    const list = data.locations || []
    const locations = await col('locations')
    let upserted = 0

    for (const loc of list) {
      const norm = normalizeLocation(loc)

      const doc = {
        user_id: req.user.user_id,
        provider: 'google',
        provider_account_name: accountName,     // accounts/xxx
        provider_location_name: norm.name,      // locations/yyy
        status: 'active',

        title: norm.title,
        storeCode: norm.storeCode,
        websiteUri: norm.websiteUri,
        primaryPhone: norm.primaryPhone,
        address: norm.address,
        mapsUri: norm.mapsUri,
        placeId: norm.placeId,

        updated_at: new Date(),
        integration_id: integ.id,
      }

      await locations.updateOne(
        { user_id: req.user.user_id, provider: 'google', provider_location_name: doc.provider_location_name },
        { $set: doc, $setOnInsert: { id: crypto.randomUUID(), created_at: new Date() } },
        { upsert: true }
      )

      upserted++
    }

    return res.json({ inserted: upserted })
  } catch (err) {
    console.error('[integrations.google/locations.import] failed', err?.status || '', err?.body || err?.message || err)
    return res.status(err?.http_status || err?.status || 502).json({
      error: {
        code: 'locations_import_failed',
        message: err?.message || 'locations_import_failed',
        status: err?.status || null,
        body: err?.body || null,
      }
    })
  }
})

router.post("/locations/reconcile", authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const integrations = await listGoogleIntegrations(userId);
    if (!integrations.length) {
      return res.status(409).json({ error: { code: "no_integration", message: "Google not connected" } });
    }

    // Build accountName -> integrationId mapping
    const accountToIntegration = new Map();
    const errors = [];

    for (const integ of integrations) {
      try {
        const { access_token } = await ensureAccessToken(integ);
        const data = await listAccounts(access_token);
        for (const a of data?.accounts || []) {
          if (a?.name) accountToIntegration.set(a.name, integ.id);
        }
      } catch (e) {
        errors.push({
          integration_id: integ.id,
          message: e?.message || "integration_failed",
          status: e?.status || null,
          body: e?.body || null,
        });
      }
    }

    const locations = await col("locations");
    const rows = await locations
      .find({ user_id: userId, provider: "google" }, { projection: { _id: 0, id: 1, provider_account_name: 1, integration_id: 1 } })
      .toArray();

    let updated = 0;
    let unmatched = 0;

    for (const loc of rows) {
      const want = accountToIntegration.get(loc.provider_account_name);
      if (!want) {
        unmatched++;
        continue;
      }
      if (loc.integration_id !== want) {
        await locations.updateOne(
          { id: loc.id, user_id: userId, provider: "google" },
          { $set: { integration_id: want, updated_at: new Date() } }
        );
        updated++;
      }
    }

    return res.json({
      scanned: rows.length,
      updated,
      unmatched,
      integrations_checked: integrations.length,
      errors,
    });
  } catch (err) {
    console.error("[integrations.google/locations.reconcile] failed", err);
    return res.status(500).json({ error: { code: "server_error", message: err?.message || "server_error" } });
  }
});

// ---------------------------
// 7) LOCATION MEDIA (logo/profile photo)
// ---------------------------
router.get('/location-media', authenticate, async (req, res) => {
  try {
    const accountName = String(req.query.accountName || '')
    const locationName = String(req.query.locationName || '')
    if (!accountName || !locationName) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'accountName and locationName required' } })
    }

    const integ =
      (await pickIntegrationForAccount(req.user.user_id, accountName)) ||
      (await getActiveGoogleIntegration(req.user.user_id));
    if (!integ) return res.status(404).json({ error: { code: 'no_integration' } })

    const { access_token } = await ensureAccessToken(integ)
    const data = await listLocationMedia(accountName, locationName, access_token, { pageSize: 10 })

    // pick best URLs for UI
    const items = data.mediaItems || []
    const pick = (cat) => items.find(x => (x?.mediaFormat?.category || x?.category) === cat) || null

    const profile = pick('PROFILE') || pick('LOGO') || null
    const cover = pick('COVER') || null

    return res.json({
      profilePhotoUrl: profile?.googleUrl || profile?.mediaFormat?.googleUrl || null,
      coverPhotoUrl: cover?.googleUrl || cover?.mediaFormat?.googleUrl || null,
      count: items.length
    })
  } catch (err) {
    console.error('[integrations.google/location-media] failed', err?.status || '', err?.body || err?.message || err)
    return res.status(502).json({ error: { code: 'location_media_failed' } })
  }
})

// ---------------------------
// 8) PERFORMANCE (Dashboard)
// ---------------------------

// GBP Performance API valid DailyMetric values (see docs)
// https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries#dailymetric
const ALLOWED_DAILY_METRICS = new Set([
  'WEBSITE_CLICKS',
  'CALL_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_FOOD_ORDERS',
  'BUSINESS_FOOD_MENU_CLICKS',
])

// Back-compat: map your old “aggregate” names to the actual API enums
const METRIC_ALIASES = {
  // legacy -> valid
  DIRECTIONS_REQUESTS: ['BUSINESS_DIRECTION_REQUESTS'],
  BUSINESS_IMPRESSIONS_SEARCH: [
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  ],
  BUSINESS_IMPRESSIONS_MAPS: [
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  ],
}

function normalizeMetricName(m) {
  return String(m || '').trim().toUpperCase()
}

function expandAndValidateMetrics(requestedMetrics) {
  const requested = (requestedMetrics || [])
    .map(normalizeMetricName)
    .filter(Boolean)

  const groups = [] // [{ key, expanded: [] }]
  const expandedSet = new Set()

  for (const key of requested) {
    const expanded = METRIC_ALIASES[key] || [key]

    for (const m of expanded) {
      if (!ALLOWED_DAILY_METRICS.has(m)) {
        const e = new Error(`invalid_metric:${m}`)
        e.code = 'invalid_metric'
        e.metric = m
        e.allowed = Array.from(ALLOWED_DAILY_METRICS).sort()
        throw e
      }
      expandedSet.add(m)
    }

    groups.push({ key, expanded })
  }

  return { requested, expanded: Array.from(expandedSet), groups }
}

function buildTotalsByMetric(raw) {
  // raw.multiDailyMetricTimeSeries[*].dailyMetricTimeSeries[*]
  const totals = new Map()

  for (const series of (raw?.multiDailyMetricTimeSeries || [])) {
    for (const s of (series?.dailyMetricTimeSeries || [])) {
      const metric = s?.dailyMetric
      if (!metric) continue
      const values = s?.timeSeries?.datedValues || []
      let sum = 0
      for (const v of values) sum += Number(v?.value || 0)
      totals.set(metric, (totals.get(metric) || 0) + sum)
    }
  }

  return totals
}

router.get('/performance', authenticate, async (req, res) => {
  try {
    const locationId = String(req.query.locationId || '')
    const days = Math.max(1, Math.min(90, Number(req.query.days || 30)))

    if (!locationId) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'locationId required' } })
    }

    const locations = await col('locations')
    const loc = await locations.findOne({ id: locationId, user_id: req.user.user_id, provider: 'google' })
    if (!loc) {
      return res.status(404).json({ error: { code: 'not_found', message: 'location not found' } })
    }

    let integ = null;

    // Prefer the integration that imported/owns this location
    if (loc?.integration_id) {
      integ = await getGoogleIntegrationById(req.user.user_id, loc.integration_id);
    }

    // Fallback: active integration (older locations may not have integration_id)
    if (!integ) {
      integ = await getActiveGoogleIntegration(req.user.user_id);
    }

    if (!integ) {
      return res.status(404).json({ error: { code: "no_integration" } });
    }

    const { access_token } = await ensureAccessToken(integ);

    // If caller passes metrics=... use it. Otherwise keep your legacy list (we’ll alias-expand it).
    const requestedMetrics = req.query.metrics
      ? String(req.query.metrics).split(',').map(s => s.trim()).filter(Boolean)
      : [
        'WEBSITE_CLICKS',
        'CALL_CLICKS',
        'DIRECTIONS_REQUESTS',
        'BUSINESS_IMPRESSIONS_SEARCH',
        'BUSINESS_IMPRESSIONS_MAPS',
      ]

    const { requested, expanded, groups } = expandAndValidateMetrics(requestedMetrics)

    // Call API using ONLY valid enums
    const raw = await fetchPerformance(access_token, loc.provider_location_name, { days, metrics: expanded })

    const totalsByMetric = buildTotalsByMetric(raw)

    // Return totals in the *requested* keys (including legacy names), aggregating where needed
    const out = groups.map(g => {
      let total = 0
      for (const m of g.expanded) total += Number(totalsByMetric.get(m) || 0)
      return { metric: g.key, total }
    })

    return res.json({
      range: { days },
      metrics: out,
      // optional debug field (remove if you don’t want)
      expanded_metrics_used: expanded,
    })
  } catch (err) {
    if (err?.code === 'invalid_metric') {
      return res.status(400).json({
        error: {
          code: 'bad_request',
          message: `Invalid metric: ${err.metric}`,
          allowed: err.allowed,
        },
      })
    }

    const status = err?.status || 502
    const body = err?.body || null

    console.error(
      '[integrations.google/performance] failed',
      'status=', status,
      'body=', body || err?.message || err
    )

    return res.status(502).json({
      error: {
        code: 'performance_failed',
        message: err?.message || 'performance_failed',
        status,
        body,
      }
    })
  }
})

export default router
