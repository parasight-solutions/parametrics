// apps/api/src/scripts/seed.local-review.s2-31.js
//
// LOCAL / DEV REVIEW ONLY. Seeds an auth-compatible review owner, a review
// organization, memberships, and searchable "Mahesh" candidate users so the
// Organization Members page (S2-31) can be reviewed in a browser with a real
// email/password login.
//
// Usage (from apps/api):
//   node src/scripts/seed.local-review.s2-31.js            # dry run (no writes)
//   node src/scripts/seed.local-review.s2-31.js --apply    # create/reset fixtures
//   node src/scripts/seed.local-review.s2-31.js --cleanup  # remove fixtures
//
// Login after --apply: review-owner@example.com / Review123! (fixture-only
// credential on a reserved example domain; never use outside local review).
//
// Safety:
// - Refuses to run unless MONGODB_URI/MONGO_URI points at localhost/127.0.0.1.
// - Refuses when NODE_ENV=production.
// - Only touches documents whose ids start with "s2-31-review-".
// - Aborts if a fixture email already belongs to a different user id.
// - Never prints password hashes, tokens, or raw user documents.
import "../startup/env.js";
import bcrypt from "bcryptjs";
import { closeDb, col } from "../lib/mongo.js";

const PREFIX = "s2-31-review-";
const ORG_ID = `${PREFIX}org`;
const OWNER_ID = `${PREFIX}owner`;
const OWNER_EMAIL = "review-owner@example.com";
const OWNER_PASSWORD = "Review123!";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// Users the login + members page need. `password` is the field auth.js reads;
// `password_hash` is kept identical for older tooling that looks for it.
const FIXTURE_USERS = Object.freeze([
  { id: OWNER_ID, full_name: "Review Owner", email: OWNER_EMAIL, login: true },
  { id: `${PREFIX}mahesh`, full_name: "Mahesh Kumar", email: "mahesh.kumar@example.com" },
  { id: `${PREFIX}maheshwari`, full_name: "Maheshwari Rao", email: "maheshwari.rao@example.com" },
  { id: `${PREFIX}mahesh-member`, full_name: "Mahesh Existing", email: "mahesh.existing@example.com" },
  { id: `${PREFIX}priya`, full_name: "Priya Manager", email: "priya.manager@example.com" },
  { id: `${PREFIX}mahesh-disabled`, full_name: "Mahesh Disabled", email: "mahesh.disabled@example.com", disabled: true },
]);

// Memberships the review org starts with. Re-running --apply resets the review
// org to exactly this set (rows added during a review are removed).
const FIXTURE_MEMBERSHIPS = Object.freeze([
  { id: `${PREFIX}m-owner`, user_id: OWNER_ID, role: "owner" },
  { id: `${PREFIX}m-priya`, user_id: `${PREFIX}priya`, role: "manager" },
  { id: `${PREFIX}m-mahesh-member`, user_id: `${PREFIX}mahesh-member`, role: "viewer" },
]);

function mongoHost() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
  if (uri.startsWith("mongodb+srv://")) return { host: "(srv)", local: false };
  const afterScheme = uri.replace(/^mongodb:\/\//, "");
  const hostPart = afterScheme.split("@").pop().split(/[/?]/)[0];
  const host = hostPart.split(",")[0].replace(/:\d+$/, "");
  return { host, local: LOCAL_HOSTS.has(host) };
}

export function assertLocalReviewEnvironment(env = process.env) {
  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error("refusing to run with NODE_ENV=production");
  }
  const { host, local } = mongoHost();
  if (!local) {
    throw new Error(`refusing to run against non-local MongoDB host (${host}); set MONGODB_URI=mongodb://127.0.0.1:27017`);
  }
  return host;
}

async function findEmailConflicts(users) {
  const conflicts = [];
  for (const u of FIXTURE_USERS) {
    const normalized = u.email.toLowerCase();
    const other = await users.findOne(
      { normalized_email: normalized, id: { $ne: u.id } },
      { projection: { _id: 0, id: 1 } },
    );
    if (other) conflicts.push({ fixture_id: u.id, existing_user_id: other.id });
  }
  return conflicts;
}

async function applyFixtures({ users, orgs, organizationMembers, organizations }) {
  const now = new Date();
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);
  let usersUpserted = 0;

  for (const u of FIXTURE_USERS) {
    const set = {
      id: u.id,
      email: u.email,
      normalized_email: u.email.toLowerCase(),
      full_name: u.full_name,
      role: "individual",
      status: u.disabled ? "disabled" : "active",
      disabled: Boolean(u.disabled),
      local_review_fixture: "s2-31",
      updated_at: now,
    };
    if (u.login) {
      set.password = passwordHash;
      set.password_hash = passwordHash;
    }
    const r = await users.updateOne(
      { id: u.id },
      { $set: set, $setOnInsert: { created_at: now } },
      { upsert: true },
    );
    usersUpserted += r.upsertedCount + r.modifiedCount;
  }

  await orgs.updateOne(
    { id: ORG_ID },
    {
      $set: {
        id: ORG_ID,
        user_id: OWNER_ID,
        owner_user_id: OWNER_ID,
        name: "S2-31 Review Org",
        slug: "s2-31-review-org",
        status: "active",
        local_review_fixture: "s2-31",
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true },
  );

  const keepUserIds = FIXTURE_MEMBERSHIPS.map((m) => m.user_id);
  const reset = await organizationMembers.deleteMany({
    organization_id: ORG_ID,
    user_id: { $nin: keepUserIds },
  });

  for (const m of FIXTURE_MEMBERSHIPS) {
    await organizationMembers.updateOne(
      { organization_id: ORG_ID, user_id: m.user_id },
      {
        $set: {
          role: m.role,
          status: "active",
          assigned_client_ids: [],
          assigned_location_ids: [],
          updated_at: now,
        },
        $setOnInsert: {
          id: m.id,
          organization_id: ORG_ID,
          user_id: m.user_id,
          invited_by_user_id: null,
          created_at: now,
        },
      },
      { upsert: true },
    );
  }

  // An earlier hand-written seed put the review org in an `organizations`
  // collection the app never reads; remove only that exact stray fixture id.
  const stray = await organizations.deleteMany({ id: ORG_ID });

  return {
    users_upserted_or_updated: usersUpserted,
    review_org_memberships_reset_removed: reset.deletedCount,
    stray_organizations_docs_removed: stray.deletedCount,
  };
}

async function cleanupFixtures({ users, orgs, organizationMembers, organizations }) {
  const idFilter = { $regex: `^${PREFIX}` };
  const m = await organizationMembers.deleteMany({ organization_id: ORG_ID });
  const o = await orgs.deleteMany({ id: ORG_ID });
  const s = await organizations.deleteMany({ id: ORG_ID });
  const u = await users.deleteMany({ id: idFilter });
  return {
    memberships_removed: m.deletedCount,
    orgs_removed: o.deletedCount,
    stray_organizations_docs_removed: s.deletedCount,
    users_removed: u.deletedCount,
  };
}

async function summarize({ users, orgs, organizationMembers }) {
  const owner = await users.findOne({ id: OWNER_ID }, { projection: { _id: 0, password: 1, status: 1 } });
  return {
    review_org_present: (await orgs.countDocuments({ id: ORG_ID })) === 1,
    review_org_memberships: await organizationMembers.countDocuments({ organization_id: ORG_ID }),
    fixture_users: await users.countDocuments({ id: { $regex: `^${PREFIX}` } }),
    owner_login_ready: Boolean(owner?.password) && owner?.status === "active"
      && (await bcrypt.compare(OWNER_PASSWORD, owner.password)),
    owner_active_owner_membership: (await organizationMembers.countDocuments({
      organization_id: ORG_ID,
      user_id: OWNER_ID,
      role: "owner",
      status: "active",
    })) === 1,
  };
}

async function main() {
  const argv = new Set(process.argv.slice(2));
  const apply = argv.has("--apply");
  const cleanup = argv.has("--cleanup");
  if (apply && cleanup) throw new Error("use either --apply or --cleanup, not both");

  const host = assertLocalReviewEnvironment();
  const collections = {
    users: await col("users"),
    orgs: await col("orgs"),
    organizationMembers: await col("organization_members"),
    organizations: await col("organizations"),
  };

  const mode = apply ? "apply" : cleanup ? "cleanup" : "dry-run";
  const out = { script: "seed.local-review.s2-31", mode, mongo_host: host };

  if (cleanup) {
    out.removed = await cleanupFixtures(collections);
  } else {
    const conflicts = await findEmailConflicts(collections.users);
    if (conflicts.length) {
      out.conflicts = conflicts;
      console.log(JSON.stringify(out, null, 2));
      throw new Error("fixture email already used by a different user id; no writes performed");
    }
    if (apply) out.writes = await applyFixtures(collections);
  }

  out.state = await summarize(collections);
  if (apply) out.login = { email: OWNER_EMAIL, password: "(see script header)" };
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((err) => {
    console.error("[s2-31 local review seed] failed:", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
