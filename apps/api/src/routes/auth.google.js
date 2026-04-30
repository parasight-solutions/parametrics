// apps/api/src/routes/auth.google.js
import { Router } from "express";
import crypto from "crypto";
import { config } from "../config.js";
import { signJwt, verifyJwt } from "../lib/jwt.js";
import { col } from "../lib/mongo.js";
import { oauthRateLimit } from "../middleware/rateLimit.js";

const router = Router();

const AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const SCOPES = "openid email profile";

function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function appUrl() {
  return cleanStr(process.env.APP_URL || "http://localhost:5173", 500);
}

function redirectUri() {
  return (
    cleanStr(process.env.GOOGLE_OIDC_REDIRECT_URI, 500) ||
    `http://localhost:${config.port}/api/v1/auth/google/callback`
  );
}

function buildAuthUrl() {
  const state = signJwt(
    { r: `${appUrl()}/login` },
    { expiresIn: "10m" }
  );

  const params = new URLSearchParams({
    client_id: cleanStr(process.env.GOOGLE_OIDC_CLIENT_ID, 500),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    prompt: "select_account",
    state,
  });

  return `${AUTH_BASE}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    code: String(code),
    client_id: cleanStr(process.env.GOOGLE_OIDC_CLIENT_ID, 500),
    client_secret: cleanStr(process.env.GOOGLE_OIDC_CLIENT_SECRET, 500),
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });

  const tokRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!tokRes.ok) {
    const text = await tokRes.text().catch(() => "");
    throw new Error(`google_token_exchange_failed:${tokRes.status}:${text}`);
  }

  return tokRes.json();
}

async function verifyGoogleIdToken(idToken) {
  const infoRes = await fetch(
    `${TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`
  );

  if (!infoRes.ok) {
    const text = await infoRes.text().catch(() => "");
    throw new Error(`google_id_token_invalid:${infoRes.status}:${text}`);
  }

  const info = await infoRes.json();
  const expectedAud = cleanStr(process.env.GOOGLE_OIDC_CLIENT_ID, 500);

  if (info.aud !== expectedAud) {
    throw new Error("google_token_aud_mismatch");
  }

  if (!info.email || !info.sub) {
    throw new Error("google_token_missing_email_or_sub");
  }

  return info;
}

async function findOrCreateGoogleUser({ email, sub, name }) {
  const users = await col("users");
  const normalizedEmail = cleanStr(email, 320).toLowerCase();
  const now = new Date();

  let user =
    (await users.findOne({
      oauth_provider: "google",
      oauth_sub: sub,
    })) ||
    (await users.findOne({
      normalized_email: normalizedEmail,
    })) ||
    (await users.findOne({
      email: new RegExp(`^${normalizedEmail}$`, "i"),
    }));

  if (user) {
    const patch = {
      oauth_provider: "google",
      oauth_sub: sub,
      normalized_email: normalizedEmail,
      updated_at: now,
    };

    if (!user.email) patch.email = email;
    if (!user.full_name && name) patch.full_name = name;
    if (!user.status) patch.status = "active";

    await users.updateOne(
      { _id: user._id },
      { $set: patch }
    );

    return {
      id: user.id,
      email: user.email || email,
      role: user.role || "individual",
    };
  }

  const doc = {
    id: crypto.randomUUID(),
    email,
    normalized_email: normalizedEmail,
    full_name: cleanStr(name, 200) || null,
    role: "individual",
    status: "active",
    oauth_provider: "google",
    oauth_sub: sub,
    created_at: now,
    updated_at: now,
  };

  await users.insertOne(doc);

  return {
    id: doc.id,
    email: doc.email,
    role: doc.role,
  };
}

// GET /api/v1/auth/google/start
router.get("/start", oauthRateLimit, (_req, res) => {
  const clientId = cleanStr(process.env.GOOGLE_OIDC_CLIENT_ID, 500);
  const clientSecret = cleanStr(process.env.GOOGLE_OIDC_CLIENT_SECRET, 500);

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: {
        code: "google_oidc_not_configured",
        message: "Google OIDC client credentials are missing",
      },
    });
  }

  return res.redirect(buildAuthUrl());
});

// GET /api/v1/auth/google/callback
router.get("/callback", oauthRateLimit, async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send("Missing code/state");
    }

    let st;
    try {
      st = verifyJwt(String(state));
    } catch {
      return res.status(400).send("Bad state");
    }

    const returnUrl =
      typeof st?.r === "string" && st.r.trim()
        ? st.r
        : `${appUrl()}/login`;

    const tok = await exchangeCodeForTokens(String(code));
    const idToken = tok?.id_token;

    if (!idToken) {
      return res.status(502).send("No id_token from Google");
    }

    const info = await verifyGoogleIdToken(idToken);

    const email = cleanStr(info.email, 320);
    const sub = cleanStr(info.sub, 200);
    const name = cleanStr(info.name, 200);

    const user = await findOrCreateGoogleUser({
      email,
      sub,
      name,
    });

    const appJwt = signJwt({
      user_id: user.id,
      role: user.role,
      email: user.email,
    });

    return res.redirect(
      `${returnUrl}?gjwt=${encodeURIComponent(appJwt)}`
    );
  } catch (e) {
    console.error("[auth/google/callback] error", e);
    return res.status(500).send("Google login failed");
  }
});

export default router;
