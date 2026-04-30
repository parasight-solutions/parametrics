import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeLocationBinding,
  resolveCanonicalLocationScope,
} from "./locationBinding.js";

test("resolveCanonicalLocationScope prefers canonical location fields over legacy map", () => {
  const out = resolveCanonicalLocationScope(
    {
      id: "loc_1",
      organization_id: "org_canonical",
      client_id: "client_1",
      org_id: "org_legacy_location",
    },
    {
      location_id: "loc_1",
      organization_id: "org_legacy_map",
      org_id: "org_legacy_map_alt",
    }
  );

  assert.equal(out.effective.organization_id, "org_canonical");
  assert.equal(out.effective.client_id, "client_1");
  assert.equal(out.effective.source, "locations");
  assert.equal(out.canonical.is_complete, true);
});

test("resolveCanonicalLocationScope falls back to legacy org only for compatibility", () => {
  const out = resolveCanonicalLocationScope(
    {
      id: "loc_2",
      client_id: "client_2",
    },
    {
      location_id: "loc_2",
      org_id: "org_legacy",
    }
  );

  assert.equal(out.effective.organization_id, "org_legacy");
  assert.equal(out.effective.client_id, "client_2");
  assert.equal(out.effective.source, "legacy");
  assert.equal(out.canonical.is_complete, false);
});

test("normalizeLocationBinding exposes canonical and legacy compatibility shapes", () => {
  const out = normalizeLocationBinding({
    locationId: "loc_3",
    organizationId: "org_3",
    clientId: "client_3",
  });

  assert.deepEqual(out.canonical, {
    location_id: "loc_3",
    organization_id: "org_3",
    client_id: "client_3",
  });
  assert.equal(out.org_id, "org_3");
  assert.equal(out.legacy.location_org_map.organization_id, "org_3");
});

