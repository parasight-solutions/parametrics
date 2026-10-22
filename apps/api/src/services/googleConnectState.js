import crypto from "node:crypto";

// Google Connect OAuth initiation (S2-33).
//
// 1. POST /connect/start (Bearer auth) issues a random, single-use handoff
//    bound to the authenticated user. It expires after HANDOFF_TTL_MS.
// 2. GET /connect/go?h=<handoff> (top-level navigation) redeems the handoff
//    atomically, mints a random OAuth `state` plus a browser nonce, sets the
//    nonce as an HttpOnly cookie and redirects to Google.
// 3. GET /callback consumes the record atomically: the state AND the browser
//    nonce cookie must match, unexpired, exactly once. The user id comes
//    from the stored record, never from the request.
//
// Only SHA-256 hashes of handoff/state/nonce are stored. The app JWT never
// appears in a URL.

export const CONNECT_STATE_COLLECTION = "google_connect_states";
export const CONNECT_NONCE_COOKIE = "pm_google_connect";
export const HANDOFF_TTL_MS = 60 * 1000;
export const STATE_TTL_MS = 10 * 60 * 1000;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashConnectToken(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function isConnectToken(value) {
  return typeof value === "string" && TOKEN_RE.test(value);
}

function resultValue(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, "value")) return result.value || null;
  return result || null;
}

function asDate(now) {
  return now instanceof Date ? now : new Date(now ?? Date.now());
}

export async function issueConnectHandoff({ collection, userId, redirectUri, now } = {}) {
  const uid = String(userId || "").trim();
  if (!uid) {
    const err = new Error("user_id required");
    err.code = "unauthorized";
    throw err;
  }
  const at = asDate(now);
  const handoff = randomToken();
  await collection.insertOne({
    handoff_hash: hashConnectToken(handoff),
    user_id: uid,
    redirect_uri: String(redirectUri || ""),
    stage: "issued",
    created_at: at,
    handoff_expires_at: new Date(at.getTime() + HANDOFF_TTL_MS),
    expires_at: new Date(at.getTime() + STATE_TTL_MS),
  });
  return { handoff };
}

export async function redeemConnectHandoff({ collection, handoff, now } = {}) {
  if (!isConnectToken(handoff)) return null;
  const at = asDate(now);
  const state = randomToken();
  const nonce = randomToken();
  const doc = resultValue(
    await collection.findOneAndUpdate(
      { handoff_hash: hashConnectToken(handoff), stage: "issued", handoff_expires_at: { $gt: at } },
      {
        $set: {
          stage: "redirected",
          state_hash: hashConnectToken(state),
          nonce_hash: hashConnectToken(nonce),
          redirected_at: at,
        },
        $unset: { handoff_hash: "" },
      },
      { returnDocument: "after", projection: { _id: 0 } }
    )
  );
  if (!doc) return null;
  return { state, nonce, userId: doc.user_id, redirectUri: doc.redirect_uri };
}

async function classifyStateFailure(collection, stateHash, nonceHash, at) {
  try {
    const doc = await collection.findOne({ state_hash: stateHash }, { projection: { _id: 0 } });
    if (!doc) return "state_unknown_or_used";
    if (!(doc.expires_at > at)) return "state_expired";
    if (doc.nonce_hash !== nonceHash) return "browser_mismatch";
    return "state_invalid";
  } catch {
    return "state_invalid";
  }
}

export async function consumeConnectState({ collection, state, nonce, now } = {}) {
  if (!isConnectToken(state)) return { ok: false, reason: "state_invalid" };
  const at = asDate(now);
  const stateHash = hashConnectToken(state);
  if (!isConnectToken(nonce)) {
    return { ok: false, reason: await classifyStateFailure(collection, stateHash, null, at) };
  }
  const nonceHash = hashConnectToken(nonce);
  const doc = resultValue(
    await collection.findOneAndDelete(
      { state_hash: stateHash, nonce_hash: nonceHash, stage: "redirected", expires_at: { $gt: at } },
      { projection: { _id: 0 } }
    )
  );
  if (!doc) return { ok: false, reason: await classifyStateFailure(collection, stateHash, nonceHash, at) };
  return { ok: true, userId: doc.user_id, redirectUri: doc.redirect_uri };
}

// The /connect/go hop must be served on the callback's origin so the nonce
// cookie it sets is sent back on the callback.
export function connectGoUrl(redirectUri, handoff) {
  const ru = new URL(redirectUri);
  if (!ru.pathname.endsWith("/callback")) {
    const err = new Error("GOOGLE_REDIRECT_URI must end with /callback");
    err.code = "config";
    throw err;
  }
  const go = new URL("connect/go", ru);
  go.search = "";
  go.hash = "";
  go.searchParams.set("h", handoff);
  return go.toString();
}

export function buildNonceCookie(nonce, redirectUri, { maxAgeSeconds = STATE_TTL_MS / 1000 } = {}) {
  const ru = new URL(redirectUri);
  const parts = [
    `${CONNECT_NONCE_COOKIE}=${nonce}`,
    `Path=${ru.pathname}`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (ru.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

export function clearNonceCookie(redirectUri) {
  return buildNonceCookie("", redirectUri, { maxAgeSeconds: 0 });
}

export function readNonceCookie(req) {
  const header = String(req?.headers?.cookie || "");
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === CONNECT_NONCE_COOKIE) return part.slice(idx + 1).trim();
  }
  return "";
}
