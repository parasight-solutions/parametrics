import test from "node:test";
import assert from "node:assert/strict";

import {
  listAccessibleOrganizations,
  requireOrganizationMutationAccess,
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
