// apps/api/src/services/ownership.js
import { col } from "../lib/mongo.js";

function cleanStr(value, max = 500) {
    const v = String(value ?? "").trim();
    if (!v) return "";
    return v.length > max ? v.slice(0, max) : v;
}

function makeError(status, code, message, data = null) {
    const err = new Error(message || code);
    err.status = status;
    err.code = code;
    err.data = data;
    return err;
}

export function toApiError(res, err, fallbackCode = "server_error") {
    const status = Number(err?.status || 500);
    const code = cleanStr(err?.code, 120) || fallbackCode;
    const message = cleanStr(err?.message, 500) || fallbackCode;

    const body = { error: { code, message } };
    if (err?.data) body.error.data = err.data;

    return res.status(status).json(body);
}

export function ensureLocationTenancy(locationDoc) {
    if (!locationDoc) {
        throw makeError(404, "not_found", "location not found");
    }

    const organizationId = cleanStr(locationDoc.organization_id, 200);
    const clientId = cleanStr(locationDoc.client_id, 200);

    if (!organizationId || !clientId) {
        throw makeError(
            409,
            "location_not_scoped",
            "location is missing organization/client scope"
        );
    }

    return locationDoc;
}

export async function requireOwnedLocation(userId, locationId, opts = {}) {
    const uid = cleanStr(userId, 200);
    const lid = cleanStr(locationId, 200);
    const provider = cleanStr(opts.provider, 100);

    if (!uid || !lid) {
        throw makeError(400, "bad_request", "locationId required");
    }

    const q = { user_id: uid, id: lid };
    if (provider) q.provider = provider;

    const locations = await col("locations");
    const loc = await locations.findOne(q);

    if (!loc) {
        throw makeError(404, "not_found", "location not found");
    }

    return ensureLocationTenancy(loc);
}

export function buildLocationScopeFilter(locationDoc, extra = {}) {
    const loc = ensureLocationTenancy(locationDoc);

    return {
        user_id: loc.user_id,
        organization_id: loc.organization_id,
        client_id: loc.client_id,
        location_id: loc.id,
        ...extra,
    };
}

export function assertDocMatchesLocationScope(doc, locationDoc, entityName = "resource") {
    const loc = ensureLocationTenancy(locationDoc);

    if (!doc) {
        throw makeError(404, "not_found", `${entityName} not found`);
    }

    const docLocationId = cleanStr(doc.location_id, 200);
    const docOrgId = cleanStr(doc.organization_id, 200);
    const docClientId = cleanStr(doc.client_id, 200);

    if (docLocationId !== cleanStr(loc.id, 200)) {
        throw makeError(
            409,
            "scope_mismatch",
            `${entityName} does not match location scope`,
            {
                entity: entityName,
                expected_location_id: loc.id,
                got_location_id: docLocationId || null,
            }
        );
    }

    if (docOrgId !== cleanStr(loc.organization_id, 200)) {
        throw makeError(
            409,
            "scope_mismatch",
            `${entityName} does not match organization scope`,
            {
                entity: entityName,
                expected_organization_id: loc.organization_id,
                got_organization_id: docOrgId || null,
            }
        );
    }

    if (docClientId !== cleanStr(loc.client_id, 200)) {
        throw makeError(
            409,
            "scope_mismatch",
            `${entityName} does not match client scope`,
            {
                entity: entityName,
                expected_client_id: loc.client_id,
                got_client_id: docClientId || null,
            }
        );
    }

    return doc;
}