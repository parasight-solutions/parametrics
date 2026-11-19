function cliError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function parsePostRecoveryArgs(argv = []) {
  const locationArgs = argv.filter((arg) => arg.startsWith("--location-id="));
  const applyFlags = argv.filter((arg) => arg === "--apply");
  const dryRunFlags = argv.filter((arg) => arg === "--dry-run");
  const known = argv.every((arg) => arg.startsWith("--location-id=") || arg === "--apply" || arg === "--dry-run");
  const locationId = locationArgs[0]?.slice("--location-id=".length).trim();
  if (!known || locationArgs.length !== 1 || !locationId || applyFlags.length > 1 || dryRunFlags.length > 1 || (applyFlags.length && dryRunFlags.length)) {
    throw cliError("invalid_recovery_arguments", "Use exactly one --location-id=<id> and optionally --apply or --dry-run.");
  }
  return { locationId, apply: applyFlags.length === 1 };
}

function validateLocation(location) {
  const fields = ["id", "user_id", "organization_id", "client_id", "integration_id", "provider_account_name", "provider_location_name"];
  if (!location || location.provider !== "google" || fields.some((field) => !String(location[field] || "").trim()) ||
      !/^accounts\/[^/]+$/.test(location.provider_account_name) || !/^locations\/[^/]+$/.test(location.provider_location_name)) {
    throw cliError("recovery_location_scope_incomplete", "The selected location has incomplete Google or tenancy scope.");
  }
}

function membershipCanOperate(membership, location) {
  if (!membership || membership.status !== "active") return false;
  if (["owner", "admin"].includes(membership.role)) return true;
  return membership.role === "manager" && (
    membership.assigned_location_ids?.includes(location.id) ||
    membership.assigned_client_ids?.includes(location.client_id)
  );
}

export async function runPostRecoveryCli(
  { locationId, apply = false },
  { locations, organizationMembers, getIntegrationById, recoverGooglePosts, recoveryDependencies = {} },
) {
  const location = await locations.findOne({ id: locationId, provider: "google" });
  if (!location) throw cliError("recovery_location_not_found", "The selected Google location was not found.");
  validateLocation(location);
  const membership = await organizationMembers.findOne({
    organization_id: location.organization_id,
    user_id: location.user_id,
    status: "active",
  });
  if (!membershipCanOperate(membership, location)) {
    throw cliError("organization_membership_required", "The location owner lacks active operation access.");
  }
  const integration = await getIntegrationById(location.user_id, location.integration_id);
  if (!integration || integration.id !== location.integration_id || integration.active === false || integration.needs_reauth === true) {
    throw cliError("google_integration_unavailable", "The location's Google integration is unavailable.");
  }
  return recoverGooglePosts({ location, integration, apply }, recoveryDependencies);
}
