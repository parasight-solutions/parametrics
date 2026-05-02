import { col } from "../lib/mongo.js";
import { requireOwnedLocation } from "./ownership.js";

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

export function getOrganizationMembershipScope(membership) {
  const sanitized = sanitizeMembership(membership);
  if (!sanitized) {
    return {
      role: "",
      status: "",
      assigned_client_ids: [],
      assigned_location_ids: [],
    };
  }

  return {
    role: sanitized.role,
    status: sanitized.status,
    assigned_client_ids: sanitized.assigned_client_ids,
    assigned_location_ids: sanitized.assigned_location_ids,
  };
}

export function isMembershipAssignedToLocation(membership, { clientId, locationId } = {}) {
  const scope = getOrganizationMembershipScope(membership);
  const client_id = cleanStr(clientId, 200);
  const location_id = cleanStr(locationId, 200);

  if (scope.role === "owner" || scope.role === "admin") return true;
  if (scope.role !== "manager" && scope.role !== "viewer") return false;

  if (location_id && scope.assigned_location_ids.includes(location_id)) return true;
  if (client_id && scope.assigned_client_ids.includes(client_id)) return true;

  return false;
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

export async function requireOrganizationLocationAccess(
  { organizationId, clientId, locationId, userId, allowedRoles = [] } = {},
  options = {},
) {
  const organization_id = requireIdentifier(organizationId, "organizationId");
  const client_id = requireIdentifier(clientId, "clientId");
  const location_id = requireIdentifier(locationId, "locationId");
  const user_id = requireIdentifier(userId, "userId");

  const membership = await requireOrganizationMembership(
    { organizationId: organization_id, userId: user_id },
    options,
  );

  if (!isOrganizationRoleAllowed(membership.role, allowedRoles)) {
    throw makeAccessError(
      403,
      "organization_role_required",
      "required organization role is missing",
    );
  }

  if (!isMembershipAssignedToLocation(membership, { clientId: client_id, locationId: location_id })) {
    throw makeAccessError(
      403,
      "organization_scope_required",
      "required organization assignment is missing",
    );
  }

  return membership;
}

export async function requireOwnedOrganizationLocationAccess(
  { userId, locationId, provider = "google", allowedRoles = [] } = {},
  options = {},
) {
  const loadOwnedLocation = options.requireOwnedLocation || requireOwnedLocation;
  const location = await loadOwnedLocation(userId, locationId, { provider });
  const membership = await requireOrganizationLocationAccess({
    organizationId: location.organization_id,
    clientId: location.client_id,
    locationId: location.id,
    userId,
    allowedRoles,
  }, options.organizationAccessOptions || options);

  return { location, membership };
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
