import test from "node:test";
import assert from "node:assert/strict";
import {
  listPostAutoSyncSettings,
  setLocationPostAutoSync,
  setScopedPostAutoSync,
} from "./postAutoSyncSettings.js";

const now = new Date("2026-11-20T12:00:00.000Z");
const rows = [
  {
    id: "loc-1", user_id: "owner-a", organization_id: "org-1", client_id: "client-1",
    provider: "google", status: "active", integration_id: "int-1",
    provider_account_name: "accounts/1", provider_location_name: "locations/1", title: "One",
    post_sync: { auto_enabled: true, last_success_at: new Date("2026-11-20T10:00:00Z") },
  },
  {
    id: "loc-2", user_id: "owner-b", organization_id: "org-1", client_id: "client-1",
    provider: "google", status: "active", integration_id: "int-2",
    provider_account_name: "accounts/2", provider_location_name: "locations/2", title: "Two",
  },
];

function locationsDouble(seed = rows) {
  const docs = structuredClone(seed);
  const state = { updateOne: null, updateOnes: [], updateMany: null };
  return {
    state,
    find(filter) {
      const matched = docs.filter((doc) =>
        (!filter.organization_id || doc.organization_id === filter.organization_id) &&
        (!filter.provider || doc.provider === filter.provider) &&
        (!filter.integration_id || doc.integration_id === filter.integration_id),
      );
      return { sort: () => ({ toArray: async () => structuredClone(matched) }) };
    },
    async findOne(filter) {
      return structuredClone(docs.find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) || null);
    },
    async updateOne(filter, update) {
      state.updateOne = { filter, update };
      state.updateOnes.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filter, update) {
      state.updateMany = { filter, update };
      return { matchedCount: filter.$or.length, modifiedCount: filter.$or.length };
    },
  };
}

test("settings list treats missing auto-enabled as false and derives account choices from accessible locations", async () => {
  const result = await listPostAutoSyncSettings({ userId: "admin-1", organizationId: "org-1" }, {
    locations: locationsDouble(),
    requireMembership: async () => ({ role: "admin", assigned_client_ids: [], assigned_location_ids: [] }),
    intervalMinutes: 120,
  });
  assert.equal(result.intervalMinutes, 120);
  assert.equal(result.intervalLabel, "Every 2 hours");
  assert.deepEqual(result.locations.map(({ id, autoEnabled, canManage }) => ({ id, autoEnabled, canManage })), [
    { id: "loc-1", autoEnabled: true, canManage: true },
    { id: "loc-2", autoEnabled: false, canManage: true },
  ]);
  assert.deepEqual(result.accounts.map(({ integrationId }) => integrationId), ["int-1", "int-2"]);
  assert.equal(JSON.stringify(result).includes("operation_id"), false);
});

test("assigned viewer can read only assigned locations and cannot manage them", async () => {
  const result = await listPostAutoSyncSettings({ userId: "viewer-1", organizationId: "org-1" }, {
    locations: locationsDouble(),
    requireMembership: async () => ({ role: "viewer", assigned_client_ids: [], assigned_location_ids: ["loc-2"] }),
    intervalMinutes: 120,
  });
  assert.deepEqual(result.locations.map(({ id, canManage }) => ({ id, canManage })), [
    { id: "loc-2", canManage: false },
  ]);
});

test("individual enable uses server scope, preserves metadata, and schedules a prompt first run", async () => {
  const locations = locationsDouble();
  const result = await setLocationPostAutoSync({ userId: "manager-1", locationId: "loc-2", enabled: true, now }, {
    locations,
    requireLocationAccess: async ({ organizationId, clientId, locationId, allowedRoles }) => {
      assert.equal(organizationId, "org-1");
      assert.equal(clientId, "client-1");
      assert.equal(locationId, "loc-2");
      assert.deepEqual(allowedRoles, ["owner", "admin", "manager"]);
      return { role: "manager" };
    },
  });
  assert.equal(result.autoEnabled, true);
  assert.ok(result.nextAutoSyncAt >= now);
  assert.ok(result.nextAutoSyncAt < new Date(now.getTime() + 5 * 60_000));
  assert.equal(locations.state.updateOne.update.$set["post_sync.auto_enabled"], true);
  assert.equal(Object.hasOwn(locations.state.updateOne.update.$set, "post_sync"), false);
  assert.equal(locations.state.updateOne.filter.user_id, "owner-b");
});

test("bulk update derives assigned manager targets and verifies the complete matched count", async () => {
  const locations = locationsDouble();
  const result = await setScopedPostAutoSync({
    userId: "manager-1", organizationId: "org-1", integrationId: null, enabled: false, now,
  }, {
    locations,
    requireMembership: async () => ({ role: "manager", assigned_client_ids: [], assigned_location_ids: ["loc-1"] }),
    withTransaction: async (work) => work({ id: "session" }),
  });
  assert.equal(result.updated, 1);
  assert.deepEqual(locations.state.updateOnes.map(({ filter }) => filter.id), ["loc-1"]);
  assert.equal(locations.state.updateOnes[0].update.$set["post_sync.auto_enabled"], false);
});

test("bulk update rejects read-only membership before performing any write", async () => {
  const locations = locationsDouble();
  await assert.rejects(setScopedPostAutoSync({
    userId: "viewer-1", organizationId: "org-1", enabled: true, now,
  }, {
    locations,
    requireMembership: async () => ({ role: "viewer", assigned_client_ids: [], assigned_location_ids: ["loc-1"] }),
    withTransaction: async (work) => work({ id: "session" }),
  }), (error) => error.code === "organization_role_required");
  assert.equal(locations.state.updateOnes.length, 0);
});

test("bulk update reports a conflict instead of silent partial success", async () => {
  const locations = locationsDouble();
  let writes = 0;
  locations.updateOne = async () => ({ matchedCount: ++writes === 1 ? 1 : 0, modifiedCount: 1 });
  await assert.rejects(setScopedPostAutoSync({
    userId: "admin-1", organizationId: "org-1", enabled: true, now,
  }, {
    locations,
    requireMembership: async () => ({ role: "admin", assigned_client_ids: [], assigned_location_ids: [] }),
    withTransaction: async (work) => work({ id: "session" }),
  }), (error) => error.code === "post_auto_sync_scope_changed");
});
