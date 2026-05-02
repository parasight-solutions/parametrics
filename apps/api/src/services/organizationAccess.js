import { col } from "../lib/mongo.js";

export const ORGANIZATION_MEMBER_STATUSES = Object.freeze([
  "active",
  "invited",
  "disabled",
]);

export const ORGANIZATION_MEMBER_ROLES = Object.freeze([
  "owner",
  "admin",
  "manager",
  "member",
  "viewer",
]);

const MEMBERSHIP_PROJECTION = Object.freeze({
  _id: 0,
  id: 1,
  organization_id: 1,
  user_id: 1,
  role: 1,
  status: 1,
  assigned_client_ids: 1,
  assigned_location_ids: 1,
  created_at: 1,
  updated_at: 1,
});

function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function makeAccessError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.statusCode = status;
  err.code = code;
  return err;
}

function requireIdentifier(value, name) {
  const clean = cleanStr(value, 200);
  if (!clean) {
    throw makeAccessError(400, "bad_request", `${name} is required`);
  }
  return clean;
}

function normalizeAllowedRoles(allowedRoles = []) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return roles
    .map((role) => normalizeOrganizationRole(role))
    .filter(Boolean);
}

function sanitizeMembership(doc) {
  if (!doc) return null;

  return {
    id: cleanStr(doc.id, 200) || null,
    organization_id: cleanStr(doc.organization_id, 200),
    user_id: cleanStr(doc.user_id, 200),
    role: normalizeOrganizationRole(doc.role),
    status: normalizeOrganizationMemberStatus(doc.status),
    assigned_client_ids: Array.isArray(doc.assigned_client_ids)
      ? doc.assigned_client_ids.map((id) => cleanStr(id, 200)).filter(Boolean)
      : [],
    assigned_location_ids: Array.isArray(doc.assigned_location_ids)
      ? doc.assigned_location_ids.map((id) => cleanStr(id, 200)).filter(Boolean)
      : [],
    created_at: doc.created_at || null,
    updated_at: doc.updated_at || null,
  };
}

async function resolveOrganizationMembersCollection(options = {}) {
  if (options.organizationMembers) return options.organizationMembers;
  if (options.collection) return options.collection;
  if (options.collections?.organizationMembers) return options.collections.organizationMembers;
  if (options.collections?.organization_members) return options.collections.organization_members;
  if (options.db?.collection) return options.db.collection("organization_members");
  return col("organization_members");
}

export function normalizeOrganizationMemberStatus(status) {
  const normalized = cleanStr(status, 80).toLowerCase();
  return ORGANIZATION_MEMBER_STATUSES.includes(normalized) ? normalized : "";
}

export function normalizeOrganizationRole(role) {
  const normalized = cleanStr(role, 80).toLowerCase();
  return ORGANIZATION_MEMBER_ROLES.includes(normalized) ? normalized : "";
}

export function isOrganizationRoleAllowed(role, allowedRoles = []) {
  const normalizedRole = normalizeOrganizationRole(role);
  if (!normalizedRole) return false;
  const normalizedAllowed = normalizeAllowedRoles(allowedRoles);
  if (normalizedAllowed.length === 0) return false;
  return normalizedAllowed.includes(normalizedRole);
}

export async function getOrganizationMembership(
  { organizationId, userId, status = "active" } = {},
  options = {},
) {
  const organization_id = requireIdentifier(organizationId, "organizationId");
  const user_id = requireIdentifier(userId, "userId");
  const normalizedStatus = status === null ? "" : normalizeOrganizationMemberStatus(status);

  if (status !== null && !normalizedStatus) {
    throw makeAccessError(400, "bad_request", "membership status is invalid");
  }

  const organizationMembers = await resolveOrganizationMembersCollection(options);
  const filter = { organization_id, user_id };
  if (normalizedStatus) filter.status = normalizedStatus;

  const membership = await organizationMembers.findOne(filter, {
    projection: MEMBERSHIP_PROJECTION,
  });

  return sanitizeMembership(membership);
}

export async function hasActiveOrganizationMembership(params = {}, options = {}) {
  const membership = await getOrganizationMembership(
    { ...params, status: "active" },
    options,
  );
  return !!membership;
}

export async function requireOrganizationMembership(params = {}, options = {}) {
  const membership = await getOrganizationMembership(
    { ...params, status: "active" },
    options,
  );

  if (!membership) {
    throw makeAccessError(
      403,
      "organization_membership_required",
      "active organization membership is required",
    );
  }

  return membership;
}

export async function requireOrganizationRole(
  { organizationId, userId, allowedRoles = [] } = {},
  options = {},
) {
  const membership = await requireOrganizationMembership(
    { organizationId, userId },
    options,
  );

  if (!isOrganizationRoleAllowed(membership.role, allowedRoles)) {
    throw makeAccessError(
      403,
      "organization_role_required",
      "required organization role is missing",
    );
  }

  return membership;
}
