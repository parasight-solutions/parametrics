import crypto from "crypto";
import { col } from "../lib/mongo.js";

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 30;
const MAX_DEPTH = 3;

const SECRET_KEY_RE = /(?:password|passcode|secret|token|jwt|authorization|auth_code|code|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secrets_json)/i;

function cleanStr(value, max = MAX_STRING_LENGTH) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function getIp(req) {
  const forwarded = cleanStr(req?.headers?.["x-forwarded-for"], 500)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0];

  return (
    forwarded ||
    cleanStr(req?.ip, 200) ||
    cleanStr(req?.socket?.remoteAddress, 200) ||
    null
  );
}

function sanitizeValue(value, depth) {
  if (value === null || value === undefined) return value ?? null;

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "string") return cleanStr(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;

  if (depth >= MAX_DEPTH) return "[truncated]";

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      const safeKey = cleanStr(key, 120);
      if (!safeKey) continue;
      out[safeKey] = SECRET_KEY_RE.test(safeKey)
        ? "[redacted]"
        : sanitizeValue(child, depth + 1);
    }
    return out;
  }

  return cleanStr(value);
}

export function sanitizeAuditMetadata(metadata = {}) {
  const clean = sanitizeValue(metadata, 0);
  if (!clean || typeof clean !== "object" || Array.isArray(clean)) return {};
  return clean;
}

export function getAuditContextFromReq(req) {
  return {
    actor_user_id: cleanStr(req?.user?.user_id || req?.user?.id, 200) || null,
    actor_role: cleanStr(req?.user?.role, 120) || null,
    ip: getIp(req),
    user_agent: cleanStr(req?.headers?.["user-agent"], 500) || null,
  };
}

export async function writeAuditLog({
  req,
  action,
  actor_user_id,
  actor_role,
  target_type = null,
  target_id = null,
  organization_id = null,
  client_id = null,
  location_id = null,
  provider = null,
  status = "success",
  metadata = {},
} = {}) {
  try {
    const ctx = getAuditContextFromReq(req);
    const auditLogs = await col("audit_logs");
    const now = new Date();

    await auditLogs.insertOne({
      id: crypto.randomUUID(),
      action: cleanStr(action, 160) || "unknown",
      actor_user_id: cleanStr(actor_user_id || ctx.actor_user_id, 200) || null,
      actor_role: cleanStr(actor_role || ctx.actor_role, 120) || null,
      ip: cleanStr(ctx.ip, 200) || null,
      user_agent: cleanStr(ctx.user_agent, 500) || null,
      target_type: cleanStr(target_type, 120) || null,
      target_id: cleanStr(target_id, 240) || null,
      organization_id: cleanStr(organization_id, 200) || null,
      client_id: cleanStr(client_id, 200) || null,
      location_id: cleanStr(location_id, 200) || null,
      provider: cleanStr(provider, 80) || null,
      status: ["success", "failure", "queued"].includes(status) ? status : "success",
      metadata: sanitizeAuditMetadata(metadata),
      created_at: now,
    });
  } catch (e) {
    console.error("[audit] write failed", e?.message || e);
  }
}

export async function auditSuccess(req, action, details = {}) {
  return writeAuditLog({ req, action, status: "success", ...details });
}

export async function auditFailure(req, action, details = {}) {
  return writeAuditLog({ req, action, status: "failure", ...details });
}

export async function auditQueued(req, action, details = {}) {
  return writeAuditLog({ req, action, status: "queued", ...details });
}
