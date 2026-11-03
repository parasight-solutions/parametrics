import crypto from "node:crypto";

import { col } from "../lib/mongo.js";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashSessionToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

export function getSessionCookieName(env = process.env) {
  return String(env.NODE_ENV || "").toLowerCase() === "production"
    ? "__Host-pm_session"
    : "pm_session";
}

export function getSessionCookieOptions(env = process.env) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: String(env.NODE_ENV || "").toLowerCase() === "production",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

export function readSessionToken(req, env = process.env) {
  const cookieName = getSessionCookieName(env);
  const header = String(req?.headers?.cookie || "");

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== cookieName) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }

  return "";
}

export function setSessionCookie(res, rawToken, env = process.env) {
  res.cookie(
    getSessionCookieName(env),
    rawToken,
    getSessionCookieOptions(env),
  );
}

export function clearSessionCookie(res, env = process.env) {
  const { maxAge: _maxAge, ...options } = getSessionCookieOptions(env);
  res.clearCookie(getSessionCookieName(env), options);
}

export function createAuthSessionStore({
  getCollection = () => col("auth_sessions"),
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
} = {}) {
  return {
    async createSession(userId) {
      const rawToken = randomBytes(32).toString("base64url");
      const createdAt = now();
      const collection = await getCollection();

      await collection.insertOne({
        token_hash: hashSessionToken(rawToken),
        user_id: String(userId),
        created_at: createdAt,
        last_seen_at: createdAt,
        expires_at: new Date(createdAt.getTime() + SESSION_TTL_MS),
        revoked_at: null,
      });

      return rawToken;
    },

    async resolveSession(rawToken) {
      if (!rawToken) return null;
      const collection = await getCollection();
      return collection.findOne({
        token_hash: hashSessionToken(rawToken),
        revoked_at: null,
        expires_at: { $gt: now() },
      });
    },

    async revokeSession(rawToken) {
      if (!rawToken) return false;
      const collection = await getCollection();
      const result = await collection.updateOne(
        { token_hash: hashSessionToken(rawToken) },
        { $set: { revoked_at: now() } },
      );
      return result.matchedCount > 0;
    },
  };
}

const defaultStore = createAuthSessionStore();

export const createSession = (...args) => defaultStore.createSession(...args);
export const resolveSession = (...args) => defaultStore.resolveSession(...args);
export const revokeSession = (...args) => defaultStore.revokeSession(...args);
