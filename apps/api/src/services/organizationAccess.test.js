import test from "node:test";
import assert from "node:assert/strict";

import {
  ORGANIZATION_MEMBER_ROLES,
  ORGANIZATION_MEMBER_STATUSES,
  getOrganizationMembership,
  getOrganizationMembershipScope,
  hasActiveOrganizationMembership,
  isMembershipAssignedToLocation,
  isOrganizationRoleAllowed,
  normalizeOrganizationMemberStatus,
  normalizeOrganizationRole,
  requireOrganizationMembership,
  requireOrganizationLocationAccess,
  requireOwnedOrganizationLocationAccess,
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

test("getOrganizationMembershipScope returns sanitized assignment arrays", () => {
  assert.deepEqual(getOrganizationMembershipScope(null), {
    role: "",
    status: "",
    assigned_client_ids: [],
    assigned_location_ids: [],
  });

  assert.deepEqual(getOrganizationMembershipScope({
    role: " Manager ",
    status: " Active ",
    assigned_client_ids: ["client_1", "", null],
    assigned_location_ids: ["loc_1", "  loc_2  "],
    email: "member@example.com",
  }), {
    role: "manager",
    status: "active",
    assigned_client_ids: ["client_1"],
    assigned_location_ids: ["loc_1", "loc_2"],
  });
});

test("isMembershipAssignedToLocation lets owner and admin ignore assignment arrays", () => {
  for (const role of ["owner", "admin"]) {
    assert.equal(isMembershipAssignedToLocation(
      { role, status: "active", assigned_client_ids: [], assigned_location_ids: [] },
      { clientId: "client_1", locationId: "loc_1" },
    ), true);
  }
});

test("isMembershipAssignedToLocation allows manager and viewer only for explicit assignments", () => {
  assert.equal(isMembershipAssignedToLocation(
    { role: "manager", status: "active", assigned_location_ids: ["loc_1"] },
    { clientId: "client_other", locationId: "loc_1" },
  ), true);
  assert.equal(isMembershipAssignedToLocation(
    { role: "manager", status: "active", assigned_client_ids: ["client_1"] },
    { clientId: "client_1", locationId: "loc_other" },
  ), true);
  assert.equal(isMembershipAssignedToLocation(
    { role: "viewer", status: "active", assigned_client_ids: [], assigned_location_ids: [] },
    { clientId: "client_1", locationId: "loc_1" },
  ), false);
  assert.equal(isMembershipAssignedToLocation(
    { role: "member", status: "active", assigned_client_ids: ["client_1"], assigned_location_ids: ["loc_1"] },
    { clientId: "client_1", locationId: "loc_1" },
  ), false);
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

test("requireOrganizationLocationAccess allows owner and admin on scoped location", async () => {
  for (const role of ["owner", "admin"]) {
    const membership = await requireOrganizationLocationAccess(
      {
        organizationId: "org_1",
        clientId: "client_1",
        locationId: "loc_1",
        userId: "user_1",
        allowedRoles: ["owner", "admin", "manager"],
      },
      {
        collection: makeCollection([
          {
            organization_id: "org_1",
            user_id: "user_1",
            role,
            status: "active",
          },
        ]),
      },
    );

    assert.equal(membership.role, role);
  }
});

test("requireOrganizationLocationAccess allows manager assigned to location", async () => {
  const membership = await requireOrganizationLocationAccess(
    {
      organizationId: "org_1",
      clientId: "client_1",
      locationId: "loc_1",
      userId: "user_1",
      allowedRoles: ["owner", "admin", "manager"],
    },
    {
      collection: makeCollection([
        {
          organization_id: "org_1",
          user_id: "user_1",
          role: "manager",
          status: "active",
          assigned_location_ids: ["loc_1"],
        },
      ]),
    },
  );

  assert.equal(membership.role, "manager");
});

test("requireOrganizationLocationAccess allows manager assigned to client", async () => {
  const membership = await requireOrganizationLocationAccess(
    {
      organizationId: "org_1",
      clientId: "client_1",
      locationId: "loc_1",
      userId: "user_1",
      allowedRoles: ["owner", "admin", "manager"],
    },
    {
      collection: makeCollection([
        {
          organization_id: "org_1",
          user_id: "user_1",
          role: "manager",
          status: "active",
          assigned_client_ids: ["client_1"],
        },
      ]),
    },
  );

  assert.equal(membership.role, "manager");
});

test("requireOrganizationLocationAccess denies manager when not assigned", async () => {
  await assert.rejects(
    () => requireOrganizationLocationAccess(
      {
        organizationId: "org_1",
        clientId: "client_1",
        locationId: "loc_1",
        userId: "user_1",
        allowedRoles: ["owner", "admin", "manager"],
      },
      {
        collection: makeCollection([
          {
            organization_id: "org_1",
            user_id: "user_1",
            role: "manager",
            status: "active",
            assigned_client_ids: ["client_other"],
            assigned_location_ids: ["loc_other"],
          },
        ]),
      },
    ),
    (err) => err.status === 403 &&
      err.statusCode === 403 &&
      err.code === "organization_scope_required" &&
      err.message === "required organization assignment is missing",
  );
});

test("requireOrganizationLocationAccess denies viewer and member for mutation role set", async () => {
  for (const role of ["viewer", "member"]) {
    await assert.rejects(
      () => requireOrganizationLocationAccess(
        {
          organizationId: "org_1",
          clientId: "client_1",
          locationId: "loc_1",
          userId: "user_1",
          allowedRoles: ["owner", "admin", "manager"],
        },
        {
          collection: makeCollection([
            {
              organization_id: "org_1",
              user_id: "user_1",
              role,
              status: "active",
              assigned_client_ids: ["client_1"],
              assigned_location_ids: ["loc_1"],
            },
          ]),
        },
      ),
      (err) => err.status === 403 && err.code === "organization_role_required",
    );
  }
});

test("requireOrganizationLocationAccess denies missing disabled and invited memberships", async () => {
  const cases = [
    { name: "missing", rows: [] },
    { name: "disabled", rows: [{ organization_id: "org_1", user_id: "user_1", role: "owner", status: "disabled" }] },
    { name: "invited", rows: [{ organization_id: "org_1", user_id: "user_1", role: "owner", status: "invited" }] },
  ];

  for (const item of cases) {
    await assert.rejects(
      () => requireOrganizationLocationAccess(
        {
          organizationId: "org_1",
          clientId: "client_1",
          locationId: "loc_1",
          userId: "user_1",
          allowedRoles: ["owner", "admin"],
        },
        { collection: makeCollection(item.rows) },
      ),
      (err) => err.status === 403 && err.code === "organization_membership_required",
      item.name,
    );
  }
});

test("requireOwnedOrganizationLocationAccess returns not_found before membership lookup for stale location", async () => {
  const collection = makeCollection([
    {
      organization_id: "org_1",
      user_id: "user_1",
      role: "owner",
      status: "active",
    },
  ]);
  let loadCount = 0;

  await assert.rejects(
    () => requireOwnedOrganizationLocationAccess(
      {
        userId: "user_1",
        locationId: "stale_loc",
        provider: "google",
        allowedRoles: ["owner", "admin"],
      },
      {
        collection,
        requireOwnedLocation: async () => {
          loadCount += 1;
          const err = new Error("location not found");
          err.status = 404;
          err.statusCode = 404;
          err.code = "not_found";
          throw err;
        },
      },
    ),
    (err) => err.status === 404 && err.code === "not_found",
  );

  assert.equal(loadCount, 1);
  assert.equal(collection.queries.length, 0);
});

test("requireOwnedOrganizationLocationAccess uses canonical location scope without location_org_map", async () => {
  const collection = makeCollection([
    {
      organization_id: "org_canonical",
      user_id: "user_1",
      role: "manager",
      status: "active",
      assigned_location_ids: ["loc_1"],
    },
    {
      organization_id: "org_legacy_map",
      user_id: "user_1",
      role: "owner",
      status: "active",
    },
  ]);

  const result = await requireOwnedOrganizationLocationAccess(
    {
      userId: "user_1",
      locationId: "loc_1",
      provider: "google",
      allowedRoles: ["owner", "admin", "manager"],
    },
    {
      collection,
      requireOwnedLocation: async () => ({
        id: "loc_1",
        user_id: "user_1",
        provider: "google",
        organization_id: "org_canonical",
        client_id: "client_1",
        org_id: "org_legacy_map",
      }),
    },
  );

  assert.equal(result.location.organization_id, "org_canonical");
  assert.equal(result.membership.role, "manager");
  assert.deepEqual(collection.queries.map((query) => query.filter.organization_id), ["org_canonical"]);
});
