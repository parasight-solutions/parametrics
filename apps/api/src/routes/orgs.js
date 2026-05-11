// apps/api/src/routes/orgs.js
import { Router } from "express";
import crypto from "crypto";
import { col } from "../lib/mongo.js";
import { authenticate } from "../middleware/auth.js";
import { getOrCreateDefaultClientForOrganization } from "../services/clients.js";
import { normalizeLocationBinding } from "../services/locationBinding.js";
import { auditSuccess } from "../services/auditLog.js";
import { requireOrganizationRole } from "../services/organizationAccess.js";
import {
  createOrganizationMember,
  disableOrganizationMember,
  ensureOwnerMembershipForOrganization,
  listOrganizationMembers,
  updateOrganizationMember,
} from "../services/organizationMembers.js";

const router = Router();
const ORGANIZATION_MUTATION_ROLES = Object.freeze(["owner", "admin"]);
const ORGANIZATION_MEMBER_LIST_ROLES = Object.freeze(["owner", "admin", "manager"]);

function cleanStr(s, max = 5000) {
  const v = String(s ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function arrOfStrings(v, maxItems = 50, maxLen = 80) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => cleanStr(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function makeSlug(value) {
  const base = cleanStr(value, 200).toLowerCase();
  if (!base) return "";
  return base
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeStatus(value) {
  const v = cleanStr(value, 40).toLowerCase();
  if (v === "archived") return "archived";
  return "active";
}

function makeRouteError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.statusCode = status;
  err.code = code;
  return err;
}

function sendRouteError(res, error) {
  const status = Number(error?.status || error?.statusCode || 500);
  const code = cleanStr(error?.code, 120) || "server_error";
  const message = cleanStr(error?.message, 500) || "server_error";
  return res.status(status).json({ error: { code, message } });
}

async function resolveOrgCollections(options = {}) {
  if (options.collections?.orgs && (options.collections.organizationMembers || options.collections.organization_members)) {
    return {
      orgs: options.collections.orgs,
      organizationMembers: options.collections.organizationMembers || options.collections.organization_members,
    };
  }

  if (options.db?.collection) {
    return {
      orgs: options.db.collection("orgs"),
      organizationMembers: options.db.collection("organization_members"),
    };
  }

  return {
    orgs: await col("orgs"),
    organizationMembers: await col("organization_members"),
  };
}

async function resolveOrgManagementCollections(options = {}) {
  if (options.collections?.orgs && (options.collections.organizationMembers || options.collections.organization_members)) {
    return {
      orgs: options.collections.orgs,
      organizationMembers: options.collections.organizationMembers || options.collections.organization_members,
      clients: options.collections.clients,
      locations: options.collections.locations,
    };
  }

  if (options.db?.collection) {
    return {
      orgs: options.db.collection("orgs"),
      organizationMembers: options.db.collection("organization_members"),
      clients: options.db.collection("clients"),
      locations: options.db.collection("locations"),
    };
  }

  return {
    orgs: await col("orgs"),
    organizationMembers: await col("organization_members"),
    clients: await col("clients"),
    locations: await col("locations"),
  };
}

function dedupeById(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const id = cleanStr(row?.id, 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

export async function listAccessibleOrganizations({ userId } = {}, options = {}) {
  const uid = cleanStr(userId, 200);
  if (!uid) throw makeRouteError(400, "bad_request", "userId is required");

  const { orgs, organizationMembers } = await resolveOrgCollections(options);
  const memberships = await organizationMembers
    .find(
      { user_id: uid, status: "active" },
      { projection: { _id: 0, organization_id: 1 } },
    )
    .toArray();

  const memberOrgIds = [...new Set(
    memberships
      .map((membership) => cleanStr(membership.organization_id, 200))
      .filter(Boolean),
  )];

  const filter = memberOrgIds.length
    ? { $or: [{ user_id: uid }, { id: { $in: memberOrgIds } }] }
    : { user_id: uid };

  const rows = await orgs
    .find(filter, { projection: { _id: 0 } })
    .sort({ updated_at: -1 })
    .limit(50)
    .toArray();

  return dedupeById(rows);
}

export async function requireOrganizationMutationAccess(
  { userId, organizationId } = {},
  options = {},
) {
  const uid = cleanStr(userId, 200);
  const orgId = cleanStr(organizationId, 200);
  if (!uid || !orgId) {
    throw makeRouteError(400, "bad_request", "userId and organizationId are required");
  }

  const { orgs } = await resolveOrgCollections(options);
  const org = await orgs.findOne(
    { id: orgId },
    { projection: { _id: 0 } },
  );

  if (!org) {
    throw makeRouteError(404, "not_found", "org not found");
  }

  const requireRole = options.requireOrganizationRole || requireOrganizationRole;
  const organizationAccessOptions = options.organizationAccessOptions || (
    options.collections?.organizationMembers || options.collections?.organization_members
      ? { collection: options.collections.organizationMembers || options.collections.organization_members }
      : {}
  );
  const membership = await requireRole({
    organizationId: orgId,
    userId: uid,
    allowedRoles: ORGANIZATION_MUTATION_ROLES,
  }, organizationAccessOptions);

  return { org, membership };
}

export async function listOrganizationMembersForUser(
  { userId, organizationId, limit } = {},
  options = {},
) {
  const uid = cleanStr(userId, 200);
  const orgId = cleanStr(organizationId, 200);
  if (!uid || !orgId) {
    throw makeRouteError(400, "bad_request", "userId and organizationId are required");
  }

  const { orgs, organizationMembers } = await resolveOrgCollections(options);
  const requireRole = options.requireOrganizationRole || requireOrganizationRole;
  const membership = await requireRole({
    organizationId: orgId,
    userId: uid,
    allowedRoles: ORGANIZATION_MEMBER_LIST_ROLES,
  }, {
    collection: organizationMembers,
    ...(options.organizationAccessOptions || {}),
  });

  const org = await orgs.findOne(
    { id: orgId },
    { projection: { _id: 0, id: 1 } },
  );

  if (!org) {
    throw makeRouteError(404, "not_found", "org not found");
  }

  const listMembers = options.listOrganizationMembers || listOrganizationMembers;
  const members = await listMembers(
    { organizationId: orgId, limit },
    { collection: organizationMembers },
  );

  return { org, membership, members };
}

async function requireOrgExists(orgs, orgId) {
  const org = await orgs.findOne(
    { id: orgId },
    { projection: { _id: 0, id: 1 } },
  );

  if (!org) {
    throw makeRouteError(404, "not_found", "org not found");
  }

  return org;
}

function memberAuditMetadata(result, extra = {}) {
  const member = result?.member || {};
  const previous = result?.previous || null;
  const out = {
    target_user_id: cleanStr(member.user_id, 200),
    target_role: cleanStr(member.role, 80),
    target_status: cleanStr(member.status, 80),
    requester_role: cleanStr(result?.requesterMembership?.role, 80),
    assigned_client_count: Array.isArray(member.assigned_client_ids) ? member.assigned_client_ids.length : 0,
    assigned_location_count: Array.isArray(member.assigned_location_ids) ? member.assigned_location_ids.length : 0,
    ...extra,
  };

  if (previous) {
    out.previous_role = cleanStr(previous.role, 80);
    out.previous_status = cleanStr(previous.status, 80);
    out.previous_assigned_client_count = Array.isArray(previous.assigned_client_ids)
      ? previous.assigned_client_ids.length
      : 0;
    out.previous_assigned_location_count = Array.isArray(previous.assigned_location_ids)
      ? previous.assigned_location_ids.length
      : 0;
  }

  return out;
}

export async function createOrganizationMemberForUser(
  { userId, organizationId, body = {} } = {},
  options = {},
) {
  const uid = cleanStr(userId, 200);
  const orgId = cleanStr(organizationId, 200);
  if (!uid || !orgId) {
    throw makeRouteError(400, "bad_request", "userId and organizationId are required");
  }

  const collections = await resolveOrgManagementCollections(options);
  const org = await requireOrgExists(collections.orgs, orgId);
  const createMember = options.createOrganizationMember || createOrganizationMember;
  const result = await createMember({
    organizationId: orgId,
    requesterUserId: uid,
    targetUserId: body.user_id,
    role: body.role,
    status: body.status,
    assignedClientIds: body.assigned_client_ids,
    assignedLocationIds: body.assigned_location_ids,
  }, {
    collection: collections.organizationMembers,
    clients: collections.clients,
    locations: collections.locations,
    idFactory: options.memberIdFactory,
    now: options.now,
  });

  return { org, ...result };
}

export async function updateOrganizationMemberForUser(
  { userId, organizationId, memberId, body = {} } = {},
  options = {},
) {
  const uid = cleanStr(userId, 200);
  const orgId = cleanStr(organizationId, 200);
  const targetMemberId = cleanStr(memberId, 200);
  if (!uid || !orgId || !targetMemberId) {
    throw makeRouteError(400, "bad_request", "userId, organizationId, and memberId are required");
  }

  const collections = await resolveOrgManagementCollections(options);
  const org = await requireOrgExists(collections.orgs, orgId);
  const updateMember = options.updateOrganizationMember || updateOrganizationMember;
  const result = await updateMember({
    organizationId: orgId,
    requesterUserId: uid,
    memberId: targetMemberId,
    patch: body,
  }, {
    collection: collections.organizationMembers,
    clients: collections.clients,
    locations: collections.locations,
    now: options.now,
  });

  return { org, ...result };
}

export async function disableOrganizationMemberForUser(
  { userId, organizationId, memberId } = {},
  options = {},
) {
  const uid = cleanStr(userId, 200);
  const orgId = cleanStr(organizationId, 200);
  const targetMemberId = cleanStr(memberId, 200);
  if (!uid || !orgId || !targetMemberId) {
    throw makeRouteError(400, "bad_request", "userId, organizationId, and memberId are required");
  }

  const collections = await resolveOrgManagementCollections(options);
  const org = await requireOrgExists(collections.orgs, orgId);
  const disableMember = options.disableOrganizationMember || disableOrganizationMember;
  const result = await disableMember({
    organizationId: orgId,
    requesterUserId: uid,
    memberId: targetMemberId,
  }, {
    collection: collections.organizationMembers,
    now: options.now,
  });

  return { org, ...result };
}

function buildOrganizationDoc({ userId, body = {}, id, now = new Date() }) {
  const name = cleanStr(body.name, 200);
  if (!name) {
    throw makeRouteError(400, "bad_request", "name required");
  }

  const website = cleanStr(body.website, 300);
  const industry = cleanStr(body.industry, 120);
  const description = cleanStr(body.description, 2000);
  const slug = cleanStr(body.slug, 120) || makeSlug(name);
  const status = normalizeStatus(body.status);
  const onboarding = body.onboarding || {};

  return {
    id,
    user_id: userId,
    owner_user_id: userId,
    name,
    slug,
    status,
    website,
    industry,
    description,

    onboarding: {
      targetAudience: cleanStr(onboarding.targetAudience, 300),
      services: arrOfStrings(onboarding.services, 30, 60),
      keywords: arrOfStrings(onboarding.keywords, 50, 40),
      tone: cleanStr(onboarding.tone, 80),
      offers: cleanStr(onboarding.offers, 300),
      doNotMention: cleanStr(onboarding.doNotMention, 300),
      language: cleanStr(onboarding.language, 20) || "en",
      goals: arrOfStrings(onboarding.goals, 20, 60),
    },

    brand: {
      primaryColor: cleanStr(body.brand?.primaryColor, 32),
      logoUrl: cleanStr(body.brand?.logoUrl, 500),
    },

    created_at: body.created_at ? new Date(body.created_at) : undefined,
    updated_at: now,
  };
}

export async function saveOrganizationForUser(
  { userId, body = {} } = {},
  options = {},
) {
  const uid = cleanStr(userId, 200);
  if (!uid) throw makeRouteError(400, "bad_request", "userId is required");

  const now = options.now || new Date();
  const idFactory = options.idFactory || crypto.randomUUID;
  const id = cleanStr(body.id) || idFactory();
  const doc = buildOrganizationDoc({ userId: uid, body, id, now });
  const { orgs, organizationMembers } = await resolveOrgCollections(options);

  const existing = await orgs.findOne(
    { id },
    { projection: { _id: 0 } },
  );

  if (existing) {
    await requireOrganizationMutationAccess({ userId: uid, organizationId: id }, {
      collections: { orgs, organizationMembers },
      requireOrganizationRole: options.requireOrganizationRole,
      organizationAccessOptions: options.organizationAccessOptions,
    });
  }

  const ownership = existing
    ? {
        user_id: existing.user_id,
        owner_user_id: existing.owner_user_id || existing.user_id || uid,
      }
    : {
        user_id: uid,
        owner_user_id: uid,
      };

  await orgs.updateOne(
    existing ? { id } : { user_id: uid, id },
    {
      $set: {
        ...doc,
        ...ownership,
        created_at: existing?.created_at || now,
      },
    },
    { upsert: true },
  );

  const saved = await orgs.findOne(
    existing ? { id } : { user_id: uid, id },
    { projection: { _id: 0 } },
  );

  let ownerMembership = null;
  let ownerMembershipCreated = false;
  if (!existing) {
    try {
      const ensureOwnerMembership = options.ensureOwnerMembershipForOrganization
        || ensureOwnerMembershipForOrganization;
      const result = await ensureOwnerMembership(
        { organizationId: saved.id, userId: uid },
        {
          collection: organizationMembers,
          idFactory: options.membershipIdFactory,
          now,
        },
      );
      ownerMembership = result.membership;
      ownerMembershipCreated = result.created;
    } catch {
      throw makeRouteError(
        500,
        "organization_membership_create_failed",
        "owner membership could not be created",
      );
    }
  }

  return {
    org: saved,
    ownerMembership,
    ownerMembershipCreated,
  };
}

// list orgs
router.get("/", authenticate, async (req, res) => {
  try {
    const rows = await listAccessibleOrganizations({ userId: req.user.user_id });
    return res.json({ orgs: rows });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

// upsert org
router.post("/", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const body = req.body || {};

  try {
    const result = await saveOrganizationForUser({ userId, body });
    return res.json({ org: result.org });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.get("/:orgId/members", authenticate, async (req, res) => {
  try {
    const result = await listOrganizationMembersForUser({
      userId: req.user.user_id,
      organizationId: req.params.orgId,
      limit: req.query?.limit,
    });
    return res.json({ members: result.members });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.post("/:orgId/members", authenticate, async (req, res) => {
  try {
    const result = await createOrganizationMemberForUser({
      userId: req.user.user_id,
      organizationId: req.params.orgId,
      body: req.body || {},
    });
    await auditSuccess(req, "organization.member.create", {
      target_type: "organization_member",
      target_id: result.member?.id,
      organization_id: req.params.orgId,
      metadata: memberAuditMetadata(result, { created: !!result.created }),
    });
    return res.json({ member: result.member, created: result.created });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.patch("/:orgId/members/:memberId", authenticate, async (req, res) => {
  try {
    const result = await updateOrganizationMemberForUser({
      userId: req.user.user_id,
      organizationId: req.params.orgId,
      memberId: req.params.memberId,
      body: req.body || {},
    });
    await auditSuccess(req, "organization.member.update", {
      target_type: "organization_member",
      target_id: result.member?.id,
      organization_id: req.params.orgId,
      metadata: memberAuditMetadata(result, { updated: !!result.updated }),
    });
    return res.json({ member: result.member, updated: result.updated });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.post("/:orgId/members/:memberId/disable", authenticate, async (req, res) => {
  try {
    const result = await disableOrganizationMemberForUser({
      userId: req.user.user_id,
      organizationId: req.params.orgId,
      memberId: req.params.memberId,
    });
    await auditSuccess(req, "organization.member.disable", {
      target_type: "organization_member",
      target_id: result.member?.id,
      organization_id: req.params.orgId,
      metadata: memberAuditMetadata(result, {
        disabled: !!result.disabled,
        reason: cleanStr(req.body?.reason, 200),
      }),
    });
    return res.json({ member: result.member, disabled: result.disabled });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

// bind location -> organization
// dual-writes:
// - locations.organization_id  (canonical)
// - locations.client_id        (canonical)
// - locations.org_id           (legacy compatibility)
// - location_org_map           (legacy bridge, still kept for now)
router.post("/bind-location", authenticate, async (req, res) => {
  const userId = req.user.user_id;
  const { locationId, orgId } = req.body || {};

  const locId = cleanStr(locationId, 200);
  const oId = cleanStr(orgId, 200);

  if (!locId || !oId) {
    return res.status(400).json({
      error: {
        code: "bad_request",
        message: "locationId and orgId required",
      },
    });
  }

  let org;
  try {
    const result = await requireOrganizationMutationAccess({ userId, organizationId: oId });
    org = result.org;
  } catch (error) {
    return sendRouteError(res, error);
  }

  const locations = await col("locations");
  const existingLocation = await locations.findOne(
    { user_id: userId, id: locId },
    { projection: { _id: 0, id: 1 } }
  );
  if (!existingLocation) {
    return res.status(404).json({
      error: { code: "not_found", message: "location not found" },
    });
  }

  const defaultClient = await getOrCreateDefaultClientForOrganization({
    organizationId: org.id,
    organizationName: org.name,
  });

  const now = new Date();

  await locations.updateOne(
    { user_id: userId, id: locId },
    {
      $set: {
        org_id: org.id,
        organization_id: org.id,
        client_id: defaultClient.id,
        updated_at: now,
      },
    }
  );

  const mapCol = await col("location_org_map");
  await mapCol.updateOne(
    { user_id: userId, location_id: locId },
    {
      $set: {
        user_id: userId,
        location_id: locId,
        org_id: org.id,
        organization_id: org.id,
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true }
  );

  const binding = normalizeLocationBinding({
    locationId: locId,
    organizationId: org.id,
    clientId: defaultClient.id,
  });

  await auditSuccess(req, "location.bind", {
    target_type: "location",
    target_id: locId,
    organization_id: org.id,
    client_id: defaultClient.id,
    location_id: locId,
  });

  return res.json({
    ok: true,
    binding,
  });
});

export default router;
