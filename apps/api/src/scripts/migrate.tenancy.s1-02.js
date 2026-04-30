// apps/api/src/scripts/migrate.tenancy.s1-02.js
import { col } from "../lib/mongo.js";
import {
  getDefaultClientForOrganization,
  getOrCreateDefaultClientForOrganization,
} from "../services/clients.js";

const argv = new Set(process.argv.slice(2));

const MODE = argv.has("--apply")
  ? "apply"
  : argv.has("--verify")
    ? "verify"
    : "dry-run";

const SAMPLE_LIMIT = 20;

const cache = {
  orgById: new Map(),
  defaultClientByOrgId: new Map(),
  mapByUserLoc: new Map(),
  mapRowsByLocationId: new Map(),
  locationByUserLoc: new Map(),
  locationRowsById: new Map(),
};

function json(value) {
  return JSON.stringify(value, null, 2);
}

function logSection(title) {
  console.log("");
  console.log("=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function makeKey(a, b) {
  return `${cleanStr(a, 200)}::${cleanStr(b, 200)}`;
}

function pushSample(bucket, item) {
  if (bucket.length < SAMPLE_LIMIT) bucket.push(item);
}

function makeSlug(value) {
  const base = cleanStr(value, 200).toLowerCase();
  if (!base) return "";
  return base
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function getOrgById(orgId) {
  const id = cleanStr(orgId, 200);
  if (!id) return null;

  if (cache.orgById.has(id)) return cache.orgById.get(id);

  const orgs = await col("orgs");
  const org = await orgs.findOne(
    { id },
    { projection: { _id: 0, id: 1, name: 1, user_id: 1, owner_user_id: 1 } }
  );

  cache.orgById.set(id, org || null);
  return org || null;
}

async function getDefaultClientCached(orgId, orgName = "") {
  const id = cleanStr(orgId, 200);
  if (!id) return null;

  if (cache.defaultClientByOrgId.has(id)) {
    return cache.defaultClientByOrgId.get(id);
  }

  let client = await getDefaultClientForOrganization(id);

  if (!client && MODE === "apply") {
    client = await getOrCreateDefaultClientForOrganization({
      organizationId: id,
      organizationName: orgName,
    });
  }

  cache.defaultClientByOrgId.set(id, client || null);
  return client || null;
}

async function loadLocationOrgMapCache() {
  cache.mapByUserLoc.clear();
  cache.mapRowsByLocationId.clear();

  const mapCol = await col("location_org_map");
  const cursor = mapCol.find(
    {},
    {
      projection: {
        _id: 0,
        user_id: 1,
        location_id: 1,
        org_id: 1,
        organization_id: 1,
      },
    }
  );

  for await (const row of cursor) {
    const userId = cleanStr(row.user_id, 200);
    const locationId = cleanStr(row.location_id, 200);
    if (!locationId) continue;

    cache.mapByUserLoc.set(makeKey(userId, locationId), row);

    const arr = cache.mapRowsByLocationId.get(locationId) || [];
    arr.push(row);
    cache.mapRowsByLocationId.set(locationId, arr);
  }
}

async function loadLocationsCache() {
  cache.locationByUserLoc.clear();
  cache.locationRowsById.clear();

  const locations = await col("locations");
  const cursor = locations.find(
    {},
    {
      projection: {
        _id: 0,
        id: 1,
        user_id: 1,
        title: 1,
        org_id: 1,
        organization_id: 1,
        client_id: 1,
      },
    }
  );

  for await (const row of cursor) {
    const userId = cleanStr(row.user_id, 200);
    const locationId = cleanStr(row.id, 200);
    if (!locationId) continue;

    cache.locationByUserLoc.set(makeKey(userId, locationId), row);

    const arr = cache.locationRowsById.get(locationId) || [];
    arr.push(row);
    cache.locationRowsById.set(locationId, arr);
  }
}

function getMapForLocation(userId, locationId) {
  const uid = cleanStr(userId, 200);
  const lid = cleanStr(locationId, 200);
  if (!lid) return null;

  if (uid) {
    return cache.mapByUserLoc.get(makeKey(uid, lid)) || null;
  }

  const rows = cache.mapRowsByLocationId.get(lid) || [];
  return rows.length === 1 ? rows[0] : null;
}

function getLocationForRef(userId, locationId) {
  const uid = cleanStr(userId, 200);
  const lid = cleanStr(locationId, 200);
  if (!lid) return null;

  if (uid) {
    return cache.locationByUserLoc.get(makeKey(uid, lid)) || null;
  }

  const rows = cache.locationRowsById.get(lid) || [];
  return rows.length === 1 ? rows[0] : null;
}

async function resolveTenancyFromLocationDoc(locationDoc) {
  if (!locationDoc?.id) {
    return {
      organizationId: "",
      clientId: "",
      source: "missing_location",
      orgName: "",
    };
  }

  const currentOrgId =
    cleanStr(locationDoc.organization_id, 200) ||
    cleanStr(locationDoc.org_id, 200);

  const map = getMapForLocation(locationDoc.user_id, locationDoc.id);

  const mapOrgId =
    cleanStr(map?.organization_id, 200) ||
    cleanStr(map?.org_id, 200);

  const organizationId = currentOrgId || mapOrgId;
  if (!organizationId) {
    return {
      organizationId: "",
      clientId: "",
      source: "no_org_binding",
      orgName: "",
    };
  }

  const org = await getOrgById(organizationId);
  const orgName = cleanStr(org?.name, 200);

  const currentClientId = cleanStr(locationDoc.client_id, 200);
  const defaultClient = await getDefaultClientCached(organizationId, orgName);

  return {
    organizationId,
    clientId: currentClientId || cleanStr(defaultClient?.id, 200),
    source: currentOrgId ? "location" : "location_org_map",
    orgName,
  };
}

async function backfillOrgs() {
  const orgs = await col("orgs");
  const cursor = orgs.find(
    {},
    {
      projection: {
        _id: 1,
        id: 1,
        user_id: 1,
        owner_user_id: 1,
        name: 1,
        slug: 1,
        status: 1,
      },
    }
  );

  const result = {
    scanned: 0,
    updated: 0,
    ownerUserIdBackfilled: 0,
    slugBackfilled: 0,
    statusBackfilled: 0,
    defaultClientsCreated: 0,
    skippedMissingId: 0,
    skippedMissingOwnerAndUser: 0,
    samples: [],
  };

  for await (const org of cursor) {
    result.scanned += 1;

    const updates = {};
    const orgId = cleanStr(org.id, 200);
    const userId = cleanStr(org.user_id, 200);
    const ownerUserId = cleanStr(org.owner_user_id, 200);
    const orgName = cleanStr(org.name, 200);

    if (!orgId) {
      result.skippedMissingId += 1;
      pushSample(result.samples, {
        type: "org_missing_id",
        _id: String(org._id),
        name: orgName || null,
      });
      continue;
    }

    if (!ownerUserId && userId) {
      updates.owner_user_id = userId;
      result.ownerUserIdBackfilled += 1;
    }

    if (!cleanStr(org.slug, 200) && orgName) {
      const slug = makeSlug(orgName);
      if (slug) {
        updates.slug = slug;
        result.slugBackfilled += 1;
      }
    }

    if (!cleanStr(org.status, 50)) {
      updates.status = "active";
      result.statusBackfilled += 1;
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date();

      if (MODE === "apply") {
        await orgs.updateOne({ _id: org._id }, { $set: updates });
      }

      result.updated += 1;
      pushSample(result.samples, {
        type: "org_updated",
        id: orgId,
        updates: Object.keys(updates),
      });
    }

    const effectiveOwner = ownerUserId || userId;
    if (!effectiveOwner) {
      result.skippedMissingOwnerAndUser += 1;
      pushSample(result.samples, {
        type: "org_missing_owner_and_user",
        id: orgId,
        name: orgName || null,
      });
      continue;
    }

    const before = await getDefaultClientCached(orgId, orgName);
    if (!before && MODE === "apply") {
      const created = await getOrCreateDefaultClientForOrganization({
        organizationId: orgId,
        organizationName: orgName,
      });
      cache.defaultClientByOrgId.set(orgId, created || null);
      result.defaultClientsCreated += 1;
      pushSample(result.samples, {
        type: "default_client_created",
        organization_id: orgId,
      });
    }
  }

  return result;
}

async function backfillLocationOrgMapMirror() {
  const mapCol = await col("location_org_map");
  const cursor = mapCol.find(
    {},
    {
      projection: {
        _id: 1,
        user_id: 1,
        location_id: 1,
        org_id: 1,
        organization_id: 1,
      },
    }
  );

  const result = {
    scanned: 0,
    updated: 0,
    samples: [],
  };

  for await (const row of cursor) {
    result.scanned += 1;

    const orgId = cleanStr(row.org_id, 200);
    const organizationId = cleanStr(row.organization_id, 200);

    if (!orgId || organizationId === orgId) continue;

    if (MODE === "apply") {
      await mapCol.updateOne(
        { _id: row._id },
        {
          $set: {
            organization_id: orgId,
            updated_at: new Date(),
          },
        }
      );
    }

    result.updated += 1;
    pushSample(result.samples, {
      type: "location_org_map_mirror_updated",
      user_id: row.user_id,
      location_id: row.location_id,
      organization_id: orgId,
    });
  }

  return result;
}

async function backfillLocations() {
  const locations = await col("locations");
  const cursor = locations.find(
    {},
    {
      projection: {
        _id: 1,
        id: 1,
        user_id: 1,
        title: 1,
        org_id: 1,
        organization_id: 1,
        client_id: 1,
      },
    }
  );

  const result = {
    scanned: 0,
    updated: 0,
    orphans: 0,
    samples: [],
  };

  for await (const loc of cursor) {
    result.scanned += 1;

    const locationId = cleanStr(loc.id, 200);
    if (!locationId) {
      result.orphans += 1;
      pushSample(result.samples, {
        type: "location_missing_id",
        title: cleanStr(loc.title, 200) || null,
      });
      continue;
    }

    const tenancy = await resolveTenancyFromLocationDoc(loc);
    if (!tenancy.organizationId || !tenancy.clientId) {
      result.orphans += 1;
      pushSample(result.samples, {
        type: "location_missing_tenancy",
        id: locationId,
        title: cleanStr(loc.title, 200) || null,
        source: tenancy.source,
      });
      continue;
    }

    const updates = {};
    if (cleanStr(loc.org_id, 200) !== tenancy.organizationId) {
      updates.org_id = tenancy.organizationId;
    }
    if (cleanStr(loc.organization_id, 200) !== tenancy.organizationId) {
      updates.organization_id = tenancy.organizationId;
    }
    if (cleanStr(loc.client_id, 200) !== tenancy.clientId) {
      updates.client_id = tenancy.clientId;
    }

    if (Object.keys(updates).length === 0) continue;

    updates.updated_at = new Date();

    if (MODE === "apply") {
      await locations.updateOne({ _id: loc._id }, { $set: updates });

      const merged = {
        ...loc,
        ...updates,
      };
      cache.locationByUserLoc.set(
        makeKey(loc.user_id, loc.id),
        merged
      );

      const arr = cache.locationRowsById.get(loc.id) || [];
      const replaced = arr.map((x) => (x.id === loc.id && x.user_id === loc.user_id ? merged : x));
      cache.locationRowsById.set(loc.id, replaced.length ? replaced : [merged]);
    }

    result.updated += 1;
    pushSample(result.samples, {
      type: "location_updated",
      id: locationId,
      organization_id: tenancy.organizationId,
      client_id: tenancy.clientId,
      source: tenancy.source,
    });
  }

  return result;
}

async function backfillByLocationReference({
  collectionName,
  extraSetBuilder,
}) {
  const collection = await col(collectionName);
  const cursor = collection.find(
    {},
    {
      projection: {
        _id: 1,
        id: 1,
        user_id: 1,
        location_id: 1,
        organization_id: 1,
        client_id: 1,
        ai_org_id: 1,
      },
    }
  );

  const result = {
    scanned: 0,
    updated: 0,
    orphans: 0,
    samples: [],
  };

  for await (const doc of cursor) {
    result.scanned += 1;

    const locationId = cleanStr(doc.location_id, 200);
    if (!locationId) {
      result.orphans += 1;
      pushSample(result.samples, {
        type: `${collectionName}_missing_location_id`,
        id: cleanStr(doc.id, 200) || null,
      });
      continue;
    }

    const loc = getLocationForRef(doc.user_id, locationId);
    if (!loc) {
      result.orphans += 1;
      pushSample(result.samples, {
        type: `${collectionName}_location_not_found`,
        id: cleanStr(doc.id, 200) || null,
        user_id: cleanStr(doc.user_id, 200) || null,
        location_id: locationId,
      });
      continue;
    }

    const tenancy = await resolveTenancyFromLocationDoc(loc);
    if (!tenancy.organizationId || !tenancy.clientId) {
      result.orphans += 1;
      pushSample(result.samples, {
        type: `${collectionName}_missing_tenancy`,
        id: cleanStr(doc.id, 200) || null,
        location_id: locationId,
      });
      continue;
    }

    const updates = {};

    if (cleanStr(doc.organization_id, 200) !== tenancy.organizationId) {
      updates.organization_id = tenancy.organizationId;
    }
    if (cleanStr(doc.client_id, 200) !== tenancy.clientId) {
      updates.client_id = tenancy.clientId;
    }

    if (typeof extraSetBuilder === "function") {
      Object.assign(
        updates,
        extraSetBuilder({
          doc,
          tenancy,
          location: loc,
        }) || {}
      );
    }

    if (Object.keys(updates).length === 0) continue;

    updates.updated_at = new Date();

    if (MODE === "apply") {
      await collection.updateOne({ _id: doc._id }, { $set: updates });
    }

    result.updated += 1;
    pushSample(result.samples, {
      type: `${collectionName}_updated`,
      id: cleanStr(doc.id, 200) || null,
      location_id: locationId,
      organization_id: tenancy.organizationId,
      client_id: tenancy.clientId,
      updated_fields: Object.keys(updates),
    });
  }

  return result;
}

async function countMissing(collectionName, field) {
  const collection = await col(collectionName);
  return collection.countDocuments({
    $or: [
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: "" },
    ],
  });
}

async function verify() {
  const summary = {
    mode: MODE,
    orgsMissingOwnerUserId: await countMissing("orgs", "owner_user_id"),
    orgsMissingSlug: await countMissing("orgs", "slug"),
    orgsMissingStatus: await countMissing("orgs", "status"),

    locationOrgMapMissingOrganizationId: await countMissing(
      "location_org_map",
      "organization_id"
    ),

    locationsMissingOrganizationId: await countMissing(
      "locations",
      "organization_id"
    ),
    locationsMissingClientId: await countMissing("locations", "client_id"),

    postsMissingOrganizationId: await countMissing("posts", "organization_id"),
    postsMissingClientId: await countMissing("posts", "client_id"),

    reviewsMissingOrganizationId: await countMissing("reviews", "organization_id"),
    reviewsMissingClientId: await countMissing("reviews", "client_id"),

    reviewSyncStateMissingOrganizationId: await countMissing(
      "review_sync_state",
      "organization_id"
    ),
    reviewSyncStateMissingClientId: await countMissing(
      "review_sync_state",
      "client_id"
    ),

    recurrenceRulesMissingOrganizationId: await countMissing(
      "recurrence_rules",
      "organization_id"
    ),
    recurrenceRulesMissingClientId: await countMissing(
      "recurrence_rules",
      "client_id"
    ),
  };

  logSection("VERIFY RESULT");
  console.log(json(summary));

  const hasBlockingIssues = Object.values(summary)
    .filter((v) => typeof v === "number")
    .some((v) => v > 0);

  if (hasBlockingIssues) {
    console.error("[tenancy:s1-02] verify failed");
    process.exit(1);
  }

  console.log("[tenancy:s1-02] verify passed");
  process.exit(0);
}

async function dryRun() {
  await loadLocationOrgMapCache();
  await loadLocationsCache();

  const orgs = await backfillOrgs();
  const map = await backfillLocationOrgMapMirror();
  const locations = await backfillLocations();
  const posts = await backfillByLocationReference({
    collectionName: "posts",
    extraSetBuilder: ({ doc, tenancy }) => {
      const updates = {};
      if (!cleanStr(doc.ai_org_id, 200)) {
        updates.ai_org_id = tenancy.organizationId;
      }
      return updates;
    },
  });
  const reviews = await backfillByLocationReference({
    collectionName: "reviews",
  });
  const reviewSyncState = await backfillByLocationReference({
    collectionName: "review_sync_state",
  });
  const recurrenceRules = await backfillByLocationReference({
    collectionName: "recurrence_rules",
  });

  logSection("DRY RUN RESULT");
  console.log(
    json({
      mode: MODE,
      orgs,
      locationOrgMap: map,
      locations,
      posts,
      reviews,
      reviewSyncState,
      recurrenceRules,
    })
  );

  console.log("");
  console.log("No writes were performed.");
  process.exit(0);
}

async function apply() {
  await loadLocationOrgMapCache();
  await loadLocationsCache();

  const orgs = await backfillOrgs();

  await loadLocationOrgMapCache();
  const map = await backfillLocationOrgMapMirror();

  await loadLocationOrgMapCache();
  await loadLocationsCache();
  const locations = await backfillLocations();

  await loadLocationsCache();
  const posts = await backfillByLocationReference({
    collectionName: "posts",
    extraSetBuilder: ({ doc, tenancy }) => {
      const updates = {};
      if (!cleanStr(doc.ai_org_id, 200)) {
        updates.ai_org_id = tenancy.organizationId;
      }
      return updates;
    },
  });

  const reviews = await backfillByLocationReference({
    collectionName: "reviews",
  });

  const reviewSyncState = await backfillByLocationReference({
    collectionName: "review_sync_state",
  });

  const recurrenceRules = await backfillByLocationReference({
    collectionName: "recurrence_rules",
  });

  logSection("APPLY RESULT");
  console.log(
    json({
      mode: MODE,
      orgs,
      locationOrgMap: map,
      locations,
      posts,
      reviews,
      reviewSyncState,
      recurrenceRules,
    })
  );

  console.log("");
  console.log("[tenancy:s1-02] apply complete");
  process.exit(0);
}

async function main() {
  logSection(`TENANCY MIGRATION S1-02 :: ${MODE.toUpperCase()}`);

  if (MODE === "verify") return verify();
  if (MODE === "apply") return apply();
  return dryRun();
}

main().catch((err) => {
  console.error("[tenancy:s1-02] fatal error");
  console.error(err);
  process.exit(1);
});