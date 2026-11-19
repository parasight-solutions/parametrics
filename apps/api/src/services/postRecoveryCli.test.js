import test from "node:test";
import assert from "node:assert/strict";
import { parsePostRecoveryArgs, runPostRecoveryCli } from "./postRecoveryCli.js";

test("parsePostRecoveryArgs defaults to dry-run and requires one location", () => {
  assert.deepEqual(parsePostRecoveryArgs(["--location-id=loc-1"]), { locationId: "loc-1", apply: false });
  assert.deepEqual(parsePostRecoveryArgs(["--location-id=loc-1", "--apply"]), { locationId: "loc-1", apply: true });
  assert.deepEqual(parsePostRecoveryArgs(["--location-id=loc-1", "--dry-run"]), { locationId: "loc-1", apply: false });
  for (const args of [[], ["--location-id="], ["--location-id=a", "--location-id=b"], ["--unknown"], ["--location-id=a", "--apply", "--dry-run"], ["--location-id=a", "--token=secret"]]) {
    assert.throws(() => parsePostRecoveryArgs(args), (error) => error.code === "invalid_recovery_arguments");
  }
});

const location = {
  id: "loc-1", provider: "google", user_id: "user-1", organization_id: "org-1",
  client_id: "client-1", integration_id: "integration-1",
  provider_account_name: "accounts/123", provider_location_name: "locations/456",
};

test("runPostRecoveryCli validates stored scope and membership before recovery", async () => {
  let called = 0;
  const result = await runPostRecoveryCli({ locationId: location.id, apply: false }, {
    locations: { findOne: async () => location },
    organizationMembers: { findOne: async () => ({ status: "active", role: "owner", user_id: location.user_id, organization_id: location.organization_id }) },
    getIntegrationById: async () => ({ id: location.integration_id }),
    recoverGooglePosts: async ({ apply }) => { called += 1; return { mode: apply ? "apply" : "dry-run" }; },
  });
  assert.equal(called, 1);
  assert.equal(result.mode, "dry-run");
});

test("runPostRecoveryCli rejects incomplete, unauthorized, and missing integration scope", async () => {
  const base = {
    locations: { findOne: async () => location },
    organizationMembers: { findOne: async () => null },
    getIntegrationById: async () => null,
    recoverGooglePosts: async () => assert.fail("must not recover"),
  };
  await assert.rejects(runPostRecoveryCli({ locationId: "loc-1" }, base), (e) => e.code === "organization_membership_required");
  await assert.rejects(runPostRecoveryCli({ locationId: "missing" }, { ...base, locations: { findOne: async () => null } }), (e) => e.code === "recovery_location_not_found");
  const incomplete = { ...location, client_id: "" };
  await assert.rejects(runPostRecoveryCli({ locationId: "loc-1" }, { ...base, locations: { findOne: async () => incomplete } }), (e) => e.code === "recovery_location_scope_incomplete");
  await assert.rejects(runPostRecoveryCli({ locationId: "loc-1" }, {
    ...base,
    organizationMembers: { findOne: async () => ({ status: "active", role: "owner" }) },
  }), (e) => e.code === "google_integration_unavailable");
});
