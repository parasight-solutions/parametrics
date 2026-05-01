// apps/api/src/startup/ensureIndexes.js
import { col } from "../lib/mongo.js";

const keyEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const pickIndexSignature = (ix) => ({
  key: ix?.key || null,
  unique: !!ix?.unique,
  partialFilterExpression: ix?.partialFilterExpression || null,
});

const sigEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function listIdx(collection) {
  try {
    return await collection.listIndexes().toArray();
  } catch (err) {
    if (err?.codeName === "NamespaceNotFound" || /ns does not exist/i.test(err?.message || "")) {
      return [];
    }
    throw err;
  }
}

async function dropIndexIfExists(collection, name) {
  try {
    await collection.dropIndex(name);
    console.log("[indexes] dropped", collection.collectionName, name);
  } catch {
    // ignore missing index
  }
}

async function ensureIndex(collection, key, opts = {}) {
  const existing = await listIdx(collection);

  const want = {
    key,
    unique: !!opts.unique,
    partialFilterExpression: opts.partialFilterExpression || null,
  };

  const sameSig = existing.find((ix) => sigEq(pickIndexSignature(ix), want));
  if (sameSig) return;

  const sameKey = existing.find((ix) => keyEq(ix.key, key));
  if (sameKey) {
    console.warn(
      "[indexes] index signature mismatch; recreating",
      collection.collectionName,
      sameKey.name
    );
    await dropIndexIfExists(collection, sameKey.name);
  }

  if (opts.name) {
    const named = existing.find((ix) => ix.name === opts.name);
    if (named && !sigEq(pickIndexSignature(named), want)) {
      console.warn(
        "[indexes] name exists with different signature; recreating",
        collection.collectionName,
        opts.name
      );
      await dropIndexIfExists(collection, opts.name);
    }
  }

  await collection.createIndex(key, opts);
}

export async function ensureIndexes() {
  // ---------------------------------------------------------------------------
  // users
  // ---------------------------------------------------------------------------
  const users = await col("users");

  await ensureIndex(users, { email: 1 }, {
    unique: true,
    name: "uniq_users_email",
    partialFilterExpression: { email: { $type: "string" } },
  });

  await ensureIndex(users, { normalized_email: 1 }, {
    unique: true,
    name: "uniq_users_normalized_email",
    partialFilterExpression: { normalized_email: { $type: "string" } },
  });

  await ensureIndex(users, { oauth_provider: 1, oauth_sub: 1 }, {
    unique: true,
    name: "uniq_users_oauth_provider_sub",
    partialFilterExpression: {
      oauth_provider: { $type: "string" },
      oauth_sub: { $type: "string" },
    },
  });

  // ---------------------------------------------------------------------------
  // orgs
  // ---------------------------------------------------------------------------
  const orgs = await col("orgs");
  await ensureIndex(orgs, { user_id: 1, id: 1 }, {
    unique: true,
    name: "uniq_orgs_user_id_id",
  });
  await ensureIndex(orgs, { user_id: 1, updated_at: -1 }, {
    name: "idx_orgs_user_updated_at",
  });
  await ensureIndex(orgs, { owner_user_id: 1, updated_at: -1 }, {
    name: "idx_orgs_owner_updated_at",
  });
  await ensureIndex(orgs, { id: 1 }, {
    name: "idx_orgs_id",
  });

  // ---------------------------------------------------------------------------
  // clients (new for tenancy)
  // ---------------------------------------------------------------------------
  const clients = await col("clients");
  await ensureIndex(clients, { id: 1 }, {
    unique: true,
    name: "uniq_clients_id",
  });
  await ensureIndex(clients, { organization_id: 1, is_default: 1 }, {
    unique: true,
    name: "uniq_clients_org_default",
    partialFilterExpression: { is_default: true },
  });
  await ensureIndex(clients, { organization_id: 1, updated_at: -1 }, {
    name: "idx_clients_org_updated_at",
  });

  // ---------------------------------------------------------------------------
  // integrations
  // ---------------------------------------------------------------------------
  const integrations = await col("integrations");

  // Drop legacy unique(user_id, provider) if present
  const integIdx = await listIdx(integrations);
  const legacyIntegKey = { user_id: 1, provider: 1 };
  const legacyInteg = integIdx.find(
    (ix) => ix.unique && keyEq(ix.key, legacyIntegKey)
  );
  if (legacyInteg) {
    console.warn(
      "[indexes] dropping legacy unique index on integrations:",
      legacyInteg.name
    );
    await dropIndexIfExists(integrations, legacyInteg.name);
  }

  await ensureIndex(
    integrations,
    { user_id: 1, provider: 1, provider_subject: 1 },
    {
      unique: true,
      name: "uniq_integrations_user_provider_subject",
      partialFilterExpression: { provider_subject: { $type: "string" } },
    }
  );

  await ensureIndex(
    integrations,
    { user_id: 1, provider: 1, is_active: 1 },
    {
      unique: true,
      name: "uniq_integrations_user_provider_active",
      partialFilterExpression: { is_active: true, active: true },
    }
  );

  await ensureIndex(integrations, { id: 1 }, {
    unique: true,
    name: "uniq_integrations_id",
  });

  // Safe pre-tenancy read-path indexes
  await ensureIndex(integrations, { organization_id: 1, updated_at: -1 }, {
    name: "idx_integrations_org_updated_at",
  });
  await ensureIndex(integrations, { organization_id: 1, client_id: 1, updated_at: -1 }, {
    name: "idx_integrations_org_client_updated_at",
  });

  // ---------------------------------------------------------------------------
  // locations
  // ---------------------------------------------------------------------------
  const locations = await col("locations");

  const desiredLocKey = { user_id: 1, provider: 1, provider_location_name: 1 };
  const legacyGlobalKey = {
    provider: 1,
    provider_account_name: 1,
    provider_location_name: 1,
  };

  const locIdx = await listIdx(locations);
  const legacyGlobal = locIdx.find((ix) => keyEq(ix.key, legacyGlobalKey));
  if (legacyGlobal) {
    console.warn(
      "[indexes] dropping legacy global unique index on locations:",
      legacyGlobal.name
    );
    await dropIndexIfExists(locations, legacyGlobal.name);
  }

  await ensureIndex(locations, desiredLocKey, {
    unique: true,
    name: "uniq_location_per_user_provider_location",
  });

  await ensureIndex(locations, { user_id: 1, updated_at: -1 }, {
    name: "idx_locations_user_updated_at",
  });

  await ensureIndex(locations, { organization_id: 1, client_id: 1, updated_at: -1 }, {
    name: "idx_locations_org_client_updated_at",
  });

  await ensureIndex(locations, { organization_id: 1, provider: 1, provider_location_name: 1 }, {
    name: "idx_locations_org_provider_location_name",
  });

  // ---------------------------------------------------------------------------
  // posts
  // ---------------------------------------------------------------------------
  const posts = await col("posts");

  await ensureIndex(posts, { created_at: -1 }, {
    name: "idx_posts_created_at_desc",
  });

  await ensureIndex(posts, { status: 1, scheduled_at: 1 }, {
    name: "idx_posts_status_scheduled",
  });

  await ensureIndex(posts, { organization_id: 1, client_id: 1, location_id: 1, created_at: -1 }, {
    name: "idx_posts_org_client_location_created_at",
  });

  await ensureIndex(posts, { organization_id: 1, status: 1, scheduled_at: 1 }, {
    name: "idx_posts_org_status_scheduled",
  });

  // ---------------------------------------------------------------------------
  // reviews
  // ---------------------------------------------------------------------------
  const reviews = await col("reviews");

  const revIdx = await listIdx(reviews);
  const legacyReviewsKey = { location_id: 1, provider_review_name: 1 };
  const legacyReviews = revIdx.find(
    (ix) => ix.unique && keyEq(ix.key, legacyReviewsKey)
  );
  if (legacyReviews) {
    console.warn(
      "[indexes] dropping legacy unique index on reviews:",
      legacyReviews.name
    );
    await dropIndexIfExists(reviews, legacyReviews.name);
  }

  await ensureIndex(
    reviews,
    { user_id: 1, location_id: 1, provider_review_name: 1 },
    {
      unique: true,
      name: "uniq_reviews_user_location_provider_review",
    }
  );

  await ensureIndex(
    reviews,
    { user_id: 1, location_id: 1, provider: 1, updateTime: -1, createTime: -1 },
    {
      name: "idx_reviews_user_location_provider_updateTime",
    }
  );

  await ensureIndex(
    reviews,
    { organization_id: 1, client_id: 1, location_id: 1, updateTime: -1, createTime: -1 },
    {
      name: "idx_reviews_org_client_location_updateTime",
    }
  );

  // ---------------------------------------------------------------------------
  // review_sync_state
  // ---------------------------------------------------------------------------
  const sync = await col("review_sync_state");

  await ensureIndex(sync, { user_id: 1, location_id: 1 }, {
    unique: true,
    name: "uniq_review_sync_state_user_location",
  });

  await ensureIndex(sync, { user_id: 1, updated_at: -1 }, {
    name: "idx_review_sync_state_user_updated_at",
  });

  await ensureIndex(sync, { id: 1 }, {
    unique: true,
    name: "uniq_review_sync_state_id",
  });

  await ensureIndex(sync, { organization_id: 1, client_id: 1, location_id: 1 }, {
    name: "idx_review_sync_state_org_client_location",
  });

  // ---------------------------------------------------------------------------
  // recurrence_rules
  // ---------------------------------------------------------------------------
  const recurrenceRules = await col("recurrence_rules");

  await ensureIndex(recurrenceRules, { user_id: 1, updated_at: -1 }, {
    name: "idx_recurrence_rules_user_updated_at",
  });

  await ensureIndex(recurrenceRules, { organization_id: 1, client_id: 1, location_id: 1, updated_at: -1 }, {
    name: "idx_recurrence_rules_org_client_location_updated_at",
  });

  // ---------------------------------------------------------------------------
  // location_org_map (legacy, keep readable for now)
  // ---------------------------------------------------------------------------
  const locationOrgMap = await col("location_org_map");

  await ensureIndex(locationOrgMap, { user_id: 1, location_id: 1 }, {
    unique: true,
    name: "uniq_location_org_map_user_location",
  });

  await ensureIndex(locationOrgMap, { org_id: 1, updated_at: -1 }, {
    name: "idx_location_org_map_org_updated_at",
  });

  // ---------------------------------------------------------------------------
  // reports
  // ---------------------------------------------------------------------------
  const reports = await col("reports");

  await ensureIndex(reports, { id: 1 }, {
    unique: true,
    name: "uniq_reports_id",
  });

  await ensureIndex(reports, { organization_id: 1, client_id: 1, location_id: 1, report_key: 1 }, {
    unique: true,
    name: "uniq_reports_org_client_location_key",
    partialFilterExpression: {
      organization_id: { $type: "string" },
      client_id: { $type: "string" },
      location_id: { $type: "string" },
      report_key: { $type: "string" },
    },
  });

  await ensureIndex(reports, { organization_id: 1, client_id: 1, report_key: 1 }, {
    unique: true,
    name: "uniq_reports_org_client_key",
    partialFilterExpression: {
      organization_id: { $type: "string" },
      client_id: { $type: "string" },
      location_id: null,
      report_key: { $type: "string" },
    },
  });

  await ensureIndex(reports, { organization_id: 1, report_key: 1 }, {
    unique: true,
    name: "uniq_reports_org_key",
    partialFilterExpression: {
      organization_id: { $type: "string" },
      client_id: null,
      location_id: null,
      report_key: { $type: "string" },
    },
  });

  await ensureIndex(reports, { organization_id: 1, updated_at: -1 }, {
    name: "idx_reports_org_updated_at",
  });

  await ensureIndex(reports, { client_id: 1, updated_at: -1 }, {
    name: "idx_reports_client_updated_at",
  });

  await ensureIndex(reports, { location_id: 1, updated_at: -1 }, {
    name: "idx_reports_location_updated_at",
  });

  await ensureIndex(reports, { status: 1, updated_at: -1 }, {
    name: "idx_reports_status_updated_at",
  });

  // ---------------------------------------------------------------------------
  // report_runs
  // ---------------------------------------------------------------------------
  const reportRuns = await col("report_runs");

  await ensureIndex(reportRuns, { id: 1 }, {
    unique: true,
    name: "uniq_report_runs_id",
  });

  await ensureIndex(reportRuns, { report_id: 1, created_at: -1 }, {
    name: "idx_report_runs_report_id_created_at",
  });

  await ensureIndex(reportRuns, { report_key: 1, created_at: -1 }, {
    name: "idx_report_runs_report_key_created_at",
  });

  await ensureIndex(reportRuns, { organization_id: 1, created_at: -1 }, {
    name: "idx_report_runs_org_created_at",
  });

  await ensureIndex(reportRuns, { client_id: 1, created_at: -1 }, {
    name: "idx_report_runs_client_created_at",
  });

  await ensureIndex(reportRuns, { location_id: 1, created_at: -1 }, {
    name: "idx_report_runs_location_created_at",
  });

  await ensureIndex(reportRuns, { status: 1, created_at: -1 }, {
    name: "idx_report_runs_status_created_at",
  });

  // ---------------------------------------------------------------------------
  // audit_logs
  // ---------------------------------------------------------------------------
  const auditLogs = await col("audit_logs");

  await ensureIndex(auditLogs, { created_at: -1 }, {
    name: "idx_audit_logs_created_at_desc",
  });

  await ensureIndex(auditLogs, { actor_user_id: 1, created_at: -1 }, {
    name: "idx_audit_logs_actor_created_at",
  });

  await ensureIndex(auditLogs, { action: 1, created_at: -1 }, {
    name: "idx_audit_logs_action_created_at",
  });

  await ensureIndex(auditLogs, { organization_id: 1, created_at: -1 }, {
    name: "idx_audit_logs_org_created_at",
  });

  await ensureIndex(auditLogs, { location_id: 1, created_at: -1 }, {
    name: "idx_audit_logs_location_created_at",
  });
}
