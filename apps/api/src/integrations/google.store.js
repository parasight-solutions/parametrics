// apps/api/src/integrations/google.store.js
import { randomUUID } from "crypto";
import { col } from "../lib/mongo.js";
import { encJson, decJson } from "../lib/crypto.js";

const COLLECTION = "integrations";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const nowSec = () => Math.floor(Date.now() / 1000);

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  const body = text
    ? (() => {
        try { return JSON.parse(text); } catch { return { raw: text }; }
      })()
    : {};
  if (!r.ok) {
    const err = new Error("http_error");
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function getGoogleIntegration(userId) {
  const c = await col(COLLECTION);

  // Prefer explicit default connection
  const a = await c.findOne({
    user_id: userId,
    provider: "google",
    is_active: true,
    active: { $ne: false },
    needs_reauth: { $ne: true },
  });
  if (a) return a;

  // Back-compat: active:true
  const b = await c.findOne({
    user_id: userId,
    provider: "google",
    active: true,
    needs_reauth: { $ne: true },
  });
  if (b) return b;

  // Fallback: newest usable
  return c.findOne(
    { user_id: userId, provider: "google", active: { $ne: false }, needs_reauth: { $ne: true } },
    { sort: { updated_at: -1 } }
  );
}

export async function getActiveGoogleIntegration(userId) {
  return getGoogleIntegration(userId);
}

export async function getGoogleIntegrationById(userId, integrationId) {
  const c = await col(COLLECTION);
  return c.findOne({
    user_id: userId,
    provider: "google",
    id: integrationId,
    active: { $ne: false },
  });
}

export async function getGoogleIntegrationBySubject(userId, provider_subject) {
  const c = await col(COLLECTION);
  return c.findOne({
    user_id: userId,
    provider: "google",
    provider_subject,
    active: { $ne: false },
  });
}

export async function listGoogleIntegrations(userId) {
  const c = await col(COLLECTION);
  return c
    .find({ user_id: userId, provider: "google", active: { $ne: false } })
    .sort({ updated_at: -1 })
    .toArray();
}

export async function setActiveGoogleIntegration(userId, integrationId) {
  const c = await col(COLLECTION);

  // Only flip the default flag. Do NOT touch `active` (that’s for soft-delete / disconnect).
  await c.updateMany(
    { user_id: userId, provider: "google", active: { $ne: false } },
    { $set: { is_active: false } }
  );

  const { value } = await c.findOneAndUpdate(
    { user_id: userId, provider: "google", id: integrationId, active: { $ne: false } },
    { $set: { is_active: true, updated_at: new Date() } },
    { returnDocument: "after" }
  );

  return value;
}

export async function upsertGoogleIntegration(userId, payload) {
  const integrations = await col(COLLECTION);
  const now = new Date();

  const provider = payload.provider || "google";
  const provider_subject = payload.provider_subject || null;
  const provider_email = payload.provider_email || null;

  // For Google, provider_subject (tokeninfo "sub") should always be present.
  if (!provider_subject || typeof provider_subject !== "string") {
    throw new Error("missing_provider_subject");
  }

  const filter = { user_id: userId, provider, provider_subject };

  // Only auto-activate when there is no usable default connection yet.
  const existingActive = await integrations.findOne(
    {
      user_id: userId,
      provider,
      is_active: true,
      active: { $ne: false },
      needs_reauth: { $ne: true },
    },
    { projection: { _id: 0, id: 1 } }
  );

  const shouldActivate = !existingActive;

  if (shouldActivate) {
    // Only flip default flags; DO NOT touch `active`
    await integrations.updateMany(
      { user_id: userId, provider, active: { $ne: false } },
      { $set: { is_active: false, updated_at: now } }
    );
  }

  // Connecting/reconnecting should always keep this integration enabled
  const setDoc = {
    ...payload,
    user_id: userId,
    provider,
    provider_subject,
    provider_email,
    active: true,          // <— always true on connect
    updated_at: now,
  };

  if (shouldActivate) {
    setDoc.is_active = true;
  }

  await integrations.updateOne(
    filter,
    {
      $set: setDoc,
      // IMPORTANT: do NOT include `active` here (avoid conflict with $set)
      $setOnInsert: { id: randomUUID(), created_at: now },
    },
    { upsert: true }
  );

  return integrations.findOne(filter, { projection: { _id: 0 } });
}

export async function updateGoogleIntegration(id, patch) {
  const c = await col(COLLECTION);
  const now = new Date();
  const { value } = await c.findOneAndUpdate(
    { id },
    { $set: { ...patch, updated_at: now } },
    { returnDocument: "after" }
  );
  return value;
}

export const saveGoogleIntegration = upsertGoogleIntegration;

// Back-compat: accepts integration doc OR userId string
export async function ensureAccessToken(integOrUserId) {
  let integ = null;

  if (typeof integOrUserId === "string") {
    integ = await getGoogleIntegration(integOrUserId);
  } else if (integOrUserId && typeof integOrUserId === "object") {
    integ = integOrUserId;
  }

  if (!integ) {
    const e = new Error("no_integration");
    e.code = "no_integration";
    throw e;
  }

  const client_id = process.env.GOOGLE_CLIENT_ID;
  const client_secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!client_id || !client_secret) {
    const e = new Error("config_missing_client");
    e.code = "config_missing_client";
    e.hint = "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in apps/api/.env";
    throw e;
  }

  let secrets = {};
  try {
    secrets = decJson(integ.secrets_json || "{}");
  } catch (err) {
    err.code = "decrypt_failed";
    err.hint = "Check APP_ENC_KEY (or ENCRYPTION_KEY) matches what was used to encrypt existing secrets.";
    throw err;
  }

  const markNeedsReauth = async (reason, details = null, clearRefreshToken = false) => {
    const cleared = {
      ...secrets,
      access_token: null,
      expiry_date: 0,
      ...(clearRefreshToken ? { refresh_token: null } : {}),
    };

    await updateGoogleIntegration(integ.id, {
      needs_reauth: true,
      reauth_reason: reason,
      revoked_at: new Date(),
      secrets_json: encJson(cleared),
      reauth_details: details || null,
    });
  };

  const exp = Number(secrets.expiry_date || 0);
  if (secrets.access_token && exp > nowSec() + 60) {
    return { access_token: secrets.access_token };
  }

  if (!secrets.refresh_token) {
    await markNeedsReauth("missing_refresh_token", { hint: "Reconnect with prompt=consent" }, true);
    const e = new Error("reauth_required");
    e.code = "reauth_required";
    e.status = 409;
    e.body = { error: "missing_refresh_token" };
    throw e;
  }

  const form = new URLSearchParams({
    client_id,
    client_secret,
    grant_type: "refresh_token",
    refresh_token: secrets.refresh_token,
  });

  try {
    const tok = await fetchJson(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    const updated = {
      access_token: tok.access_token,
      refresh_token: secrets.refresh_token,
      expiry_date: nowSec() + Number(tok.expires_in || 3600),
      scope: tok.scope || secrets.scope,
      token_type: tok.token_type || "Bearer",
    };

    const merged = { ...secrets, ...updated };
    await updateGoogleIntegration(integ.id, {
      needs_reauth: false,
      reauth_reason: null,
      revoked_at: null,
      reauth_details: null,
      secrets_json: encJson(merged),
    });

    return { access_token: merged.access_token };
  } catch (err) {
    const isInvalidGrant =
      (err?.status === 400 || err?.status === 401) &&
      (err?.body?.error === "invalid_grant" ||
        String(err?.body?.error_description || "").toLowerCase().includes("expired") ||
        String(err?.body?.error_description || "").toLowerCase().includes("revoked"));

    if (isInvalidGrant) {
      await markNeedsReauth("invalid_grant", err?.body || null, true);

      const e = new Error("reauth_required");
      e.code = "reauth_required";
      e.status = 409;
      e.body = err?.body || null;
      throw e;
    }

    throw err;
  }
}
