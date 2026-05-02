import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveOwnerUserId,
  seedOwnerOrganizationMembers,
} from "./organizationMembersSeedMigration.js";

function makeCursor(rows) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) yield row;
    },
  };
}

function makeCollection(rows = []) {
  const docs = [...rows];
  const writes = [];

  return {
    docs,
    writes,
    find(_filter, _options) {
      return makeCursor(docs);
    },
    async findOne(filter) {
      return docs.find((doc) =>
        Object.entries(filter || {}).every(([key, value]) => doc[key] === value)
      ) || null;
    },
    async updateOne(filter, update, options) {
      writes.push({ filter, update, options });
      const existing = await this.findOne(filter);
      if (existing) return { matchedCount: 1, upsertedCount: 0 };

      const doc = { ...filter, ...(update?.$setOnInsert || {}) };
      docs.push(doc);
      return { matchedCount: 0, upsertedCount: 1, upsertedId: doc.id };
    },
  };
}

test("owner_user_id is preferred over user_id", () => {
  assert.equal(
    deriveOwnerUserId({ owner_user_id: "owner-1", user_id: "user-1" }),
    "owner-1",
  );
});

test("user_id fallback works when owner_user_id is missing", () => {
  assert.equal(deriveOwnerUserId({ user_id: "user-1" }), "user-1");
});

test("missing owner is skipped", async () => {
  const orgs = makeCollection([{ id: "org-1", name: "No owner" }]);
  const users = makeCollection([]);
  const members = makeCollection([]);

  const summary = await seedOwnerOrganizationMembers({
    orgs,
    users,
    organizationMembers: members,
    now: new Date("2026-05-02T00:00:00.000Z"),
    idFactory: () => "member-1",
  });

  assert.equal(summary.orgsScanned, 1);
  assert.equal(summary.skippedMissingOwner, 1);
  assert.equal(summary.membershipsBackfillable, 0);
  assert.equal(members.writes.length, 0);
});

test("existing membership is counted and not duplicated", async () => {
  const orgs = makeCollection([{ id: "org-1", owner_user_id: "user-1" }]);
  const users = makeCollection([{ id: "user-1", email: "owner@example.com" }]);
  const members = makeCollection([
    { id: "member-existing", organization_id: "org-1", user_id: "user-1" },
  ]);

  const summary = await seedOwnerOrganizationMembers({
    orgs,
    users,
    organizationMembers: members,
    apply: true,
    now: new Date("2026-05-02T00:00:00.000Z"),
    idFactory: () => "member-1",
  });

  assert.equal(summary.membershipsExisting, 1);
  assert.equal(summary.membershipsBackfillable, 0);
  assert.equal(summary.membershipsInserted, 0);
  assert.equal(members.writes.length, 0);
});

test("dry-run does not write", async () => {
  const orgs = makeCollection([{ id: "org-1", owner_user_id: "user-1" }]);
  const users = makeCollection([{ id: "user-1", email: "Owner@Example.com" }]);
  const members = makeCollection([]);

  const summary = await seedOwnerOrganizationMembers({
    orgs,
    users,
    organizationMembers: members,
    apply: false,
    now: new Date("2026-05-02T00:00:00.000Z"),
    idFactory: () => "member-1",
  });

  assert.equal(summary.writesPerformed, false);
  assert.equal(summary.membershipsBackfillable, 1);
  assert.equal(summary.membershipsInserted, 0);
  assert.equal(members.writes.length, 0);
});

test("apply uses idempotent upsert behavior", async () => {
  const orgs = makeCollection([{ id: "org-1", owner_user_id: "user-1" }]);
  const users = makeCollection([{ id: "user-1", email: "Owner@Example.com" }]);
  const members = makeCollection([]);

  const summary = await seedOwnerOrganizationMembers({
    orgs,
    users,
    organizationMembers: members,
    apply: true,
    now: new Date("2026-05-02T00:00:00.000Z"),
    idFactory: () => "member-1",
  });

  assert.equal(summary.writesPerformed, true);
  assert.equal(summary.membershipsBackfillable, 1);
  assert.equal(summary.membershipsInserted, 1);
  assert.equal(members.writes.length, 1);
  assert.deepEqual(members.writes[0].filter, {
    organization_id: "org-1",
    user_id: "user-1",
  });
  assert.equal(members.writes[0].options.upsert, true);
  assert.equal(members.docs[0].email, "owner@example.com");
  assert.equal(members.docs[0].role, "owner");
  assert.equal(members.docs[0].status, "active");
});
