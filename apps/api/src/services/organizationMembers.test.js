import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMemberCandidateQuery,
  buildUserPublicProfile,
  createOrganizationMember,
  deriveUserDisplayName,
  disableOrganizationMember,
  ensureOwnerMembershipForOrganization,
  isActiveUserAccount,
  listOrganizationMembers,
  maskEmail,
  normalizeCandidateLimit,
  sanitizeMemberCandidate,
  sanitizeOrganizationMemberForList,
  searchMemberCandidates,
  updateOrganizationMember,
} from "./organizationMembers.js";

function matches(filter = {}, row = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && Array.isArray(value.$in)) {
      return value.$in.includes(row[key]);
    }
    return row[key] === value;
  });
}

function makeCollection(rows = []) {
  const collection = {
    rows,
    lastFind: null,
    lastLimit: null,
    find(filter, options) {
      this.lastFind = { filter, options };
      const matched = rows.filter((row) => matches(filter, row));
      return {
        limit: (limit) => {
          this.lastLimit = limit;
          return {
            async toArray() {
              return matched.slice(0, limit).map((row) => structuredClone(row));
            },
          };
        },
      };
    },
    async findOne(filter) {
      const row = rows.find((item) => matches(filter, item));
      return row ? structuredClone(row) : null;
    },
    async countDocuments(filter) {
      return rows.filter((row) => matches(filter, row)).length;
    },
    async updateOne(filter, update, options = {}) {
      const idx = rows.findIndex((item) => matches(filter, item));
      if (idx >= 0) {
        rows[idx] = {
          ...rows[idx],
          ...(update.$set || {}),
        };
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      }

      if (!options.upsert) {
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }

      rows.push({
        ...filter,
        ...(update.$setOnInsert || {}),
        ...(update.$set || {}),
      });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    },
  };
  return collection;
}

function makeAggregateCollection(rows = []) {
  return {
    rows,
    lastPipeline: null,
    aggregate(pipeline) {
      this.lastPipeline = pipeline;
      const matchStage = pipeline.find((stage) => stage.$match);
      const limitStage = pipeline.find((stage) => stage.$limit);
      const matched = rows.filter((row) => matches(matchStage?.$match || {}, row));
      return {
        async toArray() {
          return matched.slice(0, limitStage?.$limit || matched.length).map((row) => structuredClone(row));
        },
      };
    },
    async findOne(filter) {
      const row = rows.find((item) => matches(filter, item));
      return row ? structuredClone(row) : null;
    },
    async countDocuments(filter) {
      return rows.filter((row) => matches(filter, row)).length;
    },
    async updateOne(filter, update, options = {}) {
      const idx = rows.findIndex((item) => matches(filter, item));
      if (idx >= 0) {
        rows[idx] = {
          ...rows[idx],
          ...(update.$set || {}),
        };
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      }

      if (!options.upsert) {
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }

      rows.push({
        ...filter,
        ...(update.$setOnInsert || {}),
        ...(update.$set || {}),
      });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    },
  };
}

test("ensureOwnerMembershipForOrganization requires explicit organizationId", async () => {
  await assert.rejects(
    () => ensureOwnerMembershipForOrganization(
      { organizationId: "", userId: "user_1" },
      { collection: makeCollection([]) },
    ),
    (err) => err.status === 400 && err.code === "bad_request",
  );
});

test("ensureOwnerMembershipForOrganization requires explicit userId", async () => {
  await assert.rejects(
    () => ensureOwnerMembershipForOrganization(
      { organizationId: "org_1", userId: "" },
      { collection: makeCollection([]) },
    ),
    (err) => err.status === 400 && err.code === "bad_request",
  );
});

test("ensureOwnerMembershipForOrganization inserts active owner membership", async () => {
  const now = new Date("2026-05-03T10:00:00.000Z");
  const collection = makeCollection([]);

  const result = await ensureOwnerMembershipForOrganization(
    { organizationId: "org_1", userId: "user_1" },
    {
      collection,
      idFactory: () => "member_1",
      now,
    },
  );

  assert.equal(result.created, true);
  assert.deepEqual(result.membership, {
    id: "member_1",
    organization_id: "org_1",
    user_id: "user_1",
    role: "owner",
    status: "active",
    assigned_client_ids: [],
    assigned_location_ids: [],
    invited_by_user_id: null,
    created_at: now,
    updated_at: now,
  });
  assert.equal(collection.rows.length, 1);
});

test("ensureOwnerMembershipForOrganization preserves existing role and status", async () => {
  const existing = {
    id: "member_existing",
    organization_id: "org_1",
    user_id: "user_1",
    role: "viewer",
    status: "disabled",
    created_at: new Date("2026-05-01T10:00:00.000Z"),
    updated_at: new Date("2026-05-01T10:00:00.000Z"),
  };
  const collection = makeCollection([existing]);

  const result = await ensureOwnerMembershipForOrganization(
    { organizationId: "org_1", userId: "user_1" },
    {
      collection,
      idFactory: () => "member_new",
      now: new Date("2026-05-03T10:00:00.000Z"),
    },
  );

  assert.equal(result.created, false);
  assert.deepEqual(result.membership, existing);
  assert.equal(collection.rows.length, 1);
  assert.deepEqual(collection.rows[0], existing);
});

test("sanitizeOrganizationMemberForList omits unsafe and raw fields", () => {
  const member = sanitizeOrganizationMemberForList({
    _id: "mongo_id",
    id: "member_1",
    organization_id: "org_1",
    user_id: "user_1",
    role: " OWNER ",
    status: " ACTIVE ",
    assigned_client_ids: ["client_1", "", null],
    assigned_location_ids: ["loc_1", "  loc_2  "],
    invited_by_user_id: " inviter_1 ",
    email: "owner@example.com",
    password: "secret",
    token: "token",
    oauth_payload: { raw: true },
    created_at: new Date("2026-05-01T10:00:00.000Z"),
    updated_at: new Date("2026-05-02T10:00:00.000Z"),
  });

  assert.deepEqual(Object.keys(member), [
    "id",
    "organization_id",
    "user_id",
    "role",
    "status",
    "assigned_client_ids",
    "assigned_location_ids",
    "created_at",
    "updated_at",
    "invited_by_user_id",
  ]);
  assert.equal(member.role, "owner");
  assert.equal(member.status, "active");
  assert.deepEqual(member.assigned_client_ids, ["client_1"]);
  assert.deepEqual(member.assigned_location_ids, ["loc_1", "loc_2"]);
  assert.equal(Object.prototype.hasOwnProperty.call(member, "_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(member, "email"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(member, "password"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(member, "token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(member, "oauth_payload"), false);
});

test("listOrganizationMembers requires explicit organizationId", async () => {
  await assert.rejects(
    () => listOrganizationMembers(
      { organizationId: "", limit: 50 },
      { collection: makeCollection([]) },
    ),
    (err) => err.status === 400 && err.code === "bad_request",
  );
});

test("listOrganizationMembers bounds limit and queries explicit organization_id", async () => {
  const collection = makeCollection([
    { id: "member_1", organization_id: "org_1", user_id: "user_1", role: "owner", status: "active" },
    { id: "member_2", organization_id: "org_2", user_id: "user_2", role: "owner", status: "active" },
  ]);

  const rows = await listOrganizationMembers(
    { organizationId: "org_1", limit: 500 },
    { collection },
  );

  assert.deepEqual(collection.lastFind.filter, { organization_id: "org_1" });
  assert.equal(collection.lastFind.options.projection._id, 0);
  assert.equal(collection.lastFind.options.projection.email, undefined);
  assert.equal(collection.lastLimit, 100);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "member_1");
});

test("listOrganizationMembers uses default limit", async () => {
  const collection = makeCollection([]);

  await listOrganizationMembers(
    { organizationId: "org_1" },
    { collection },
  );

  assert.equal(collection.lastLimit, 50);
});

test("listOrganizationMembers sorts by role status created_at and id", async () => {
  const collection = makeCollection([
    {
      id: "viewer_old",
      organization_id: "org_1",
      user_id: "user_viewer",
      role: "viewer",
      status: "active",
      created_at: new Date("2026-05-01T10:00:00.000Z"),
    },
    {
      id: "admin_invited",
      organization_id: "org_1",
      user_id: "user_admin_invited",
      role: "admin",
      status: "invited",
      created_at: new Date("2026-05-01T10:00:00.000Z"),
    },
    {
      id: "owner_new",
      organization_id: "org_1",
      user_id: "user_owner_new",
      role: "owner",
      status: "active",
      created_at: new Date("2026-05-03T10:00:00.000Z"),
    },
    {
      id: "owner_old",
      organization_id: "org_1",
      user_id: "user_owner_old",
      role: "owner",
      status: "active",
      created_at: new Date("2026-05-01T10:00:00.000Z"),
    },
    {
      id: "manager_disabled",
      organization_id: "org_1",
      user_id: "user_manager_disabled",
      role: "manager",
      status: "disabled",
      created_at: new Date("2026-05-01T10:00:00.000Z"),
    },
    {
      id: "member_active",
      organization_id: "org_1",
      user_id: "user_member",
      role: "member",
      status: "active",
      created_at: new Date("2026-05-01T10:00:00.000Z"),
    },
  ]);

  const rows = await listOrganizationMembers(
    { organizationId: "org_1", limit: 50 },
    { collection },
  );

  assert.deepEqual(rows.map((row) => row.id), [
    "owner_old",
    "owner_new",
    "admin_invited",
    "manager_disabled",
    "member_active",
    "viewer_old",
  ]);
});

test("listOrganizationMembers aggregation path sorts before limiting for Mongo collections", async () => {
  const collection = makeAggregateCollection([
    { id: "viewer_1", organization_id: "org_1", user_id: "viewer", role: "viewer", status: "active" },
    { id: "owner_1", organization_id: "org_1", user_id: "owner", role: "owner", status: "active" },
  ]);

  await listOrganizationMembers(
    { organizationId: "org_1", limit: 2 },
    { collection },
  );

  assert.deepEqual(collection.lastPipeline.map((stage) => Object.keys(stage)[0]), [
    "$match",
    "$addFields",
    "$sort",
    "$limit",
    "$project",
  ]);
  assert.deepEqual(collection.lastPipeline[0].$match, { organization_id: "org_1" });
  assert.equal(collection.lastPipeline[3].$limit, 2);
});

test("owner creates owner admin manager member and viewer memberships", async () => {
  for (const role of ["owner", "admin", "manager", "member", "viewer"]) {
    const now = new Date("2026-05-03T10:00:00.000Z");
    const collection = makeCollection([
      { id: "requester", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active" },
    ]);
    const clients = makeCollection([{ id: "client_1", organization_id: "org_1" }]);
    const locations = makeCollection([{ id: "loc_1", organization_id: "org_1" }]);
    const scopedRole = role === "manager" || role === "viewer";

    const result = await createOrganizationMember(
      {
        organizationId: "org_1",
        requesterUserId: "owner_user",
        targetUserId: `target_${role}`,
        role,
        assignedClientIds: scopedRole ? ["client_1"] : [],
        assignedLocationIds: scopedRole ? ["loc_1"] : [],
      },
      {
        collection,
        clients,
        locations,
        idFactory: () => `member_${role}`,
        now,
      },
    );

    assert.equal(result.created, true);
    assert.equal(result.member.id, `member_${role}`);
    assert.equal(result.member.role, role);
    assert.equal(result.member.status, "active");
    assert.deepEqual(result.member.assigned_client_ids, scopedRole ? ["client_1"] : []);
    assert.deepEqual(result.member.assigned_location_ids, scopedRole ? ["loc_1"] : []);
    assert.equal(Object.prototype.hasOwnProperty.call(result.member, "_id"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.member, "email"), false);
  }
});

test("admin creates manager member and viewer but cannot create owner or admin", async () => {
  for (const role of ["manager", "member", "viewer"]) {
    const collection = makeCollection([
      { id: "requester", organization_id: "org_1", user_id: "admin_user", role: "admin", status: "active" },
    ]);
    const result = await createOrganizationMember(
      {
        organizationId: "org_1",
        requesterUserId: "admin_user",
        targetUserId: `target_${role}`,
        role,
      },
      {
        collection,
        idFactory: () => `member_${role}`,
        now: new Date("2026-05-03T10:00:00.000Z"),
      },
    );

    assert.equal(result.created, true);
    assert.equal(result.member.role, role);
  }

  for (const role of ["owner", "admin"]) {
    const collection = makeCollection([
      { id: "requester", organization_id: "org_1", user_id: "admin_user", role: "admin", status: "active" },
    ]);
    await assert.rejects(
      () => createOrganizationMember(
        {
          organizationId: "org_1",
          requesterUserId: "admin_user",
          targetUserId: `target_${role}`,
          role,
        },
        { collection },
      ),
      (err) => err.status === 403 && err.code === "member_role_not_allowed",
    );
  }
});

test("manager viewer member invited disabled and missing requesters cannot create members", async () => {
  for (const role of ["manager", "viewer", "member"]) {
    const collection = makeCollection([
      { id: "requester", organization_id: "org_1", user_id: "requester", role, status: "active" },
    ]);
    await assert.rejects(
      () => createOrganizationMember(
        {
          organizationId: "org_1",
          requesterUserId: "requester",
          targetUserId: "target",
          role: "viewer",
        },
        { collection },
      ),
      (err) => err.status === 403 && err.code === "organization_role_required",
    );
  }

  for (const status of ["invited", "disabled"]) {
    const collection = makeCollection([
      { id: "requester", organization_id: "org_1", user_id: "requester", role: "owner", status },
    ]);
    await assert.rejects(
      () => createOrganizationMember(
        {
          organizationId: "org_1",
          requesterUserId: "requester",
          targetUserId: "target",
          role: "viewer",
        },
        { collection },
      ),
      (err) => err.status === 403 && err.code === "organization_membership_required",
    );
  }

  await assert.rejects(
    () => createOrganizationMember(
      {
        organizationId: "org_1",
        requesterUserId: "missing",
        targetUserId: "target",
        role: "viewer",
      },
      { collection: makeCollection([]) },
    ),
    (err) => err.status === 403 && err.code === "organization_membership_required",
  );
});

test("duplicate create is idempotent and does not downgrade existing membership", async () => {
  const existing = {
    _id: "mongo_id",
    id: "existing_owner",
    organization_id: "org_1",
    user_id: "target",
    role: "owner",
    status: "active",
    email: "hidden@example.com",
    token: "secret",
    assigned_client_ids: [],
    assigned_location_ids: [],
  };
  const collection = makeCollection([
    { id: "requester", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active" },
    existing,
  ]);

  const result = await createOrganizationMember(
    {
      organizationId: "org_1",
      requesterUserId: "owner_user",
      targetUserId: "target",
      role: "viewer",
      status: "disabled",
    },
    { collection, idFactory: () => "new_member" },
  );

  assert.equal(result.created, false);
  assert.equal(result.member.id, "existing_owner");
  assert.equal(result.member.role, "owner");
  assert.equal(result.member.status, "active");
  assert.equal(Object.prototype.hasOwnProperty.call(result.member, "_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.member, "email"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.member, "token"), false);
  assert.equal(collection.rows.length, 2);
});

test("owner updates target role status and assignments", async () => {
  const now = new Date("2026-05-03T11:00:00.000Z");
  const collection = makeCollection([
    { id: "requester", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active" },
    { id: "target", organization_id: "org_1", user_id: "target_user", role: "member", status: "active", assigned_client_ids: [], assigned_location_ids: [] },
  ]);
  const clients = makeCollection([{ id: "client_1", organization_id: "org_1" }]);
  const locations = makeCollection([{ id: "loc_1", organization_id: "org_1" }]);

  const result = await updateOrganizationMember(
    {
      organizationId: "org_1",
      requesterUserId: "owner_user",
      memberId: "target",
      patch: {
        role: "manager",
        status: "disabled",
        assigned_client_ids: ["client_1"],
        assigned_location_ids: ["loc_1"],
      },
    },
    { collection, clients, locations, now },
  );

  assert.equal(result.updated, true);
  assert.equal(result.member.role, "manager");
  assert.equal(result.member.status, "disabled");
  assert.deepEqual(result.member.assigned_client_ids, ["client_1"]);
  assert.deepEqual(result.member.assigned_location_ids, ["loc_1"]);
  assert.equal(collection.rows.find((row) => row.id === "target").updated_at, now);
});

test("admin updates manager member and viewer only", async () => {
  for (const role of ["manager", "member", "viewer"]) {
    const collection = makeCollection([
      { id: "requester", organization_id: "org_1", user_id: "admin_user", role: "admin", status: "active" },
      { id: "target", organization_id: "org_1", user_id: "target_user", role, status: "active", assigned_client_ids: [], assigned_location_ids: [] },
    ]);
    const result = await updateOrganizationMember(
      {
        organizationId: "org_1",
        requesterUserId: "admin_user",
        memberId: "target",
        patch: { status: "disabled" },
      },
      { collection, now: new Date("2026-05-03T11:00:00.000Z") },
    );

    assert.equal(result.updated, true);
    assert.equal(result.member.status, "disabled");
  }

  for (const role of ["owner", "admin"]) {
    const collection = makeCollection([
      { id: "requester", organization_id: "org_1", user_id: "admin_user", role: "admin", status: "active" },
      { id: "target", organization_id: "org_1", user_id: "target_user", role, status: "active", assigned_client_ids: [], assigned_location_ids: [] },
    ]);
    await assert.rejects(
      () => updateOrganizationMember(
        {
          organizationId: "org_1",
          requesterUserId: "admin_user",
          memberId: "target",
          patch: { status: "disabled" },
        },
        { collection },
      ),
      (err) => err.status === 403 && err.code === "member_role_not_allowed",
    );
  }

  const collection = makeCollection([
    { id: "requester", organization_id: "org_1", user_id: "admin_user", role: "admin", status: "active" },
    { id: "target", organization_id: "org_1", user_id: "target_user", role: "manager", status: "active", assigned_client_ids: [], assigned_location_ids: [] },
  ]);
  await assert.rejects(
    () => updateOrganizationMember(
      {
        organizationId: "org_1",
        requesterUserId: "admin_user",
        memberId: "target",
        patch: { role: "admin" },
      },
      { collection },
    ),
    (err) => err.status === 403 && err.code === "member_role_not_allowed",
  );
});

test("last active owner cannot be downgraded or disabled", async () => {
  const collection = makeCollection([
    { id: "owner", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active", assigned_client_ids: [], assigned_location_ids: [] },
  ]);

  await assert.rejects(
    () => updateOrganizationMember(
      {
        organizationId: "org_1",
        requesterUserId: "owner_user",
        memberId: "owner",
        patch: { role: "admin" },
      },
      { collection },
    ),
    (err) => err.status === 403 && err.code === "last_owner_required",
  );

  await assert.rejects(
    () => disableOrganizationMember(
      {
        organizationId: "org_1",
        requesterUserId: "owner_user",
        memberId: "owner",
      },
      { collection },
    ),
    (err) => err.status === 403 && err.code === "last_owner_required",
  );
});

test("disabling already disabled membership is a no-op", async () => {
  const collection = makeCollection([
    { id: "requester", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active" },
    { id: "target", organization_id: "org_1", user_id: "target_user", role: "viewer", status: "disabled", assigned_client_ids: [], assigned_location_ids: [] },
  ]);

  const result = await disableOrganizationMember(
    {
      organizationId: "org_1",
      requesterUserId: "owner_user",
      memberId: "target",
    },
    { collection },
  );

  assert.equal(result.disabled, false);
  assert.equal(result.member.status, "disabled");
});

test("assignment validation allows canonical ids and rejects invalid ids", async () => {
  const collection = makeCollection([
    { id: "requester", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active" },
  ]);
  const clients = makeCollection([{ id: "client_1", organization_id: "org_1" }]);
  const locations = makeCollection([{ id: "loc_1", organization_id: "org_1" }]);

  const result = await createOrganizationMember(
    {
      organizationId: "org_1",
      requesterUserId: "owner_user",
      targetUserId: "target_valid",
      role: "viewer",
      assignedClientIds: ["client_1"],
      assignedLocationIds: ["loc_1"],
    },
    {
      collection,
      clients,
      locations,
      idFactory: () => "target_valid",
      now: new Date("2026-05-03T11:00:00.000Z"),
    },
  );
  assert.equal(result.created, true);

  await assert.rejects(
    () => createOrganizationMember(
      {
        organizationId: "org_1",
        requesterUserId: "owner_user",
        targetUserId: "target_invalid",
        role: "viewer",
        assignedClientIds: ["client_missing"],
      },
      {
        collection,
        clients,
        locations,
        idFactory: () => "target_invalid",
      },
    ),
    (err) => err.status === 409 && err.code === "assignment_scope_invalid",
  );

  await assert.rejects(
    () => updateOrganizationMember(
      {
        organizationId: "org_1",
        requesterUserId: "owner_user",
        memberId: "target_valid",
        patch: { assigned_location_ids: ["loc_missing"] },
      },
      { collection, clients, locations },
    ),
    (err) => err.status === 409 && err.code === "assignment_scope_invalid",
  );
});

test("identical patch returns no-op metadata", async () => {
  const collection = makeCollection([
    { id: "requester", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active" },
    { id: "target", organization_id: "org_1", user_id: "target_user", role: "viewer", status: "active", assigned_client_ids: ["client_1"], assigned_location_ids: [] },
  ]);
  const clients = makeCollection([{ id: "client_1", organization_id: "org_1" }]);
  const locations = makeCollection([]);

  const result = await updateOrganizationMember(
    {
      organizationId: "org_1",
      requesterUserId: "owner_user",
      memberId: "target",
      patch: { role: "viewer", status: "active", assigned_client_ids: ["client_1"], assigned_location_ids: [] },
    },
    { collection, clients, locations },
  );

  assert.equal(result.updated, false);
  assert.equal(collection.rows.find((row) => row.id === "target").updated_at, undefined);
});

// ---------------------------------------------------------------------------
// S2-31: safe user lookup helpers + searchMemberCandidates.
// ---------------------------------------------------------------------------

// Users fake returning all seeded rows regardless of the rich Mongo query, so
// the service's JS-level filter/sanitize logic is exercised deterministically.
function makeUsersFake(rows = []) {
  return {
    rows,
    find() {
      return {
        limit() {
          return {
            async toArray() {
              return rows.map((row) => structuredClone(row));
            },
          };
        },
      };
    },
    async findOne() {
      return rows[0] ? structuredClone(rows[0]) : null;
    },
  };
}

test("maskEmail masks the local part and rejects malformed emails", () => {
  assert.equal(maskEmail("john@company.com"), "j***@company.com");
  assert.equal(maskEmail("  Jane@Example.com  "), "J***@Example.com");
  assert.equal(maskEmail(""), null);
  assert.equal(maskEmail(null), null);
  assert.equal(maskEmail("not-an-email"), null);
  assert.equal(maskEmail("@nolocal.com"), null);
  assert.equal(maskEmail("nodomain@"), null);
});

test("deriveUserDisplayName prefers full_name then name then short id, never the email", () => {
  assert.equal(deriveUserDisplayName({ full_name: "Jane Doe", email: "jane@x.com" }), "Jane Doe");
  assert.equal(deriveUserDisplayName({ name: "Joe", email: "joe@x.com" }), "Joe");
  assert.equal(deriveUserDisplayName({ email: "john@company.com" }), "Unknown user");
  assert.equal(deriveUserDisplayName({ id: "abcdef12345", email: "john@company.com" }), "User abcdef12");
  assert.equal(deriveUserDisplayName({ id: "abcdefgh1234" }), "User abcdefgh");
  assert.equal(deriveUserDisplayName({}), "Unknown user");
});

test("buildUserPublicProfile for a nameless user cannot be combined to rebuild the raw email", () => {
  const profile = buildUserPublicProfile({ id: "u_nameless_1", email: "john.smith@company.com" });
  assert.deepEqual(profile, { display_name: "User u_namele", email_masked: "j***@company.com" });
  assert.equal(JSON.stringify(profile).includes("john.smith"), false);
});

test("buildUserPublicProfile returns only safe display fields", () => {
  assert.equal(buildUserPublicProfile(null), null);
  assert.equal(buildUserPublicProfile({ email: "x@y.com" }), null);
  assert.deepEqual(
    buildUserPublicProfile({ id: "u1", full_name: "Jane Doe", email: "jane@company.com", password: "secret" }),
    { display_name: "Jane Doe", email_masked: "j***@company.com" },
  );
});

test("normalizeCandidateLimit defaults and clamps", () => {
  assert.equal(normalizeCandidateLimit(undefined), 10);
  assert.equal(normalizeCandidateLimit(0), 10);
  assert.equal(normalizeCandidateLimit(-3), 10);
  assert.equal(normalizeCandidateLimit(5), 5);
  assert.equal(normalizeCandidateLimit(999), 25);
});

test("buildMemberCandidateQuery excludes disabled/deleted and requires min length for fuzzy", () => {
  const longQuery = buildMemberCandidateQuery("jane");
  assert.deepEqual(longQuery.deleted, { $ne: true });
  assert.deepEqual(longQuery.disabled, { $ne: true });
  assert.ok(Array.isArray(longQuery.status.$nin));
  assert.ok(longQuery.status.$nin.includes("disabled"));
  assert.ok(Array.isArray(longQuery.$or));

  const shortQuery = buildMemberCandidateQuery("a");
  assert.equal(shortQuery.id, "a");
  assert.equal(shortQuery.$or, undefined);

  const emptyQuery = buildMemberCandidateQuery("");
  assert.equal(emptyQuery.id, "__never_matches__");
});

test("sanitizeMemberCandidate returns only safe fields and never raw email", () => {
  const memberships = new Map([["u1", { user_id: "u1", role: "manager", status: "active" }]]);
  const row = sanitizeMemberCandidate(
    { _id: "mongo", id: "u1", email: "jane@company.com", full_name: "Jane Doe", password: "secret" },
    memberships,
  );
  assert.deepEqual(row, {
    user_id: "u1",
    display_name: "Jane Doe",
    email_masked: "j***@company.com",
    already_member: true,
    membership_role: "manager",
  });
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes("jane@company.com"), false);
  assert.equal(serialized.includes("secret"), false);
});

test("searchMemberCandidates returns sanitized rows with correct already_member flags", async () => {
  const users = makeUsersFake([
    { _id: "m1", id: "user_existing", email: "jane@company.com", full_name: "Jane Doe", password: "secret", status: "active" },
    { _id: "m2", id: "user_new", email: "john@company.com", full_name: "John Smith", status: "active" },
  ]);
  const organizationMembers = makeCollection([
    { id: "mem_1", organization_id: "org_1", user_id: "user_existing", role: "viewer", status: "active" },
  ]);

  const result = await searchMemberCandidates(
    { organizationId: "org_1", search: "company", limit: 10 },
    { users, collection: organizationMembers },
  );

  assert.equal(result.length, 2);
  const existing = result.find((u) => u.user_id === "user_existing");
  const fresh = result.find((u) => u.user_id === "user_new");
  assert.equal(existing.already_member, true);
  assert.equal(existing.membership_role, "viewer");
  assert.equal(existing.email_masked, "j***@company.com");
  assert.equal(fresh.already_member, false);
  assert.equal(fresh.membership_role, null);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("jane@company.com"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("m1"), false);
});

test("searchMemberCandidates honors min-length unless searching an exact user id", async () => {
  const users = makeUsersFake([
    { id: "AB", email: "zzz@company.com", status: "active" },
    { id: "other", email: "person@company.com", status: "active" },
  ]);
  const organizationMembers = makeCollection([]);

  const exact = await searchMemberCandidates(
    { organizationId: "org_1", search: "AB" },
    { users, collection: organizationMembers },
  );
  assert.ok(exact.some((u) => u.user_id === "AB"));

  const tooShort = await searchMemberCandidates(
    { organizationId: "org_1", search: "z" },
    { users, collection: organizationMembers },
  );
  assert.deepEqual(tooShort, []);
});

test("searchMemberCandidates excludes disabled and deleted users", async () => {
  const users = makeUsersFake([
    { id: "user_active", email: "active@company.com", status: "active" },
    { id: "user_disabled", email: "disabled@company.com", status: "disabled" },
    { id: "user_deleted", email: "deleted@company.com", deleted: true },
    { id: "user_flag_disabled", email: "flag@company.com", disabled: true },
  ]);
  const organizationMembers = makeCollection([]);

  const result = await searchMemberCandidates(
    { organizationId: "org_1", search: "company" },
    { users, collection: organizationMembers },
  );
  assert.deepEqual(result.map((u) => u.user_id), ["user_active"]);
});

test("searchMemberCandidates rejects an empty search", async () => {
  const users = makeUsersFake([{ id: "u", email: "u@company.com", status: "active" }]);
  const organizationMembers = makeCollection([]);

  await assert.rejects(
    () => searchMemberCandidates(
      { organizationId: "org_1", search: "" },
      { users, collection: organizationMembers },
    ),
    (err) => err.status === 400 && err.code === "bad_request",
  );
});

// ---------------------------------------------------------------------------
// S2-31-fix: target-user existence/active validation on create.
// ---------------------------------------------------------------------------

test("isActiveUserAccount excludes deleted/disabled/non-active and allows a missing status", () => {
  assert.equal(isActiveUserAccount({ id: "u", status: "active" }), true);
  assert.equal(isActiveUserAccount({ id: "u" }), true);
  assert.equal(isActiveUserAccount({ id: "u", status: "disabled" }), false);
  assert.equal(isActiveUserAccount({ id: "u", deleted: true }), false);
  assert.equal(isActiveUserAccount({ id: "u", disabled: true }), false);
  assert.equal(isActiveUserAccount(null), false);
});

test("createOrganizationMember validates the target user when a users collection is provided", async () => {
  const organizationMembers = makeCollection([
    { id: "req", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active" },
  ]);
  const users = makeCollection([{ id: "real_user", status: "active" }]);

  await assert.rejects(
    () => createOrganizationMember(
      { organizationId: "org_1", requesterUserId: "owner_user", targetUserId: "ghost", role: "viewer" },
      { collection: organizationMembers, users },
    ),
    (err) => err.status === 404 && err.code === "user_not_found",
  );

  await assert.rejects(
    () => createOrganizationMember(
      { organizationId: "org_1", requesterUserId: "owner_user", targetUserId: "real_user", role: "viewer" },
      { collection: organizationMembers, users: makeCollection([{ id: "real_user", status: "disabled" }]) },
    ),
    (err) => err.status === 400 && err.code === "invalid_user_id",
  );

  const ok = await createOrganizationMember(
    { organizationId: "org_1", requesterUserId: "owner_user", targetUserId: "real_user", role: "viewer" },
    { collection: organizationMembers, users, idFactory: () => "m_ok" },
  );
  assert.equal(ok.created, true);
  assert.equal(ok.member.user_id, "real_user");
});

test("createOrganizationMember skips user validation when no users collection is provided", async () => {
  const organizationMembers = makeCollection([
    { id: "req", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active" },
  ]);

  const ok = await createOrganizationMember(
    { organizationId: "org_1", requesterUserId: "owner_user", targetUserId: "legacy_user", role: "viewer" },
    { collection: organizationMembers, idFactory: () => "m_legacy" },
  );
  assert.equal(ok.created, true);
  assert.equal(ok.member.user_id, "legacy_user");
});
