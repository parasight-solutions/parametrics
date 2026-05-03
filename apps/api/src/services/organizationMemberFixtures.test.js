import test from "node:test";
import assert from "node:assert/strict";

import {
  applyOrganizationMemberFixturePlan,
  buildOrganizationMemberFixtureDataset,
  buildOrganizationMemberFixturePlan,
  summarizeOrganizationMemberFixtures,
} from "./organizationMemberFixtures.js";

function matches(filter = {}, row = {}) {
  return Object.entries(filter).every(([key, value]) => row[key] === value);
}

function makeCollection(rows = []) {
  const collection = {
    rows: rows.map((row) => structuredClone(row)),
    writes: [],
    async findOne(filter) {
      const row = this.rows.find((item) => matches(filter, item));
      return row ? structuredClone(row) : null;
    },
    async updateOne(filter, update, options = {}) {
      this.writes.push({ filter, update, options });
      const idx = this.rows.findIndex((item) => matches(filter, item));
      if (idx >= 0) {
        this.rows[idx] = {
          ...this.rows[idx],
          ...(update.$set || {}),
        };
        return {
          matchedCount: 1,
          modifiedCount: update.$set ? 1 : 0,
          upsertedCount: 0,
        };
      }

      if (!options.upsert) {
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }

      const doc = {
        ...filter,
        ...(update.$setOnInsert || {}),
        ...(update.$set || {}),
      };
      this.rows.push(doc);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    },
  };
  return collection;
}

test("fixture dataset uses only hardcoded safe prefixes", () => {
  const dataset = buildOrganizationMemberFixtureDataset({
    now: new Date("2026-05-03T00:00:00.000Z"),
  });

  assert.equal(dataset.prefixes.organization, "s2-15-fixture-");
  assert.equal(dataset.prefixes.membership, "s2-15-member-");
  assert.equal(dataset.prefixes.user, "s2-15-user-");
  assert.equal(dataset.org.id.startsWith(dataset.prefixes.organization), true);
  assert.equal(dataset.org.name.startsWith(dataset.prefixes.organization), true);
  assert.equal(dataset.org.slug.startsWith(dataset.prefixes.organization), true);
  assert.equal(dataset.org.user_id.startsWith(dataset.prefixes.user), true);
  assert.equal(dataset.memberships.length, 7);

  for (const membership of dataset.memberships) {
    assert.equal(membership.id.startsWith(dataset.prefixes.membership), true);
    assert.equal(membership.organization_id.startsWith(dataset.prefixes.organization), true);
    assert.equal(membership.user_id.startsWith(dataset.prefixes.user), true);
  }
});

test("dry-run builds a plan and does not write", async () => {
  const orgs = makeCollection([]);
  const organizationMembers = makeCollection([]);
  const now = new Date("2026-05-03T00:00:00.000Z");

  const plan = await buildOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    now,
  });
  const summary = summarizeOrganizationMemberFixtures(plan);

  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.dryRun, true);
  assert.equal(summary.writesPerformed, false);
  assert.equal(summary.organization.action, "insert");
  assert.equal(summary.membershipsPlanned, 7);
  assert.equal(summary.membershipsToInsert, 7);
  assert.equal(summary.membershipsBackfillable, 7);
  assert.equal(orgs.writes.length, 0);
  assert.equal(organizationMembers.writes.length, 0);
});

test("apply upserts one fixture org and exactly seven memberships", async () => {
  const orgs = makeCollection([]);
  const organizationMembers = makeCollection([]);
  const now = new Date("2026-05-03T00:00:00.000Z");
  const plan = await buildOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    now,
  });

  const writes = await applyOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    plan,
    now,
  });

  assert.equal(writes.orgsUpserted, 1);
  assert.equal(writes.membershipsUpserted, 7);
  assert.equal(orgs.rows.length, 1);
  assert.equal(organizationMembers.rows.length, 7);
  assert.deepEqual(
    organizationMembers.rows.map((row) => row.role).sort(),
    ["admin", "manager", "member", "member", "owner", "viewer", "viewer"],
  );
  assert.deepEqual(
    organizationMembers.rows.map((row) => row.status).sort(),
    ["active", "active", "active", "active", "active", "disabled", "invited"],
  );
});

test("second apply is idempotent", async () => {
  const orgs = makeCollection([]);
  const organizationMembers = makeCollection([]);
  const now = new Date("2026-05-03T00:00:00.000Z");

  const firstPlan = await buildOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    now,
  });
  await applyOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    plan: firstPlan,
    now,
  });

  const secondPlan = await buildOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    now: new Date("2026-05-03T01:00:00.000Z"),
  });
  const secondSummary = summarizeOrganizationMemberFixtures(secondPlan);
  const secondWrites = await applyOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    plan: secondPlan,
    now: new Date("2026-05-03T01:00:00.000Z"),
  });

  assert.equal(secondSummary.membershipsExisting, 7);
  assert.equal(secondSummary.membershipsBackfillable, 0);
  assert.equal(secondWrites.membershipsUpserted, 0);
  assert.equal(secondWrites.membershipsModified, 0);
  assert.equal(organizationMembers.rows.length, 7);
});

test("existing fixture records are updated safely without duplication", async () => {
  const now = new Date("2026-05-03T00:00:00.000Z");
  const dataset = buildOrganizationMemberFixtureDataset({ now });
  const createdAt = new Date("2026-05-01T00:00:00.000Z");
  const orgs = makeCollection([dataset.org]);
  const organizationMembers = makeCollection([
    {
      ...dataset.memberships[0],
      role: "member",
      status: "active",
      assigned_client_ids: ["wrong-client"],
      created_at: createdAt,
      updated_at: createdAt,
    },
  ]);

  const plan = await buildOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    now,
  });
  const summary = summarizeOrganizationMemberFixtures(plan);
  const writes = await applyOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    plan,
    now,
  });

  assert.equal(summary.membershipsToUpdate, 1);
  assert.equal(summary.membershipsToInsert, 6);
  assert.equal(writes.membershipsModified, 1);
  assert.equal(organizationMembers.rows.length, 7);
  const owner = organizationMembers.rows.find((row) => row.id === "s2-15-member-owner");
  assert.equal(owner.role, "owner");
  assert.equal(owner.status, "active");
  assert.deepEqual(owner.assigned_client_ids, []);
  assert.deepEqual(owner.created_at, createdAt);
});

test("non-fixture org/user conflict is detected and apply fails safely", async () => {
  const dataset = buildOrganizationMemberFixtureDataset({
    now: new Date("2026-05-03T00:00:00.000Z"),
  });
  const orgs = makeCollection([dataset.org]);
  const organizationMembers = makeCollection([
    {
      id: "non-fixture-member",
      organization_id: dataset.org.id,
      user_id: "s2-15-user-owner",
      role: "owner",
      status: "active",
    },
  ]);

  const plan = await buildOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    now: new Date("2026-05-03T00:00:00.000Z"),
  });
  const summary = summarizeOrganizationMemberFixtures(plan);

  assert.equal(plan.conflicts.length, 1);
  assert.equal(summary.membershipsConflicting, 1);
  assert.equal(summary.conflictCounts.nonFixtureOrgUser, 1);
  await assert.rejects(
    () => applyOrganizationMemberFixturePlan({
      orgs,
      organizationMembers,
      plan,
      now: new Date("2026-05-03T00:00:00.000Z"),
    }),
    (err) => err.code === "fixture_conflict",
  );
  assert.equal(organizationMembers.writes.length, 0);
});

test("fixture id and org/user mismatches fail safely", async () => {
  const dataset = buildOrganizationMemberFixtureDataset({
    now: new Date("2026-05-03T00:00:00.000Z"),
  });
  const orgs = makeCollection([dataset.org]);
  const organizationMembers = makeCollection([
    {
      ...dataset.memberships[0],
      organization_id: "s2-15-fixture-other-org",
      user_id: "s2-15-user-other-owner",
    },
  ]);

  const plan = await buildOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    now: new Date("2026-05-03T00:00:00.000Z"),
  });
  const summary = summarizeOrganizationMemberFixtures(plan);

  assert.equal(plan.conflicts.length, 1);
  assert.equal(summary.conflictCounts.fixtureMismatch, 1);
  await assert.rejects(
    () => applyOrganizationMemberFixturePlan({
      orgs,
      organizationMembers,
      plan,
      now: new Date("2026-05-03T00:00:00.000Z"),
    }),
    (err) => err.code === "fixture_conflict",
  );
  assert.equal(organizationMembers.writes.length, 0);
});

test("summary omits unsafe fields and includes role/status counts", async () => {
  const dataset = buildOrganizationMemberFixtureDataset({
    now: new Date("2026-05-03T00:00:00.000Z"),
  });
  const orgs = makeCollection([dataset.org]);
  const organizationMembers = makeCollection([
    {
      ...dataset.memberships[0],
      email: "not-printed@example.invalid",
      token: "secret-token",
      password: "secret-password",
      oauth_payload: { raw: true },
    },
  ]);
  const plan = await buildOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    now: new Date("2026-05-03T00:00:00.000Z"),
  });
  const summary = summarizeOrganizationMemberFixtures(plan);
  const serialized = JSON.stringify(summary);

  assert.deepEqual(summary.roleCounts, {
    owner: 1,
    admin: 1,
    manager: 1,
    viewer: 2,
    member: 2,
  });
  assert.deepEqual(summary.statusCounts, {
    active: 5,
    invited: 1,
    disabled: 1,
  });
  assert.equal(serialized.includes("not-printed"), false);
  assert.equal(serialized.includes("secret-token"), false);
  assert.equal(serialized.includes("secret-password"), false);
  assert.equal(serialized.includes("oauth_payload"), false);
});
