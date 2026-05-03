import test from "node:test";
import assert from "node:assert/strict";

import { ensureOwnerMembershipForOrganization } from "./organizationMembers.js";

function matches(filter = {}, row = {}) {
  return Object.entries(filter).every(([key, value]) => row[key] === value);
}

function makeCollection(rows = []) {
  return {
    rows,
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
