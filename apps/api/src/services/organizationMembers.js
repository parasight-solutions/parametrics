import { randomUUID } from "node:crypto";

import { col } from "../lib/mongo.js";

const MEMBER_LIST_DEFAULT_LIMIT = 50;
const MEMBER_LIST_MAX_LIMIT = 100;
const ORGANIZATION_MEMBER_ROLES = Object.freeze(["owner", "admin", "manager", "member", "viewer"]);
const ORGANIZATION_MEMBER_STATUSES = Object.freeze(["active", "invited", "disabled"]);
const DIRECT_CREATE_STATUSES = Object.freeze(["active", "disabled"]);
const ORGANIZATION_MEMBER_MANAGEMENT_ROLES = Object.freeze(["owner", "admin"]);
const ADMIN_MANAGEABLE_ROLES = Object.freeze(["manager", "member", "viewer"]);
const ROLE_SORT_ORDER = Object.freeze({
  owner: 0,
  admin: 1,
  manager: 2,
  member: 3,
  viewer: 4,
});
const STATUS_SORT_ORDER = Object.freeze({
  active: 0,
  invited: 1,
  disabled: 2,
});

function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function makeMembershipError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.statusCode = status;
  err.code = code;
  return err;
}

function requireIdentifier(value, name) {
  const clean = cleanStr(value, 200);
  if (!clean) {
    throw makeMembershipError(400, "bad_request", `${name} is required`);
  }
  return clean;
}

async function resolveOrganizationMembersCollection(options = {}) {
  if (options.organizationMembers) return options.organizationMembers;
  if (options.collection) return options.collection;
  if (options.collections?.organizationMembers) return options.collections.organizationMembers;
  if (options.collections?.organization_members) return options.collections.organization_members;
  if (options.db?.collection) return options.db.collection("organization_members");
  return col("organization_members");
}

async function resolveOptionalCollection(name, options = {}) {
  if (options[name]) return options[name];
  if (options.collections?.[name]) return options.collections[name];
  if (options.db?.collection) return options.db.collection(name);
  return col(name);
}

function normalizeListLimit(limit) {
  const n = Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return MEMBER_LIST_DEFAULT_LIMIT;
  return Math.min(n, MEMBER_LIST_MAX_LIMIT);
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanStr(item, 200)).filter(Boolean);
}

function normalizeStringArray(value, field) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw makeMembershipError(400, "bad_request", `${field} must be an array`);
  }
  return [...new Set(value.map((item) => cleanStr(item, 200)).filter(Boolean))];
}

function normalizeRole(value, fallback = "") {
  const role = cleanStr(value || fallback, 80).toLowerCase();
  return ORGANIZATION_MEMBER_ROLES.includes(role) ? role : "";
}

function normalizeStatus(value, fallback = "") {
  const status = cleanStr(value || fallback, 80).toLowerCase();
  return ORGANIZATION_MEMBER_STATUSES.includes(status) ? status : "";
}

function requireRoleValue(value, fallback = "") {
  const role = normalizeRole(value, fallback);
  if (!role) throw makeMembershipError(400, "bad_request", "role is invalid");
  return role;
}

function requireStatusValue(value, fallback = "") {
  const status = normalizeStatus(value, fallback);
  if (!status) throw makeMembershipError(400, "bad_request", "status is invalid");
  return status;
}

function assertCreateStatus(status) {
  if (!DIRECT_CREATE_STATUSES.includes(status)) {
    throw makeMembershipError(400, "bad_request", "status is invalid for direct member create");
  }
}

function isAdminManageableRole(role) {
  return ADMIN_MANAGEABLE_ROLES.includes(normalizeRole(role));
}

function assertRequesterCanManageRole(requesterRole, targetRole, code = "member_role_not_allowed") {
  const requester = normalizeRole(requesterRole);
  const target = normalizeRole(targetRole);

  if (!ORGANIZATION_MEMBER_MANAGEMENT_ROLES.includes(requester)) {
    throw makeMembershipError(
      403,
      "organization_role_required",
      "required organization role is missing",
    );
  }

  if (requester === "admin" && !isAdminManageableRole(target)) {
    throw makeMembershipError(
      403,
      code,
      "member role cannot be managed by requester",
    );
  }
}

async function findRequesterMembership(organizationMembers, { organizationId, userId }) {
  const membership = await organizationMembers.findOne(
    { organization_id: organizationId, user_id: userId, status: "active" },
    { projection: { _id: 0 } },
  );

  const sanitized = sanitizeOrganizationMemberForList(membership);
  if (!sanitized) {
    throw makeMembershipError(
      403,
      "organization_membership_required",
      "active organization membership is required",
    );
  }

  if (!ORGANIZATION_MEMBER_MANAGEMENT_ROLES.includes(sanitized.role)) {
    throw makeMembershipError(
      403,
      "organization_role_required",
      "required organization role is missing",
    );
  }

  return sanitized;
}

async function findTargetMembership(organizationMembers, { organizationId, memberId }) {
  const membership = await organizationMembers.findOne(
    { organization_id: organizationId, id: memberId },
    { projection: { _id: 0 } },
  );
  const sanitized = sanitizeOrganizationMemberForList(membership);

  if (!sanitized) {
    throw makeMembershipError(404, "member_not_found", "member not found");
  }

  return sanitized;
}

function assertAssignmentsAllowedForRole(role, assignedClientIds, assignedLocationIds) {
  const normalizedRole = normalizeRole(role);
  const clientCount = assignedClientIds?.length || 0;
  const locationCount = assignedLocationIds?.length || 0;
  if ((normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "member")
    && (clientCount > 0 || locationCount > 0)) {
    throw makeMembershipError(
      409,
      "assignment_scope_invalid",
      "assignments are not supported for this member role",
    );
  }
}

async function validateAssignmentIds({ organizationId, assignedClientIds = [], assignedLocationIds = [] }, options = {}) {
  if (assignedClientIds.length > 0) {
    const clients = await resolveOptionalCollection("clients", options);
    const count = await clients.countDocuments({
      organization_id: organizationId,
      id: { $in: assignedClientIds },
    });
    if (count !== assignedClientIds.length) {
      throw makeMembershipError(
        409,
        "assignment_scope_invalid",
        "assigned client ids must belong to organization",
      );
    }
  }

  if (assignedLocationIds.length > 0) {
    const locations = await resolveOptionalCollection("locations", options);
    const count = await locations.countDocuments({
      organization_id: organizationId,
      id: { $in: assignedLocationIds },
    });
    if (count !== assignedLocationIds.length) {
      throw makeMembershipError(
        409,
        "assignment_scope_invalid",
        "assigned location ids must belong to organization",
      );
    }
  }
}

async function countActiveOwners(organizationMembers, organizationId) {
  if (typeof organizationMembers.countDocuments === "function") {
    return organizationMembers.countDocuments({
      organization_id: organizationId,
      role: "owner",
      status: "active",
    });
  }

  const rows = await organizationMembers
    .find({
      organization_id: organizationId,
      role: "owner",
      status: "active",
    }, { projection: { _id: 0, id: 1 } })
    .toArray();
  return rows.length;
}

async function assertLastOwnerProtected(organizationMembers, target, next = {}) {
  const nextRole = normalizeRole(next.role, target.role);
  const nextStatus = normalizeStatus(next.status, target.status);
  const currentlyActiveOwner = target.role === "owner" && target.status === "active";
  const remainsActiveOwner = nextRole === "owner" && nextStatus === "active";

  if (!currentlyActiveOwner || remainsActiveOwner) return;

  const activeOwners = await countActiveOwners(organizationMembers, target.organization_id);
  if (activeOwners <= 1) {
    throw makeMembershipError(
      403,
      "last_owner_required",
      "at least one active owner is required",
    );
  }
}

function sameStringArray(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((item, idx) => item === right[idx]);
}

function memberNoOp(current, next) {
  return current.role === next.role
    && current.status === next.status
    && sameStringArray(current.assigned_client_ids, next.assigned_client_ids)
    && sameStringArray(current.assigned_location_ids, next.assigned_location_ids);
}

function assignmentsForRole(role, assignedClientIds = [], assignedLocationIds = []) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "manager" || normalizedRole === "viewer") {
    return {
      assigned_client_ids: assignedClientIds,
      assigned_location_ids: assignedLocationIds,
    };
  }

  return {
    assigned_client_ids: [],
    assigned_location_ids: [],
  };
}

function roleRank(role) {
  const normalized = cleanStr(role, 80).toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROLE_SORT_ORDER, normalized)
    ? ROLE_SORT_ORDER[normalized]
    : 999;
}

function statusRank(status) {
  const normalized = cleanStr(status, 80).toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_SORT_ORDER, normalized)
    ? STATUS_SORT_ORDER[normalized]
    : 999;
}

function timeValue(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function compareMembersForList(a, b) {
  const roleDiff = roleRank(a.role) - roleRank(b.role);
  if (roleDiff !== 0) return roleDiff;

  const statusDiff = statusRank(a.status) - statusRank(b.status);
  if (statusDiff !== 0) return statusDiff;

  const createdDiff = timeValue(a.created_at) - timeValue(b.created_at);
  if (createdDiff !== 0) return createdDiff;

  return cleanStr(a.id, 200).localeCompare(cleanStr(b.id, 200));
}

export function sanitizeOrganizationMemberForList(member) {
  if (!member) return null;

  const invitedByUserId = cleanStr(member.invited_by_user_id, 200);
  const out = {
    id: cleanStr(member.id, 200) || null,
    organization_id: cleanStr(member.organization_id, 200),
    user_id: cleanStr(member.user_id, 200),
    role: cleanStr(member.role, 80).toLowerCase(),
    status: cleanStr(member.status, 80).toLowerCase(),
    assigned_client_ids: cleanStringArray(member.assigned_client_ids),
    assigned_location_ids: cleanStringArray(member.assigned_location_ids),
    created_at: member.created_at || null,
    updated_at: member.updated_at || null,
  };

  if (invitedByUserId) out.invited_by_user_id = invitedByUserId;

  return out;
}

export async function listOrganizationMembers(
  { organizationId, limit } = {},
  options = {},
) {
  const organization_id = requireIdentifier(organizationId, "organizationId");
  const boundedLimit = normalizeListLimit(limit);
  const organizationMembers = await resolveOrganizationMembersCollection(options);
  let rows;

  if (typeof organizationMembers.aggregate === "function") {
    rows = await organizationMembers.aggregate([
      { $match: { organization_id } },
      {
        $addFields: {
          __role_order: {
            $switch: {
              branches: [
                { case: { $eq: ["$role", "owner"] }, then: 0 },
                { case: { $eq: ["$role", "admin"] }, then: 1 },
                { case: { $eq: ["$role", "manager"] }, then: 2 },
                { case: { $eq: ["$role", "member"] }, then: 3 },
                { case: { $eq: ["$role", "viewer"] }, then: 4 },
              ],
              default: 999,
            },
          },
          __status_order: {
            $switch: {
              branches: [
                { case: { $eq: ["$status", "active"] }, then: 0 },
                { case: { $eq: ["$status", "invited"] }, then: 1 },
                { case: { $eq: ["$status", "disabled"] }, then: 2 },
              ],
              default: 999,
            },
          },
        },
      },
      { $sort: { __role_order: 1, __status_order: 1, created_at: 1, id: 1 } },
      { $limit: boundedLimit },
      {
        $project: {
          _id: 0,
          id: 1,
          organization_id: 1,
          user_id: 1,
          role: 1,
          status: 1,
          assigned_client_ids: 1,
          assigned_location_ids: 1,
          invited_by_user_id: 1,
          created_at: 1,
          updated_at: 1,
        },
      },
    ]).toArray();
  } else {
    rows = await organizationMembers
      .find(
        { organization_id },
        {
          projection: {
            _id: 0,
            id: 1,
            organization_id: 1,
            user_id: 1,
            role: 1,
            status: 1,
            assigned_client_ids: 1,
            assigned_location_ids: 1,
            invited_by_user_id: 1,
            created_at: 1,
            updated_at: 1,
          },
        },
      )
      .limit(boundedLimit)
      .toArray();
  }

  return rows
    .map((row) => sanitizeOrganizationMemberForList(row))
    .filter(Boolean)
    .sort(compareMembersForList);
}

export async function ensureOwnerMembershipForOrganization(
  { organizationId, userId } = {},
  options = {},
) {
  const organization_id = requireIdentifier(organizationId, "organizationId");
  const user_id = requireIdentifier(userId, "userId");
  const organizationMembers = await resolveOrganizationMembersCollection(options);
  const filter = { organization_id, user_id };

  const existing = await organizationMembers.findOne(filter, {
    projection: { _id: 0 },
  });

  if (existing) {
    return { membership: existing, created: false };
  }

  const now = options.now || new Date();
  const idFactory = options.idFactory || randomUUID;
  const doc = {
    id: cleanStr(idFactory(), 200) || randomUUID(),
    organization_id,
    user_id,
    role: "owner",
    status: "active",
    assigned_client_ids: [],
    assigned_location_ids: [],
    invited_by_user_id: null,
    created_at: now,
    updated_at: now,
  };

  try {
    const result = await organizationMembers.updateOne(
      filter,
      { $setOnInsert: doc },
      { upsert: true },
    );

    const membership = await organizationMembers.findOne(filter, {
      projection: { _id: 0 },
    });

    return {
      membership: membership || doc,
      created: result.upsertedCount === 1,
    };
  } catch (error) {
    if (error?.code === 11000) {
      const membership = await organizationMembers.findOne(filter, {
        projection: { _id: 0 },
      });
      if (membership) return { membership, created: false };
    }
    throw error;
  }
}

export async function createOrganizationMember(
  {
    organizationId,
    requesterUserId,
    targetUserId,
    role = "viewer",
    status = "active",
    assignedClientIds,
    assignedLocationIds,
  } = {},
  options = {},
) {
  const organization_id = requireIdentifier(organizationId, "organizationId");
  const requester_user_id = requireIdentifier(requesterUserId, "requesterUserId");
  const user_id = requireIdentifier(targetUserId, "userId");
  const requestedRole = requireRoleValue(role, "viewer");
  const requestedStatus = requireStatusValue(status, "active");
  assertCreateStatus(requestedStatus);

  const clientIds = normalizeStringArray(assignedClientIds ?? [], "assigned_client_ids");
  const locationIds = normalizeStringArray(assignedLocationIds ?? [], "assigned_location_ids");
  assertAssignmentsAllowedForRole(requestedRole, clientIds, locationIds);

  const organizationMembers = await resolveOrganizationMembersCollection(options);
  const requesterMembership = await findRequesterMembership(organizationMembers, {
    organizationId: organization_id,
    userId: requester_user_id,
  });
  assertRequesterCanManageRole(requesterMembership.role, requestedRole);

  const existing = await organizationMembers.findOne(
    { organization_id, user_id },
    { projection: { _id: 0 } },
  );

  if (existing) {
    return {
      member: sanitizeOrganizationMemberForList(existing),
      created: false,
      requesterMembership,
    };
  }

  const assignments = assignmentsForRole(requestedRole, clientIds, locationIds);
  await validateAssignmentIds({
    organizationId: organization_id,
    assignedClientIds: assignments.assigned_client_ids,
    assignedLocationIds: assignments.assigned_location_ids,
  }, options);

  const now = options.now || new Date();
  const idFactory = options.idFactory || randomUUID;
  const doc = {
    id: cleanStr(idFactory(), 200) || randomUUID(),
    organization_id,
    user_id,
    role: requestedRole,
    status: requestedStatus,
    assigned_client_ids: assignments.assigned_client_ids,
    assigned_location_ids: assignments.assigned_location_ids,
    invited_by_user_id: null,
    created_at: now,
    updated_at: now,
  };

  try {
    const result = await organizationMembers.updateOne(
      { organization_id, user_id },
      { $setOnInsert: doc },
      { upsert: true },
    );
    const saved = await organizationMembers.findOne(
      { organization_id, user_id },
      { projection: { _id: 0 } },
    );
    return {
      member: sanitizeOrganizationMemberForList(saved || doc),
      created: result.upsertedCount === 1,
      requesterMembership,
    };
  } catch (error) {
    if (error?.code === 11000) {
      const saved = await organizationMembers.findOne(
        { organization_id, user_id },
        { projection: { _id: 0 } },
      );
      if (saved) {
        return {
          member: sanitizeOrganizationMemberForList(saved),
          created: false,
          requesterMembership,
        };
      }
    }
    throw error;
  }
}

export async function updateOrganizationMember(
  { organizationId, requesterUserId, memberId, patch = {} } = {},
  options = {},
) {
  const organization_id = requireIdentifier(organizationId, "organizationId");
  const requester_user_id = requireIdentifier(requesterUserId, "requesterUserId");
  const member_id = requireIdentifier(memberId, "memberId");
  const body = patch || {};
  const allowedPatchKeys = ["role", "status", "assigned_client_ids", "assigned_location_ids"];
  const hasPatch = allowedPatchKeys.some((key) => Object.prototype.hasOwnProperty.call(body, key));
  if (!hasPatch) {
    throw makeMembershipError(400, "bad_request", "at least one member field is required");
  }

  const organizationMembers = await resolveOrganizationMembersCollection(options);
  const requesterMembership = await findRequesterMembership(organizationMembers, {
    organizationId: organization_id,
    userId: requester_user_id,
  });
  const target = await findTargetMembership(organizationMembers, {
    organizationId: organization_id,
    memberId: member_id,
  });
  assertRequesterCanManageRole(requesterMembership.role, target.role);

  const nextRole = Object.prototype.hasOwnProperty.call(body, "role")
    ? requireRoleValue(body.role)
    : target.role;
  const nextStatus = Object.prototype.hasOwnProperty.call(body, "status")
    ? requireStatusValue(body.status)
    : target.status;
  assertRequesterCanManageRole(requesterMembership.role, nextRole);

  const requestedClientIds = normalizeStringArray(body.assigned_client_ids, "assigned_client_ids");
  const requestedLocationIds = normalizeStringArray(body.assigned_location_ids, "assigned_location_ids");
  const nextRoleUsesAssignments = nextRole === "manager" || nextRole === "viewer";
  const baseClientIds = nextRoleUsesAssignments
    ? requestedClientIds === undefined ? target.assigned_client_ids : requestedClientIds
    : requestedClientIds || [];
  const baseLocationIds = nextRoleUsesAssignments
    ? requestedLocationIds === undefined ? target.assigned_location_ids : requestedLocationIds
    : requestedLocationIds || [];
  assertAssignmentsAllowedForRole(nextRole, baseClientIds, baseLocationIds);
  const assignments = assignmentsForRole(nextRole, baseClientIds, baseLocationIds);

  await assertLastOwnerProtected(organizationMembers, target, {
    role: nextRole,
    status: nextStatus,
  });
  await validateAssignmentIds({
    organizationId: organization_id,
    assignedClientIds: assignments.assigned_client_ids,
    assignedLocationIds: assignments.assigned_location_ids,
  }, options);

  const next = {
    ...target,
    role: nextRole,
    status: nextStatus,
    assigned_client_ids: assignments.assigned_client_ids,
    assigned_location_ids: assignments.assigned_location_ids,
  };

  if (memberNoOp(target, next)) {
    return {
      member: target,
      updated: false,
      previous: target,
      requesterMembership,
    };
  }

  const now = options.now || new Date();
  await organizationMembers.updateOne(
    { organization_id, id: member_id },
    {
      $set: {
        role: nextRole,
        status: nextStatus,
        assigned_client_ids: assignments.assigned_client_ids,
        assigned_location_ids: assignments.assigned_location_ids,
        updated_at: now,
      },
    },
  );

  const saved = await findTargetMembership(organizationMembers, {
    organizationId: organization_id,
    memberId: member_id,
  });

  return {
    member: saved,
    updated: true,
    previous: target,
    requesterMembership,
  };
}

export async function disableOrganizationMember(
  { organizationId, requesterUserId, memberId } = {},
  options = {},
) {
  const organization_id = requireIdentifier(organizationId, "organizationId");
  const requester_user_id = requireIdentifier(requesterUserId, "requesterUserId");
  const member_id = requireIdentifier(memberId, "memberId");
  const organizationMembers = await resolveOrganizationMembersCollection(options);
  const requesterMembership = await findRequesterMembership(organizationMembers, {
    organizationId: organization_id,
    userId: requester_user_id,
  });
  const target = await findTargetMembership(organizationMembers, {
    organizationId: organization_id,
    memberId: member_id,
  });
  assertRequesterCanManageRole(requesterMembership.role, target.role);

  if (target.status === "disabled") {
    return {
      member: target,
      disabled: false,
      previous: target,
      requesterMembership,
    };
  }

  await assertLastOwnerProtected(organizationMembers, target, {
    role: target.role,
    status: "disabled",
  });

  const now = options.now || new Date();
  await organizationMembers.updateOne(
    { organization_id, id: member_id },
    {
      $set: {
        status: "disabled",
        updated_at: now,
      },
    },
  );

  const saved = await findTargetMembership(organizationMembers, {
    organizationId: organization_id,
    memberId: member_id,
  });

  return {
    member: saved,
    disabled: true,
    previous: target,
    requesterMembership,
  };
}
