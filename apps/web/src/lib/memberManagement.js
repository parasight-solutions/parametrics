// apps/web/src/lib/memberManagement.js
// Frontend helpers and API wrappers for direct (user_id-based) organization member management.
// Wraps the existing apps/api routes:
//   GET    /api/v1/orgs/:orgId/members
//   POST   /api/v1/orgs/:orgId/members
//   PATCH  /api/v1/orgs/:orgId/members/:memberId
//   POST   /api/v1/orgs/:orgId/members/:memberId/disable
//
// Email invitation flows are intentionally not implemented yet.
import { api } from "../apiClient";

export const MEMBER_ROLES = Object.freeze(["owner", "admin", "manager", "member", "viewer"]);
export const MEMBER_STATUSES_ALL = Object.freeze(["active", "invited", "disabled"]);
export const MEMBER_CREATE_STATUSES = Object.freeze(["active", "disabled"]);
export const ROLES_WITH_ASSIGNMENTS = Object.freeze(["manager", "viewer"]);

export function parseAssignmentIdsInput(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => String(v ?? "").trim()).filter(Boolean))];
  }
  if (value === undefined || value === null) return [];
  return [
    ...new Set(
      String(value)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

export function formatAssignmentIds(ids) {
  if (!Array.isArray(ids)) return "";
  return ids.filter(Boolean).join(", ");
}

export function roleSupportsAssignments(role) {
  return ROLES_WITH_ASSIGNMENTS.includes(String(role || "").toLowerCase());
}

export function describeBackendError(err) {
  if (!err) return "Unknown error.";
  const code = err.code || err.error?.code || "";
  const message = err.message || err.error?.message || "";
  if (code && message) return `${code}: ${message}`;
  return message || code || "Request failed.";
}

export function formatDate(value) {
  if (!value) return "-";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString();
  } catch {
    return "-";
  }
}

function encodeSegment(value) {
  return encodeURIComponent(String(value ?? ""));
}

export async function listOrganizations() {
  const out = await api("/orgs");
  return Array.isArray(out?.orgs) ? out.orgs : [];
}

export async function listOrgMembers(orgId) {
  const out = await api(`/orgs/${encodeSegment(orgId)}/members`);
  return Array.isArray(out?.members) ? out.members : [];
}

export async function createOrgMember(orgId, payload) {
  return api(`/orgs/${encodeSegment(orgId)}/members`, {
    method: "POST",
    body: payload,
  });
}

export async function updateOrgMember(orgId, memberId, patch) {
  return api(`/orgs/${encodeSegment(orgId)}/members/${encodeSegment(memberId)}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function disableOrgMember(orgId, memberId, reason) {
  const body = reason ? { reason: String(reason) } : undefined;
  return api(`/orgs/${encodeSegment(orgId)}/members/${encodeSegment(memberId)}/disable`, {
    method: "POST",
    body,
  });
}
