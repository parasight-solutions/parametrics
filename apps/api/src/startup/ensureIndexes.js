// apps/api/src/startup/ensureIndexes.js
import { col } from "../lib/mongo.js";

const keyEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const pickIndexSignature = (ix) => ({
  key: ix?.key || null,
  unique: !!ix?.unique,
  partialFilterExpression: ix?.partialFilterExpression || null,
});

const sigEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function listIdx(c) {
  return c.listIndexes().toArray();
}

async function dropIndexIfExists(c, name) {
  try {
    await c.dropIndex(name);
    console.log("[indexes] dropped", c.collectionName, name);
  } catch (_e) {
    // ignore
  }
}

async function ensureIndex(c, key, opts = {}) {
  const existing = await listIdx(c);

  const want = {
    key,
    unique: !!opts.unique,
    partialFilterExpression: opts.partialFilterExpression || null,
  };

  // same signature exists -> ok
  const sameSig = existing.find((ix) => sigEq(pickIndexSignature(ix), want));
  if (sameSig) return;

  // same key exists but signature differs -> drop it
  const sameKey = existing.find((ix) => keyEq(ix.key, key));
  if (sameKey) {
    console.warn("[indexes] index signature mismatch; recreating", c.collectionName, sameKey.name);
    await dropIndexIfExists(c, sameKey.name);
  }

  // desired name exists but wrong signature -> drop it
  if (opts.name) {
    const named = existing.find((ix) => ix.name === opts.name);
    if (named && !sigEq(pickIndexSignature(named), want)) {
      console.warn("[indexes] name exists with different signature; recreating", c.collectionName, opts.name);
      await dropIndexIfExists(c, opts.name);
    }
  }

  await c.createIndex(key, opts);
}

export async function ensureIndexes() {
  // users
  await ensureIndex(await col("users"), { email: 1 }, { unique: true, name: "uniq_users_email" });

  // integrations
  const integrations = await col("integrations");

  // Drop legacy unique(user_id, provider)
  const integIdx = await listIdx(integrations);
  const legacyKey = { user_id: 1, provider: 1 };
  const legacy = integIdx.find((ix) => ix.unique && keyEq(ix.key, legacyKey));
  if (legacy) {
    console.warn("[indexes] dropping legacy unique index on integrations:", legacy.name);
    await dropIndexIfExists(integrations, legacy.name);
  }

  // Unique integration per Google identity (sub) per user/provider
  await ensureIndex(
    integrations,
    { user_id: 1, provider: 1, provider_subject: 1 },
    {
      unique: true,
      partialFilterExpression: { provider_subject: { $type: "string" } },
    }
  );

  // Only ONE default integration per user/provider (partial unique)
  await ensureIndex(
    integrations,
    { user_id: 1, provider: 1, is_active: 1 },
    {
      unique: true,
      name: "uniq_integrations_user_provider_active",
      partialFilterExpression: { is_active: true, active: true },
    }
  );

  // stable id unique
  await ensureIndex(integrations, { id: 1 }, { unique: true, name: "uniq_integrations_id" });

  // locations
  const locations = await col("locations");

  // Drop legacy global index if present
  const desiredLocKey = { user_id: 1, provider: 1, provider_location_name: 1 };
  const legacyGlobalKey = { provider: 1, provider_account_name: 1, provider_location_name: 1 };
  const locIdx = await listIdx(locations);
  const legacyGlobal = locIdx.find((ix) => keyEq(ix.key, legacyGlobalKey));
  if (legacyGlobal) {
    console.warn("[indexes] dropping legacy global unique index on locations:", legacyGlobal.name);
    await dropIndexIfExists(locations, legacyGlobal.name);
  }

  await ensureIndex(locations, desiredLocKey, { unique: true, name: "uniq_location_per_user_provider_location" });
  await ensureIndex(locations, { user_id: 1, updated_at: -1 }, { name: "idx_locations_user_updated_at" });

  // posts
  const posts = await col("posts");
  await ensureIndex(posts, { created_at: -1 }, { name: "idx_posts_created_at_desc" });
  await ensureIndex(posts, { status: 1, scheduled_at: 1 }, { name: "idx_posts_status_scheduled" });

  // reviews
  const reviews = await col("reviews");

  // Drop legacy unique index (no user_id) if it exists
  const revIdx = await listIdx(reviews);
  const legacyReviewsKey = { location_id: 1, provider_review_name: 1 };
  const legacyReviews = revIdx.find((ix) => ix.unique && keyEq(ix.key, legacyReviewsKey));
  if (legacyReviews) {
    console.warn("[indexes] dropping legacy unique index on reviews:", legacyReviews.name);
    await dropIndexIfExists(reviews, legacyReviews.name);
  }

  // Correct uniqueness for multi-user
  await ensureIndex(
    reviews,
    { user_id: 1, location_id: 1, provider_review_name: 1 },
    { unique: true, name: "uniq_reviews_user_location_provider_review" }
  );

  // Fast list endpoint: filter + sort
  await ensureIndex(
    reviews,
    { user_id: 1, location_id: 1, provider: 1, updateTime: -1, createTime: -1 },
    { name: "idx_reviews_user_location_provider_updateTime" }
  );

  // sync-state
  const sync = await col("review_sync_state");
  await ensureIndex(sync, { user_id: 1, location_id: 1 }, { unique: true, name: "uniq_review_sync_state_user_location" });
  await ensureIndex(sync, { user_id: 1, updated_at: -1 }, { name: "idx_review_sync_state_user_updated_at" });
  await ensureIndex(sync, { id: 1 }, { unique: true, name: "uniq_review_sync_state_id" });
}
