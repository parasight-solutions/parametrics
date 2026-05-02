import test from "node:test";
import assert from "node:assert/strict";

import {
  ORGANIZATION_MEMBER_ROLES,
  ORGANIZATION_MEMBER_STATUSES,
  getOrganizationMembership,
  hasActiveOrganizationMembership,
  isOrganizationRoleAllowed,
  normalizeOrganizationMemberStatus,
  normalizeOrganizationRole,
  requireOrganizationMembership,
  requireOrganizationRole,
} from "./organizationAccess.js";

function makeCollection(rows = []) {
  return {
    queries: [],
    async findOne(filter, options) {
      this.queries.push({ filter, options });
      return rows.find((row) =>
        Object.entries(filter || {}).every(([key, value]) => row[key] === value)
      ) || null;
    },
  };
}

test("defines S2-09 membership role and status vocabulary", () => {
  assert.deepEqual(ORGANIZATION_MEMBER_STATUSES, ["active", "invited", "disabled"]);
  assert.deepEqual(ORGANIZATION_MEMBER_ROLES, ["owner", "admin", "manager", "member", "viewer"]);
});

test("normalizes known roles and statuses only", () => {
  assert.equal(normalizeOrganizationRole(" OWNER "), "owner");
  assert.equal(normalizeOrganizationRole("member"), "member");
  assert.equal(normalizeOrganizationRole("platform_admin"), "");
  assert.equal(normalizeOrganizationMemberStatus(" ACTIVE "), "active");
  assert.equal(normalizeOrganizationMemberStatus("pending"), "");
});

test("isOrganizationRoleAllowed checks normalized required roles", () => {
  assert.equal(isOrganizationRoleAllowed("Owner", ["admin", "owner"]), true);
  assert.equal(isOrganizationRoleAllowed("viewer", ["owner", "admin"]), false);
  assert.equal(isOrganizationRoleAllowed("owner", []), false);
});

test("getOrganizationMembership requires explicit organization and user ids", async () => {
  await assert.rejects(
    () => getOrganizationMembership(
      { organizationId: "", userId: "user_1" },
      { collection: makeCollection() },
    ),
    (err) => err.status === 400 &&
      err.statusCode === 400 &&
      err.code === "bad_request" &&
      err.message === "organizationId is required",
  );

  await assert.rejects(
    () => getOrganizationMembership(
      { organizationId: "org_1", userId: "" },
      { collection: makeCollection() },
    ),
    (err) => err.status === 400 &&
      err.statusCode === 400 &&
      err.code === "bad_request" &&
      err.message === "userId is required",
  );
});

test("getOrganizationMembership loads active membership through injected collection", async () => {
  const collection = makeCollection([
    {
      id: "member_1",
      organization_id: "org_1",
      user_id: "user_1",
      email: "owner@example.com",
      role: "OWNER",
      status: "active",
      assigned_client_ids: ["client_1", ""],
      assigned_location_ids: ["loc_1"],
      created_at: new Date("2026-05-03T00:00:00.000Z"),
      updated_at: new Date("2026-05-03T00:00:00.000Z"),
    },
  ]);

  const membership = await getOrganizationMembership(
    { organizationId: "org_1", userId: "user_1" },
    { collection },
  );

  assert.deepEqual(collection.queries[0].filter, {
    organization_id: "org_1",
    user_id: "user_1",
    status: "active",
  });
  assert.equal(collection.queries[0].options.projection.email, undefined);
  assert.equal(membership.id, "member_1");
  assert.equal(membership.role, "owner");
  assert.equal(membership.status, "active");
  assert.deepEqual(membership.assigned_client_ids, ["client_1"]);
  assert.deepEqual(membership.assigned_location_ids, ["loc_1"]);
  assert.equal(Object.prototype.hasOwnProperty.call(membership, "email"), false);
});

test("hasActiveOrganizationMembership returns false when active membership is absent", async () => {
  const collection = makeCollection([
    {
      organization_id: "org_1",
      user_id: "user_1",
      role: "owner",
      status: "disabled",
    },
  ]);

  assert.equal(
    await hasActiveOrganizationMembership(
      { organizationId: "org_1", userId: "user_1" },
      { collection },
    ),
    false,
  );
});

test("requireOrganizationMembership throws safe 403 when membership is absent", async () => {
  await assert.rejects(
    () => requireOrganizationMembership(
      { organizationId: "org_missing", userId: "user_missing" },
      { collection: makeCollection() },
    ),
    (err) => err.status === 403 &&
      err.statusCode === 403 &&
      err.code === "organization_membership_required" &&
      err.message === "active organization membership is required" &&
      !JSON.stringify(err).includes("org_missing") &&
      !JSON.stringify(err).includes("user_missing"),
  );
});

test("requireOrganizationRole returns membership for allowed active role", async () => {
  const collection = makeCollection([
    {
      id: "member_1",
      organization_id: "org_1",
      user_id: "user_1",
      role: "admin",
      status: "active",
    },
  ]);

  const membership = await requireOrganizationRole(
    { organizationId: "org_1", userId: "user_1", allowedRoles: ["owner", "admin"] },
    { collection },
  );

  assert.equal(membership.role, "admin");
});

test("requireOrganizationRole throws safe 403 when role is not allowed", async () => {
  const collection = makeCollection([
    {
      id: "member_1",
      organization_id: "org_1",
      user_id: "user_1",
      role: "viewer",
      status: "active",
      email: "viewer@example.com",
    },
  ]);

  await assert.rejects(
    () => requireOrganizationRole(
      { organizationId: "org_1", userId: "user_1", allowedRoles: ["owner", "admin"] },
      { collection },
    ),
    (err) => err.status === 403 &&
      err.statusCode === 403 &&
      err.code === "organization_role_required" &&
      err.message === "required organization role is missing" &&
      !JSON.stringify(err).includes("viewer@example.com"),
  );
});
