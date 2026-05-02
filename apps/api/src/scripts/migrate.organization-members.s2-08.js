import "../startup/env.js";
import { closeDb, col } from "../lib/mongo.js";
import { seedOwnerOrganizationMembers } from "../services/organizationMembersSeedMigration.js";

const argv = new Set(process.argv.slice(2));
const apply = argv.has("--apply");

function json(value) {
  return JSON.stringify(value, null, 2);
}

async function main() {
  const orgs = await col("orgs");
  const users = await col("users");
  const organizationMembers = await col("organization_members");

  const summary = await seedOwnerOrganizationMembers({
    orgs,
    users,
    organizationMembers,
    apply,
  });

  console.log(json({
    task: "S2-08 organization_members owner seed migration",
    ...summary,
  }));
}

main()
  .catch((err) => {
    console.error("[s2-08 organization members migration] failed", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
