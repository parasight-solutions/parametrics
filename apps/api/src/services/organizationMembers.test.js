import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureOwnerMembershipForOrganization,
  listOrganizationMembers,
  sanitizeOrganizationMemberForList,
} from "./organizationMembers.js";

function matches(filter = {}, row = {}) {
  return Object.entries(filter).every(([key, value]) => row[key] === value);
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
