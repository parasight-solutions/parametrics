import test from "node:test";
import assert from "node:assert/strict";

import {
  listAccessibleOrganizations,
  requireOrganizationMutationAccess,
  saveOrganizationForUser,
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
