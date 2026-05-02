import { randomUUID } from "node:crypto";

const SAMPLE_LIMIT = 20;

export function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function normalizeEmail(value) {
  return cleanStr(value, 320).toLowerCase();
}

function pushSample(bucket, item, limit = SAMPLE_LIMIT) {
  if (bucket.length < limit) bucket.push(item);
}

export function deriveOwnerUserId(org) {
  return cleanStr(org?.owner_user_id, 200) || cleanStr(org?.user_id, 200);
}

export function buildOwnerMembershipDoc({
  org,
  user = null,
  now = new Date(),
  id = randomUUID(),
}) {
  const organizationId = cleanStr(org?.id, 200);
  const userId = deriveOwnerUserId(org);

  return {
    id,
    organization_id: organizationId,
    user_id: userId,
    email: normalizeEmail(user?.email || user?.normalized_email),
    role: "owner",
    status: "active",
    invited_by_user_id: null,
    assigned_client_ids: [],
    assigned_location_ids: [],
    created_at: now,
    updated_at: now,
  };
}

export function planOwnerMembership({ org, existingMembership = null, user = null, now, id }) {
  const organizationId = cleanStr(org?.id, 200);
  const userId = deriveOwnerUserId(org);

  if (!organizationId) {
    return {
      action: "skip",
      reason: "missing_organization_id",
      organization_id: "",
      user_id: userId,
    };
  }

  if (!userId) {
    return {
      action: "skip",
      reason: "missing_owner_user_id",
      organization_id: organizationId,
      user_id: "",
    };
  }

  if (existingMembership) {
    return {
      action: "existing",
      reason: "membership_exists",
      organization_id: organizationId,
      user_id: userId,
    };
  }

  return {
    action: "insert",
    reason: "backfillable",
    organization_id: organizationId,
    user_id: userId,
    doc: buildOwnerMembershipDoc({ org, user, now, id }),
  };
}

function createSummary({ apply }) {
  return {
    mode: apply ? "apply" : "dry-run",
    writesPerformed: !!apply,
    orgsScanned: 0,
    membershipsBackfillable: 0,
    membershipsExisting: 0,
    membershipsInserted: 0,
    skippedMissingOwner: 0,
    skippedMissingOrgId: 0,
    skippedUserMissing: 0,
    userLookupMissing: 0,
    samples: {
      backfillable: [],
      existing: [],
      skipped: [],
      userLookupMissing: [],
    },
  };
}

async function findUserById(users, userId) {
  if (!userId) return null;

  return users.findOne(
    { id: userId },
    {
      projection: {
        _id: 0,
        id: 1,
        email: 1,
        normalized_email: 1,
      },
    },
  );
}

export async function seedOwnerOrganizationMembers({
  orgs,
  users,
  organizationMembers,
  apply = false,
  now = new Date(),
  idFactory = randomUUID,
  sampleLimit = SAMPLE_LIMIT,
}) {
  const summary = createSummary({ apply });

  const cursor = orgs.find(
    {},
    {
      projection: {
        _id: 0,
        id: 1,
        user_id: 1,
        owner_user_id: 1,
        name: 1,
      },
    },
  );

  for await (const org of cursor) {
    summary.orgsScanned += 1;

    const organizationId = cleanStr(org?.id, 200);
    const userId = deriveOwnerUserId(org);

    if (!organizationId) {
      summary.skippedMissingOrgId += 1;
      pushSample(summary.samples.skipped, {
        reason: "missing_organization_id",
        user_id: userId || "",
      }, sampleLimit);
      continue;
    }

    if (!userId) {
      summary.skippedMissingOwner += 1;
      pushSample(summary.samples.skipped, {
        reason: "missing_owner_user_id",
        organization_id: organizationId,
        org_name: cleanStr(org?.name, 160),
      }, sampleLimit);
      continue;
    }

    const existingMembership = await organizationMembers.findOne(
      { organization_id: organizationId, user_id: userId },
      { projection: { _id: 0, id: 1 } },
    );

    const user = await findUserById(users, userId);
    if (!user) {
      summary.userLookupMissing += 1;
      pushSample(summary.samples.userLookupMissing, {
        organization_id: organizationId,
        user_id: userId,
      }, sampleLimit);
    }

    const plan = planOwnerMembership({
      org,
      existingMembership,
      user,
      now,
      id: idFactory(),
    });

    if (plan.action === "existing") {
      summary.membershipsExisting += 1;
      pushSample(summary.samples.existing, {
        organization_id: organizationId,
        user_id: userId,
      }, sampleLimit);
      continue;
    }

    if (plan.action !== "insert") {
      continue;
    }

    summary.membershipsBackfillable += 1;
    pushSample(summary.samples.backfillable, {
      organization_id: organizationId,
      user_id: userId,
      email_found: !!plan.doc.email,
    }, sampleLimit);

    if (apply) {
      const result = await organizationMembers.updateOne(
        { organization_id: organizationId, user_id: userId },
        { $setOnInsert: plan.doc },
        { upsert: true },
      );

      if (result.upsertedCount === 1) {
        summary.membershipsInserted += 1;
      } else {
        summary.membershipsExisting += 1;
      }
    }
  }

  return summary;
}
