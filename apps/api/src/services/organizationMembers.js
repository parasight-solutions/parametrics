import { randomUUID } from "node:crypto";

import { col } from "../lib/mongo.js";

const MEMBER_LIST_DEFAULT_LIMIT = 50;
const MEMBER_LIST_MAX_LIMIT = 100;
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

function normalizeListLimit(limit) {
  const n = Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return MEMBER_LIST_DEFAULT_LIMIT;
  return Math.min(n, MEMBER_LIST_MAX_LIMIT);
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanStr(item, 200)).filter(Boolean);
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
