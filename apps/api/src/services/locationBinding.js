function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

export function normalizeLocationBinding({ locationId, organizationId, clientId }) {
  const locId = cleanStr(locationId, 200);
  const orgId = cleanStr(organizationId, 200);
  const cId = cleanStr(clientId, 200);

  return {
    location_id: locId,
    organization_id: orgId,
    client_id: cId,
    org_id: orgId,
    canonical: {
      location_id: locId,
      organization_id: orgId,
      client_id: cId,
    },
    legacy: {
      org_id: orgId,
      location_org_map: {
        location_id: locId,
        org_id: orgId,
        organization_id: orgId,
      },
    },
  };
}

export function resolveCanonicalLocationScope(locationDoc, legacyMap = null) {
  const locationId = cleanStr(locationDoc?.id || legacyMap?.location_id, 200);
  const organizationId = cleanStr(locationDoc?.organization_id, 200);
  const clientId = cleanStr(locationDoc?.client_id, 200);
  const legacyLocationOrgId = cleanStr(locationDoc?.org_id, 200);
  const legacyMapOrganizationId = cleanStr(legacyMap?.organization_id, 200);
  const legacyMapOrgId = cleanStr(legacyMap?.org_id, 200);
  const legacyOrgId = legacyLocationOrgId || legacyMapOrganizationId || legacyMapOrgId;

  return {
    location_id: locationId || null,
    canonical: {
      organization_id: organizationId || null,
      client_id: clientId || null,
      is_complete: Boolean(organizationId && clientId),
    },
    legacy: {
      org_id: legacyLocationOrgId || null,
      map_organization_id: legacyMapOrganizationId || null,
      map_org_id: legacyMapOrgId || null,
    },
    effective: {
      organization_id: organizationId || legacyOrgId || null,
      client_id: clientId || null,
      source: organizationId ? "locations" : legacyOrgId ? "legacy" : null,
      is_complete: Boolean((organizationId || legacyOrgId) && clientId),
    },
  };
}

