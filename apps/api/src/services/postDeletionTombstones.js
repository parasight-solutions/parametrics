import { createHash } from "node:crypto";

const NS = "post-deletion-tombstone:v1";
const GOOGLE_POST_RE = /^accounts\/[^/]+\/locations\/[^/]+\/localPosts\/[^/]+$/;

export function buildPostDeletionTombstoneIdentity({ provider, providerPostName }) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const name = String(providerPostName || "").trim();
  if (normalizedProvider !== "google" || !GOOGLE_POST_RE.test(name)) {
    const error = new Error("Invalid provider post resource.");
    error.code = "invalid_provider_post_resource";
    throw error;
  }
  const digest = createHash("sha256").update(`${NS}|provider:${normalizedProvider}|post:${name}`).digest("hex");
  return { id: `${NS}:${digest}`, providerResourceKey: `${normalizedProvider}:${name}` };
}

export function buildPostDeletionTombstone({ post, location, userId, providerOutcome, deletedAt }) {
  const identity = buildPostDeletionTombstoneIdentity({ provider: "google", providerPostName: post.provider_post_name });
  return {
    _id: identity.id,
    provider_resource_key: identity.providerResourceKey,
    provider: "google",
    provider_post_name: post.provider_post_name,
    provider_account_name: location.provider_account_name,
    provider_location_name: location.provider_location_name,
    organization_id: location.organization_id,
    client_id: location.client_id,
    location_id: location.id,
    integration_id: location.integration_id,
    post_id: post.id,
    deleted_by_user_id: userId,
    deleted_at: deletedAt,
    provider_delete_outcome: providerOutcome,
    created_at: deletedAt,
    updated_at: deletedAt,
  };
}

export function upsertPostDeletionTombstone(tombstones, document, { session } = {}) {
  return tombstones.updateOne(
    { provider_resource_key: document.provider_resource_key },
    { $setOnInsert: document },
    { upsert: true, ...(session ? { session } : {}) },
  );
}

export async function persistPostDeletionTombstone(
  { tombstones, locations, document, location },
  { withTransaction },
) {
  return withTransaction(async (session) => {
    await upsertPostDeletionTombstone(tombstones, document, { session });
    const advanced = await locations.updateOne(
      {
        id: location.id,
        user_id: location.user_id,
        organization_id: location.organization_id,
        client_id: location.client_id,
      },
      {
        $inc: { "post_sync.tombstone_epoch": 1 },
        $set: { "post_sync.last_tombstone_at": document.deleted_at },
      },
      { session },
    );
    if (Number(advanced?.matchedCount || 0) !== 1) {
      const error = new Error("Location scope changed while recording deletion.");
      error.code = "post_delete_tombstone_scope_changed";
      throw error;
    }
    return document;
  });
}

export async function findPostDeletionTombstones(tombstones, { provider = "google", providerPostNames = [], session } = {}) {
  if (!providerPostNames.length) return new Map();
  const docs = await tombstones.find(
    { provider, provider_post_name: { $in: providerPostNames } },
    { session },
  ).toArray();
  return new Map(docs.map((doc) => [doc.provider_post_name, doc]));
}
