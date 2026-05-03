import "../startup/env.js";
import { closeDb, col } from "../lib/mongo.js";
import {
  applyOrganizationMemberFixturePlan,
  buildOrganizationMemberFixturePlan,
  summarizeOrganizationMemberFixtures,
} from "../services/organizationMemberFixtures.js";

const argv = new Set(process.argv.slice(2));
const apply = argv.has("--apply");

function json(value) {
  return JSON.stringify(value, null, 2);
}

async function main() {
  const orgs = await col("orgs");
  const organizationMembers = await col("organization_members");
  const now = new Date();
  const plan = await buildOrganizationMemberFixturePlan({
    orgs,
    organizationMembers,
    now,
  });

  if (plan.conflicts.length > 0) {
    console.log(json(summarizeOrganizationMemberFixtures(plan, { apply: false })));
    throw new Error("S2-15 fixture conflicts detected; no writes performed");
  }

  let writes = null;
  if (apply) {
    writes = await applyOrganizationMemberFixturePlan({
      orgs,
      organizationMembers,
      plan,
      now,
    });
  }

  console.log(json(summarizeOrganizationMemberFixtures(plan, { apply, writes })));
}

main()
  .catch((err) => {
    console.error("[s2-15 organization member fixtures] failed", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
