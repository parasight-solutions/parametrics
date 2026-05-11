import test from "node:test";
import assert from "node:assert/strict";

import {
  createOrganizationMemberForUser,
  disableOrganizationMemberForUser,
  listAccessibleOrganizations,
  listOrganizationMembersForUser,
  requireOrganizationMutationAccess,
  saveOrganizationForUser,
  updateOrganizationMemberForUser,
} from "./orgs.js";

function matches(filter = {}, row = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some((part) => matches(part, row));
    if (value && typeof value === "object" && Array.isArray(value.$in)) {
      return value.$in.includes(row[key]);
    }
    return row[key] === value;
  });
}

function makeCursor(rows) {
  return {
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    async toArray() {
      return rows.map((row) => structuredClone(row));
    },
  };
}

function makeCollection(rows = []) {
  return {
    rows,
    find(filter) {
      return makeCursor(rows.filter((row) => matches(filter, row)));
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

function makeFailingMembershipCollection(rows = []) {
  const collection = makeCollection(rows);
  return {
    ...collection,
    async updateOne() {
      throw new Error("write failed");
    },
  };
}

test("listAccessibleOrganizations includes legacy-owned and active membership organizations", async () => {
  const orgs = makeCollection([
    { id: "org_legacy", user_id: "user_1", name: "Legacy owned" },
    { id: "org_member", user_id: "user_2", name: "Membership org" },
    { id: "org_other", user_id: "user_3", name: "Other org" },
  ]);
  const organizationMembers = makeCollection([
    { organization_id: "org_member", user_id: "user_1", status: "active" },
    { organization_id: "org_other", user_id: "user_1", status: "disabled" },
  ]);

  const rows = await listAccessibleOrganizations(
    { userId: "user_1" },
    { collections: { orgs, organizationMembers } },
  );

  assert.deepEqual(rows.map((row) => row.id).sort(), ["org_legacy", "org_member"]);
});

test("requireOrganizationMutationAccess denies non-members for existing organizations", async () => {
  const orgs = makeCollection([
    { id: "org_1", user_id: "owner_1", name: "Org 1" },
  ]);
  const organizationMembers = makeCollection([]);

  await assert.rejects(
    () => requireOrganizationMutationAccess(
      { userId: "user_1", organizationId: "org_1" },
      {
        collections: { orgs, organizationMembers },
        requireOrganizationRole: async () => {
          const err = new Error("active organization membership is required");
          err.status = 403;
          err.statusCode = 403;
          err.code = "organization_membership_required";
          throw err;
        },
      },
    ),
    (err) => err.status === 403 && err.code === "organization_membership_required",
  );
});

test("requireOrganizationMutationAccess allows owner/admin membership for existing organizations", async () => {
  const orgs = makeCollection([
    { id: "org_1", user_id: "owner_1", name: "Org 1" },
  ]);
  const organizationMembers = makeCollection([]);

  const result = await requireOrganizationMutationAccess(
    { userId: "user_1", organizationId: "org_1" },
    {
      collections: { orgs, organizationMembers },
      requireOrganizationRole: async ({ organizationId, userId, allowedRoles }) => {
        assert.equal(organizationId, "org_1");
        assert.equal(userId, "user_1");
        assert.deepEqual(allowedRoles, ["owner", "admin"]);
        return { organization_id: organizationId, user_id: userId, role: "admin", status: "active" };
      },
    },
  );

  assert.equal(result.org.id, "org_1");
  assert.equal(result.membership.role, "admin");
});

test("saveOrganizationForUser creates active owner membership for brand-new organization", async () => {
  const now = new Date("2026-05-03T10:00:00.000Z");
  const orgs = makeCollection([]);
  const organizationMembers = makeCollection([]);

  const result = await saveOrganizationForUser(
    {
      userId: "user_1",
      body: { id: "org_new", name: "New Workspace" },
    },
    {
      collections: { orgs, organizationMembers },
      membershipIdFactory: () => "member_1",
      now,
    },
  );

  assert.equal(result.org.id, "org_new");
  assert.equal(result.org.user_id, "user_1");
  assert.equal(result.org.owner_user_id, "user_1");
  assert.equal(result.ownerMembershipCreated, true);
  assert.equal(organizationMembers.rows.length, 1);
  assert.deepEqual(organizationMembers.rows[0], {
    id: "member_1",
    organization_id: "org_new",
    user_id: "user_1",
    role: "owner",
    status: "active",
    assigned_client_ids: [],
    assigned_location_ids: [],
    invited_by_user_id: null,
    created_at: now,
    updated_at: now,
  });
});

test("saveOrganizationForUser preserves existing membership without duplicating or downgrading", async () => {
  const now = new Date("2026-05-03T10:00:00.000Z");
  const existingMembership = {
    id: "member_existing",
    organization_id: "org_new",
    user_id: "user_1",
    role: "admin",
    status: "disabled",
    created_at: new Date("2026-05-01T10:00:00.000Z"),
    updated_at: new Date("2026-05-01T10:00:00.000Z"),
  };
  const orgs = makeCollection([]);
  const organizationMembers = makeCollection([existingMembership]);

  const result = await saveOrganizationForUser(
    {
      userId: "user_1",
      body: { id: "org_new", name: "New Workspace" },
    },
    {
      collections: { orgs, organizationMembers },
      membershipIdFactory: () => "member_new",
      now,
    },
  );

  assert.equal(result.ownerMembershipCreated, false);
  assert.equal(result.ownerMembership.role, "admin");
  assert.equal(result.ownerMembership.status, "disabled");
  assert.equal(organizationMembers.rows.length, 1);
  assert.deepEqual(organizationMembers.rows[0], existingMembership);
});

test("saveOrganizationForUser fails brand-new org creation response when owner membership cannot be created", async () => {
  const orgs = makeCollection([]);
  const organizationMembers = makeFailingMembershipCollection([]);

  await assert.rejects(
    () => saveOrganizationForUser(
      {
        userId: "user_1",
        body: { id: "org_new", name: "New Workspace" },
      },
      { collections: { orgs, organizationMembers } },
    ),
    (err) => err.status === 500 && err.code === "organization_membership_create_failed",
  );

  assert.equal(orgs.rows.length, 1);
  assert.equal(organizationMembers.rows.length, 0);
});

test("listOrganizationMembersForUser allows owner admin and manager to list sanitized members", async () => {
  for (const role of ["owner", "admin", "manager"]) {
    const orgs = makeCollection([
      { id: "org_1", user_id: "owner_1", name: "Org 1" },
    ]);
    const organizationMembers = makeCollection([
      {
        _id: "mongo_id",
        id: `requester_${role}`,
        organization_id: "org_1",
        user_id: "user_requester",
        role,
        status: "active",
        email: "requester@example.com",
        token: "secret",
        created_at: new Date("2026-05-02T10:00:00.000Z"),
      },
      {
        _id: "mongo_id_2",
        id: "owner_member",
        organization_id: "org_1",
        user_id: "user_owner",
        role: "owner",
        status: "active",
        email: "owner@example.com",
        password: "secret",
        assigned_client_ids: ["client_1", ""],
        assigned_location_ids: ["loc_1"],
        invited_by_user_id: "inviter_1",
        created_at: new Date("2026-05-01T10:00:00.000Z"),
      },
    ]);

    const result = await listOrganizationMembersForUser(
      { userId: "user_requester", organizationId: "org_1", limit: 50 },
      { collections: { orgs, organizationMembers } },
    );

    assert.equal(result.members.length, 2);
    assert.equal(result.members[0].id, "owner_member");
    assert.equal(result.members[0].organization_id, "org_1");
    assert.equal(result.members[0].user_id, "user_owner");
    assert.equal(result.members[0].role, "owner");
    assert.equal(result.members[0].status, "active");
    assert.deepEqual(result.members[0].assigned_client_ids, ["client_1"]);
    assert.deepEqual(result.members[0].assigned_location_ids, ["loc_1"]);
    assert.equal(result.members[0].invited_by_user_id, "inviter_1");
    assert.equal(Object.prototype.hasOwnProperty.call(result.members[0], "_id"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.members[0], "email"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.members[0], "password"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.members[0], "token"), false);
  }
});

test("listOrganizationMembersForUser denies viewer and member roles", async () => {
  for (const role of ["viewer", "member"]) {
    const orgs = makeCollection([
      { id: "org_1", user_id: "owner_1", name: "Org 1" },
    ]);
    const organizationMembers = makeCollection([
      {
        id: `requester_${role}`,
        organization_id: "org_1",
        user_id: "user_requester",
        role,
        status: "active",
      },
    ]);

    await assert.rejects(
      () => listOrganizationMembersForUser(
        { userId: "user_requester", organizationId: "org_1", limit: 50 },
        { collections: { orgs, organizationMembers } },
      ),
      (err) => err.status === 403 && err.code === "organization_role_required",
    );
  }
});

test("listOrganizationMembersForUser denies missing invited and disabled memberships", async () => {
  const cases = [
    { name: "missing", rows: [] },
    { name: "invited", rows: [{ id: "member_1", organization_id: "org_1", user_id: "user_requester", role: "owner", status: "invited" }] },
    { name: "disabled", rows: [{ id: "member_1", organization_id: "org_1", user_id: "user_requester", role: "owner", status: "disabled" }] },
  ];

  for (const item of cases) {
    const orgs = makeCollection([
      { id: "org_1", user_id: "owner_1", name: "Org 1" },
    ]);
    const organizationMembers = makeCollection(item.rows);

    await assert.rejects(
      () => listOrganizationMembersForUser(
        { userId: "user_requester", organizationId: "org_1", limit: 50 },
        { collections: { orgs, organizationMembers } },
      ),
      (err) => err.status === 403 && err.code === "organization_membership_required",
      item.name,
    );
  }
});

test("listOrganizationMembersForUser checks org existence after membership passes", async () => {
  const orgs = makeCollection([]);
  const organizationMembers = makeCollection([
    {
      id: "member_1",
      organization_id: "org_missing",
      user_id: "user_requester",
      role: "owner",
      status: "active",
    },
  ]);

  await assert.rejects(
    () => listOrganizationMembersForUser(
      { userId: "user_requester", organizationId: "org_missing", limit: 50 },
      { collections: { orgs, organizationMembers } },
    ),
    (err) => err.status === 404 && err.code === "not_found",
  );
});

test("listOrganizationMembersForUser requires explicit identifiers", async () => {
  const orgs = makeCollection([]);
  const organizationMembers = makeCollection([]);

  await assert.rejects(
    () => listOrganizationMembersForUser(
      { userId: "user_requester", organizationId: "", limit: 50 },
      { collections: { orgs, organizationMembers } },
    ),
    (err) => err.status === 400 && err.code === "bad_request",
  );

  await assert.rejects(
    () => listOrganizationMembersForUser(
      { userId: "", organizationId: "org_1", limit: 50 },
      { collections: { orgs, organizationMembers } },
    ),
    (err) => err.status === 400 && err.code === "bad_request",
  );
});

test("createOrganizationMemberForUser creates direct membership through org wrapper", async () => {
  const now = new Date("2026-05-03T12:00:00.000Z");
  const orgs = makeCollection([{ id: "org_1", name: "Org 1" }]);
  const organizationMembers = makeCollection([
    { id: "requester", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active" },
  ]);
  const clients = makeCollection([{ id: "client_1", organization_id: "org_1" }]);
  const locations = makeCollection([{ id: "loc_1", organization_id: "org_1" }]);

  const result = await createOrganizationMemberForUser(
    {
      userId: "owner_user",
      organizationId: "org_1",
      body: {
        user_id: "target_user",
        role: "viewer",
        assigned_client_ids: ["client_1"],
        assigned_location_ids: ["loc_1"],
      },
    },
    {
      collections: { orgs, organizationMembers, clients, locations },
      memberIdFactory: () => "member_target",
      now,
    },
  );

  assert.equal(result.org.id, "org_1");
  assert.equal(result.created, true);
  assert.equal(result.member.id, "member_target");
  assert.equal(result.member.user_id, "target_user");
  assert.equal(result.member.role, "viewer");
  assert.deepEqual(result.member.assigned_client_ids, ["client_1"]);
  assert.equal(organizationMembers.rows.length, 2);
});

test("createOrganizationMemberForUser requires existing org before mutation", async () => {
  const orgs = makeCollection([]);
  const organizationMembers = makeCollection([
    { id: "requester", organization_id: "org_missing", user_id: "owner_user", role: "owner", status: "active" },
  ]);

  await assert.rejects(
    () => createOrganizationMemberForUser(
      {
        userId: "owner_user",
        organizationId: "org_missing",
        body: { user_id: "target_user" },
      },
      { collections: { orgs, organizationMembers } },
    ),
    (err) => err.status === 404 && err.code === "not_found",
  );
  assert.equal(organizationMembers.rows.length, 1);
});

test("updateOrganizationMemberForUser and disableOrganizationMemberForUser return sanitized no-raw members", async () => {
  const orgs = makeCollection([{ id: "org_1", name: "Org 1" }]);
  const organizationMembers = makeCollection([
    { id: "requester", organization_id: "org_1", user_id: "owner_user", role: "owner", status: "active" },
    {
      _id: "mongo_id",
      id: "target",
      organization_id: "org_1",
      user_id: "target_user",
      role: "member",
      status: "active",
      email: "hidden@example.com",
      token: "secret",
      assigned_client_ids: [],
      assigned_location_ids: [],
    },
  ]);

  const updated = await updateOrganizationMemberForUser(
    {
      userId: "owner_user",
      organizationId: "org_1",
      memberId: "target",
      body: { role: "viewer" },
    },
    { collections: { orgs, organizationMembers } },
  );

  assert.equal(updated.updated, true);
  assert.equal(updated.member.role, "viewer");
  assert.equal(Object.prototype.hasOwnProperty.call(updated.member, "_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(updated.member, "email"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(updated.member, "token"), false);

  const disabled = await disableOrganizationMemberForUser(
    {
      userId: "owner_user",
      organizationId: "org_1",
      memberId: "target",
    },
    { collections: { orgs, organizationMembers } },
  );

  assert.equal(disabled.disabled, true);
  assert.equal(disabled.member.status, "disabled");
});
