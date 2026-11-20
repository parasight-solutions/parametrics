import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPostDeletionTombstone,
  buildPostDeletionTombstoneIdentity,
  findPostDeletionTombstones,
  upsertPostDeletionTombstone,
} from "./postDeletionTombstones.js";

const providerPostName = "accounts/123/locations/456/localPosts/789";
const location = {
  id: "loc-1", organization_id: "org-1", client_id: "client-1",
  integration_id: "integration-1", provider_account_name: "accounts/123",
  provider_location_name: "locations/456",
};
const post = { id: "post-1", provider_post_name: providerPostName };

test("tombstone identity is deterministic and provider-resource scoped", () => {
  const a = buildPostDeletionTombstoneIdentity({ provider: "google", providerPostName });
  assert.deepEqual(a, buildPostDeletionTombstoneIdentity({ provider: "google", providerPostName }));
  assert.match(a.id, /^post-deletion-tombstone:v1:[0-9a-f]{64}$/);
  assert.notDeepEqual(a, buildPostDeletionTombstoneIdentity({ provider: "google", providerPostName: `${providerPostName}-2` }));
});

test("tombstone stores only scope and minimal deletion audit data", () => {
  const deletedAt = new Date("2026-11-19T12:00:00Z");
  const doc = buildPostDeletionTombstone({ post, location, userId: "user-1", providerOutcome: "absent", deletedAt });
  assert.equal(doc.provider, "google");
  assert.equal(doc.provider_post_name, providerPostName);
  assert.equal(doc.location_id, location.id);
  assert.equal(doc.deleted_at, deletedAt);
  assert.equal(doc.provider_delete_outcome, "absent");
  for (const field of ["summary", "image_url", "call_to_action_url", "access_token", "provider_body"]) assert.equal(Object.hasOwn(doc, field), false);
});

test("tombstone writes are insert-only and lookup returns exact names", async () => {
  const calls = [];
  const tombstones = {
    updateOne: async (...args) => { calls.push(args); return { upsertedCount: 1 }; },
    find: ({ provider_post_name }) => ({ toArray: async () => provider_post_name.$in.map((name) => ({ provider_post_name: name })) }),
  };
  const doc = buildPostDeletionTombstone({ post, location, userId: "user-1", providerOutcome: "deleted", deletedAt: new Date() });
  await upsertPostDeletionTombstone(tombstones, doc);
  assert.deepEqual(Object.keys(calls[0][1]), ["$setOnInsert"]);
  assert.equal(calls[0][2].upsert, true);
  const found = await findPostDeletionTombstones(tombstones, { provider: "google", providerPostNames: [providerPostName] });
  assert.equal(found.has(providerPostName), true);
});
