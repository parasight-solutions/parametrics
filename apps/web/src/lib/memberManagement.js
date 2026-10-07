// apps/web/src/lib/memberManagement.js
// Frontend helpers and API wrappers for direct (user_id-based) organization member management.
// Wraps the existing apps/api routes:
//   GET    /api/v1/orgs/:orgId/members
//   POST   /api/v1/orgs/:orgId/members
//   PATCH  /api/v1/orgs/:orgId/members/:memberId
//   POST   /api/v1/orgs/:orgId/members/:memberId/disable
//   GET    /api/v1/orgs/:orgId/member-candidates
//
// Email invitation flows are intentionally not implemented yet.
import { api } from "../apiClient";

export const MEMBER_ROLES = Object.freeze(["owner", "admin", "manager", "member", "viewer"]);
export const MEMBER_STATUSES_ALL = Object.freeze(["active", "invited", "disabled"]);
export const MEMBER_CREATE_STATUSES = Object.freeze(["active", "disabled"]);
export const ROLES_WITH_ASSIGNMENTS = Object.freeze(["manager", "viewer"]);

export const MEMBER_CANDIDATE_LIMIT_DEFAULT = 10;
export const MEMBER_CANDIDATE_LIMIT_MAX = 25;
export const MEMBER_CANDIDATE_MIN_SEARCH = 2;

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

export function clampCandidateLimit(limit) {
  const n = Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return MEMBER_CANDIDATE_LIMIT_DEFAULT;
  return Math.min(n, MEMBER_CANDIDATE_LIMIT_MAX);
}

export function buildCandidateQuery(query, limit) {
  const params = new URLSearchParams();
  const term = String(query ?? "").trim();
  if (term) params.set("search", term);
  params.set("limit", String(clampCandidateLimit(limit)));
  return params.toString();
}

// Frontend fallback masking only. The backend already returns `email_masked`;
// this never receives or exposes a raw email in normal flows.
export function maskEmail(email) {
  const value = String(email ?? "").trim();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return "";
  const domain = value.slice(at + 1);
  if (!domain) return "";
  return `${value[0]}***@${domain}`;
}

export function normalizeCandidateRow(row = {}) {
  const userId = String(row?.user_id ?? "").trim();
  const displayName = String(row?.display_name ?? "").trim();
  return {
    user_id: userId,
    display_name:
      displayName || (userId ? `User ${userId.slice(0, 8)}` : "Unknown user"),
    email_masked: row?.email_masked ? String(row.email_masked) : "",
    already_member: Boolean(row?.already_member),
    membership_role: row?.membership_role ? String(row.membership_role).toLowerCase() : "",
  };
}

// Keep every existing member field for backward compatibility and add safe
// top-level display fields derived from the optional nested `user` object.
// Never surfaces a raw email.
export function normalizeMemberRow(row = {}) {
  const user = row && typeof row.user === "object" && row.user ? row.user : null;
  return {
    ...row,
    display_name: user?.display_name ? String(user.display_name) : "",
    email_masked: user?.email_masked ? String(user.email_masked) : "",
  };
}

// ---------------------------------------------------------------------------
// Add-member selection state (S2-31-fix). The target user_id comes ONLY from a
// selected search candidate, or from the explicit advanced manual field. Typed
// search text is never used as a user_id. The backend still validates the id.
// ---------------------------------------------------------------------------

export const initialAddSelection = Object.freeze({
  query: "",
  selectedCandidate: null,
  manualMode: false,
  manualUserId: "",
});

// Editing the search box always drops any previously selected candidate.
export function editCandidateQuery(selection, query) {
  return { ...selection, query: String(query ?? ""), selectedCandidate: null };
}

export function selectCandidateForAdd(selection, candidate) {
  if (!candidate?.user_id) return selection;
  return { ...selection, selectedCandidate: candidate, manualMode: false, manualUserId: "" };
}

export function clearSelectedCandidate(selection) {
  return { ...selection, selectedCandidate: null };
}

export function toggleManualUserIdMode(selection) {
  const manualMode = !selection.manualMode;
  return {
    ...selection,
    manualMode,
    manualUserId: "",
    selectedCandidate: manualMode ? null : selection.selectedCandidate,
  };
}

export function editManualUserId(selection, value) {
  return { ...selection, manualUserId: String(value ?? "") };
}

export function resolveCreateTargetUserId(selection) {
  if (!selection) return "";
  if (selection.manualMode) return String(selection.manualUserId ?? "").trim();
  return String(selection.selectedCandidate?.user_id ?? "").trim();
}

export function canSubmitMemberCreate(selection, { orgId, busy } = {}) {
  if (!orgId || busy || !selection) return false;
  if (!selection.manualMode && selection.selectedCandidate?.already_member) return false;
  return resolveCreateTargetUserId(selection).length > 0;
}

// Build the POST body. Assignment ids are only sent for roles that support them.
export function buildCreateMemberPayload(selection, form = {}) {
  const userId = resolveCreateTargetUserId(selection);
  if (!userId) return null;
  const body = { user_id: userId, role: form.role, status: form.status };
  if (roleSupportsAssignments(form.role)) {
    body.assigned_client_ids = parseAssignmentIdsInput(form.assigned_client_ids_csv);
    body.assigned_location_ids = parseAssignmentIdsInput(form.assigned_location_ids_csv);
  }
  return body;
}

export function memberDisplayLabel(member) {
  return String(member?.display_name ?? "").trim() || "Unnamed user";
}

// Name used in confirmations: display name when known, otherwise the user id.
export function memberConfirmName(member) {
  const displayName = String(member?.display_name ?? "").trim();
  if (displayName) return displayName;
  return String(member?.user_id ?? "").trim() || "this member";
}

export function buildDisableConfirmMessage(member) {
  return `Disable membership for ${memberConfirmName(member)}? This does not delete the user.`;
}

export function buildMemberAddedMessage({ name, role } = {}) {
  const who = String(name ?? "").trim() || "Member";
  const r = String(role ?? "").trim();
  return r ? `${who} was added as ${r}.` : `${who} was added.`;
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
  const rows = Array.isArray(out?.members) ? out.members : [];
  return rows.map((row) => normalizeMemberRow(row));
}

export async function searchMemberCandidates(orgId, query, limit) {
  const qs = buildCandidateQuery(query, limit);
  const out = await api(`/orgs/${encodeSegment(orgId)}/member-candidates?${qs}`);
  const rows = Array.isArray(out?.users) ? out.users : [];
  return rows.map((row) => normalizeCandidateRow(row));
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
