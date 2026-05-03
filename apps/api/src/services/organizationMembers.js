import { randomUUID } from "node:crypto";

import { col } from "../lib/mongo.js";

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
