const FIXTURE_ORG_PREFIX = "s2-15-fixture-";
const FIXTURE_MEMBER_PREFIX = "s2-15-member-";
const FIXTURE_USER_PREFIX = "s2-15-user-";

const FIXTURE_ORG_ID = `${FIXTURE_ORG_PREFIX}org`;
const FIXTURE_CLIENT_ID = `${FIXTURE_ORG_PREFIX}client-1`;
const FIXTURE_LOCATION_ID = `${FIXTURE_ORG_PREFIX}location-1`;

const ROLE_ORDER = Object.freeze(["owner", "admin", "manager", "viewer", "member"]);
const STATUS_ORDER = Object.freeze(["active", "invited", "disabled"]);

function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function assertSafeFixturePrefix(value, prefix, label) {
  const v = cleanStr(value, 200);
  if (!v.startsWith(prefix)) {
    throw new Error(`${label} must use ${prefix}`);
  }
  return v;
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = cleanStr(row?.[key], 80).toLowerCase();
    if (!value) continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function orderedCounts(counts, order) {
  const out = {};
  for (const key of order) out[key] = counts[key] || 0;
  for (const key of Object.keys(counts).sort()) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = counts[key];
  }
  return out;
}

function isFixtureMembership(row) {
  return cleanStr(row?.id, 200).startsWith(FIXTURE_MEMBER_PREFIX)
    && cleanStr(row?.organization_id, 200).startsWith(FIXTURE_ORG_PREFIX)
    && cleanStr(row?.user_id, 200).startsWith(FIXTURE_USER_PREFIX);
}

function isFixtureOrg(row) {
  return cleanStr(row?.id, 200).startsWith(FIXTURE_ORG_PREFIX)
    && cleanStr(row?.name, 200).startsWith(FIXTURE_ORG_PREFIX)
    && cleanStr(row?.slug, 200).startsWith(FIXTURE_ORG_PREFIX)
    && cleanStr(row?.user_id, 200).startsWith(FIXTURE_USER_PREFIX)
    && cleanStr(row?.owner_user_id, 200).startsWith(FIXTURE_USER_PREFIX);
}

function sanitizeMembershipForSummary(row) {
  return {
    id: cleanStr(row?.id, 200),
    organization_id: cleanStr(row?.organization_id, 200),
    user_id: cleanStr(row?.user_id, 200),
    role: cleanStr(row?.role, 80).toLowerCase(),
    status: cleanStr(row?.status, 80).toLowerCase(),
    invited_by_user_id: cleanStr(row?.invited_by_user_id, 200) || null,
    assigned_client_ids: Array.isArray(row?.assigned_client_ids)
      ? row.assigned_client_ids.map((item) => cleanStr(item, 200)).filter(Boolean)
      : [],
    assigned_location_ids: Array.isArray(row?.assigned_location_ids)
      ? row.assigned_location_ids.map((item) => cleanStr(item, 200)).filter(Boolean)
      : [],
  };
}

function sanitizeOrgForCompare(row) {
  return {
    id: cleanStr(row?.id, 200),
    user_id: cleanStr(row?.user_id, 200),
    owner_user_id: cleanStr(row?.owner_user_id, 200),
    name: cleanStr(row?.name, 200),
    slug: cleanStr(row?.slug, 200),
    status: cleanStr(row?.status, 80).toLowerCase(),
    website: cleanStr(row?.website, 300),
    industry: cleanStr(row?.industry, 120),
    description: cleanStr(row?.description, 2000),
    onboarding: row?.onboarding || {},
    brand: row?.brand || {},
  };
}

export function buildOrganizationMemberFixtureDataset({ now = new Date() } = {}) {
  const ownerUserId = `${FIXTURE_USER_PREFIX}owner`;
  const org = {
    id: FIXTURE_ORG_ID,
    user_id: ownerUserId,
    owner_user_id: ownerUserId,
    name: `${FIXTURE_ORG_PREFIX}organization`,
    slug: `${FIXTURE_ORG_PREFIX}organization`,
    status: "active",
    website: "",
    industry: "",
    description: "Local S2-15 organization membership fixture.",
    onboarding: {
      targetAudience: "",
      services: [],
      keywords: [],
      tone: "",
      offers: "",
      doNotMention: "",
      language: "en",
      goals: [],
    },
    brand: {
      primaryColor: "",
      logoUrl: "",
    },
    created_at: now,
    updated_at: now,
  };

  const baseMembership = ({ suffix, role, status, clientIds = [], locationIds = [] }) => ({
    id: `${FIXTURE_MEMBER_PREFIX}${suffix}`,
    organization_id: org.id,
    user_id: `${FIXTURE_USER_PREFIX}${suffix}`,
    role,
    status,
    invited_by_user_id: null,
    assigned_client_ids: clientIds,
    assigned_location_ids: locationIds,
    created_at: now,
    updated_at: now,
  });

  const memberships = [
    baseMembership({ suffix: "owner", role: "owner", status: "active" }),
    baseMembership({ suffix: "admin", role: "admin", status: "active" }),
    baseMembership({
      suffix: "manager",
      role: "manager",
      status: "active",
      clientIds: [FIXTURE_CLIENT_ID],
      locationIds: [FIXTURE_LOCATION_ID],
    }),
    baseMembership({
      suffix: "viewer",
      role: "viewer",
      status: "active",
      clientIds: [FIXTURE_CLIENT_ID],
      locationIds: [FIXTURE_LOCATION_ID],
    }),
    baseMembership({ suffix: "member", role: "member", status: "active" }),
    baseMembership({ suffix: "invited", role: "member", status: "invited" }),
    baseMembership({ suffix: "disabled", role: "viewer", status: "disabled" }),
  ];

  assertSafeFixturePrefix(org.id, FIXTURE_ORG_PREFIX, "fixture organization id");
  assertSafeFixturePrefix(org.name, FIXTURE_ORG_PREFIX, "fixture organization name");
  assertSafeFixturePrefix(org.slug, FIXTURE_ORG_PREFIX, "fixture organization slug");
  assertSafeFixturePrefix(org.user_id, FIXTURE_USER_PREFIX, "fixture organization user_id");
  assertSafeFixturePrefix(org.owner_user_id, FIXTURE_USER_PREFIX, "fixture organization owner_user_id");

  for (const membership of memberships) {
    assertSafeFixturePrefix(membership.id, FIXTURE_MEMBER_PREFIX, "fixture membership id");
    assertSafeFixturePrefix(membership.organization_id, FIXTURE_ORG_PREFIX, "fixture membership organization_id");
    assertSafeFixturePrefix(membership.user_id, FIXTURE_USER_PREFIX, "fixture membership user_id");
  }

  return {
    prefixes: {
      organization: FIXTURE_ORG_PREFIX,
      membership: FIXTURE_MEMBER_PREFIX,
      user: FIXTURE_USER_PREFIX,
    },
    org,
    memberships,
  };
}

async function findOne(collection, filter, options = {}) {
  return collection.findOne(filter, options);
}

export async function buildOrganizationMemberFixturePlan({
  orgs,
  organizationMembers,
  now = new Date(),
} = {}) {
  if (!orgs?.findOne || !organizationMembers?.findOne) {
    throw new Error("orgs and organizationMembers collections are required");
  }

  const dataset = buildOrganizationMemberFixtureDataset({ now });
  const existingOrg = await findOne(
    orgs,
    { id: dataset.org.id },
    { projection: { _id: 0 } },
  );
  const orgConflict = existingOrg && !isFixtureOrg(existingOrg);
  const orgSafeSet = {
    user_id: dataset.org.user_id,
    owner_user_id: dataset.org.owner_user_id,
    name: dataset.org.name,
    slug: dataset.org.slug,
    status: dataset.org.status,
    website: dataset.org.website,
    industry: dataset.org.industry,
    description: dataset.org.description,
    onboarding: dataset.org.onboarding,
    brand: dataset.org.brand,
    updated_at: now,
  };
  const orgNeedsUpdate = existingOrg
    && !orgConflict
    && JSON.stringify(sanitizeOrgForCompare(existingOrg))
      !== JSON.stringify(sanitizeOrgForCompare({ ...existingOrg, ...orgSafeSet }));

  const membershipPlans = [];
  const conflicts = [];

  for (const desired of dataset.memberships) {
    const byId = await findOne(
      organizationMembers,
      { id: desired.id },
      { projection: { _id: 0 } },
    );
    const byOrgUser = await findOne(
      organizationMembers,
      {
        organization_id: desired.organization_id,
        user_id: desired.user_id,
      },
      { projection: { _id: 0 } },
    );
    const existing = byId || byOrgUser;
    const conflict = existing && !isFixtureMembership(existing);
    const idScopeMismatch = byId
      && (
        cleanStr(byId.organization_id, 200) !== desired.organization_id
        || cleanStr(byId.user_id, 200) !== desired.user_id
      );
    const orgUserIdMismatch = byOrgUser
      && cleanStr(byOrgUser.id, 200) !== desired.id;

    if (conflict || idScopeMismatch || orgUserIdMismatch) {
      conflicts.push({
        membership_id: desired.id,
        organization_id: desired.organization_id,
        user_id: desired.user_id,
        reason: conflict ? "non_fixture_org_user_conflict" : "fixture_id_org_user_mismatch",
      });
      membershipPlans.push({ action: "conflict", desired, existing });
      continue;
    }

    if (!existing) {
      membershipPlans.push({ action: "insert", desired, existing: null });
      continue;
    }

    const safeSet = {
      organization_id: desired.organization_id,
      user_id: desired.user_id,
      role: desired.role,
      status: desired.status,
      invited_by_user_id: desired.invited_by_user_id,
      assigned_client_ids: desired.assigned_client_ids,
      assigned_location_ids: desired.assigned_location_ids,
      updated_at: now,
    };
    const needsUpdate = JSON.stringify(sanitizeMembershipForSummary(existing))
      !== JSON.stringify(sanitizeMembershipForSummary({ ...existing, ...safeSet }));

    membershipPlans.push({
      action: needsUpdate ? "update" : "existing",
      desired,
      existing,
      safeSet,
    });
  }

  return {
    dataset,
    org: {
      action: orgConflict ? "conflict" : existingOrg ? orgNeedsUpdate ? "update" : "existing" : "insert",
      desired: dataset.org,
      existing: existingOrg || null,
      safeSet: orgSafeSet,
    },
    memberships: membershipPlans,
    conflicts: [
      ...(orgConflict ? [{
        organization_id: dataset.org.id,
        reason: "non_fixture_org_conflict",
      }] : []),
      ...conflicts,
    ],
  };
}

export function summarizeOrganizationMemberFixtures(plan, { apply = false, writes = null } = {}) {
  const memberships = plan?.memberships || [];
  const existingRows = memberships
    .filter((item) => item.existing && item.action !== "conflict")
    .map((item) => item.existing);
  const plannedRows = memberships.map((item) => item.desired);
  const actionCounts = memberships.reduce((counts, item) => {
    counts[item.action] = (counts[item.action] || 0) + 1;
    return counts;
  }, {});

  return {
    task: "S2-15 organization member fixtures",
    mode: apply ? "apply" : "dry-run",
    dryRun: !apply,
    writesPerformed: !!apply,
    prefixes: plan.dataset.prefixes,
    organization: {
      id: plan.dataset.org.id,
      name: plan.dataset.org.name,
      slug: plan.dataset.org.slug,
      action: plan.org.action,
    },
    membershipsPlanned: plannedRows.length,
    membershipsExisting: existingRows.length,
    membershipsBackfillable: (actionCounts.insert || 0) + (actionCounts.update || 0),
    membershipsToInsert: actionCounts.insert || 0,
    membershipsToUpdate: actionCounts.update || 0,
    membershipsConflicting: actionCounts.conflict || 0,
    roleCounts: orderedCounts(countBy(plannedRows, "role"), ROLE_ORDER),
    statusCounts: orderedCounts(countBy(plannedRows, "status"), STATUS_ORDER),
    plannedMembershipIds: plannedRows.map((row) => row.id),
    conflictCounts: {
      total: plan.conflicts.length,
      nonFixtureOrgUser: plan.conflicts.filter((item) => item.reason === "non_fixture_org_user_conflict").length,
      nonFixtureOrg: plan.conflicts.filter((item) => item.reason === "non_fixture_org_conflict").length,
      fixtureMismatch: plan.conflicts.filter((item) => item.reason === "fixture_id_org_user_mismatch").length,
    },
    writes,
  };
}

export async function applyOrganizationMemberFixturePlan({
  orgs,
  organizationMembers,
  plan,
  now = new Date(),
} = {}) {
  if (!orgs?.updateOne || !organizationMembers?.updateOne) {
    throw new Error("orgs and organizationMembers collections are required");
  }

  if (!plan) {
    throw new Error("fixture plan is required");
  }

  if (plan.conflicts.length > 0) {
    const err = new Error("fixture conflicts detected");
    err.code = "fixture_conflict";
    err.conflicts = plan.conflicts;
    throw err;
  }

  const writes = {
    orgsUpserted: 0,
    orgsMatched: 0,
    membershipsUpserted: 0,
    membershipsMatched: 0,
    membershipsModified: 0,
  };

  if (plan.org.action === "insert") {
    const result = await orgs.updateOne(
      { id: plan.dataset.org.id },
      { $setOnInsert: plan.dataset.org },
      { upsert: true },
    );
    writes.orgsUpserted += result.upsertedCount || 0;
    writes.orgsMatched += result.matchedCount || 0;
  } else if (plan.org.action === "update") {
    const result = await orgs.updateOne(
      { id: plan.dataset.org.id },
      { $set: plan.org.safeSet },
    );
    writes.orgsMatched += result.matchedCount || 0;
  }

  for (const membershipPlan of plan.memberships) {
    if (membershipPlan.action === "conflict" || membershipPlan.action === "existing") continue;

    const desired = membershipPlan.desired;
    const filter = {
      organization_id: desired.organization_id,
      user_id: desired.user_id,
    };
    const update = membershipPlan.action === "insert"
      ? { $setOnInsert: desired }
      : {
          $set: {
            ...membershipPlan.safeSet,
            updated_at: now,
          },
        };

    const result = await organizationMembers.updateOne(filter, update, { upsert: membershipPlan.action === "insert" });
    writes.membershipsUpserted += result.upsertedCount || 0;
    writes.membershipsMatched += result.matchedCount || 0;
    writes.membershipsModified += result.modifiedCount || 0;
  }

  return writes;
}
