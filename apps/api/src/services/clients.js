// apps/api/src/services/clients.js
import crypto from "crypto";
import { col } from "../lib/mongo.js";

function cleanStr(value, max = 200) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function buildDefaultClientName(organizationName) {
  const name = cleanStr(organizationName, 200);
  return name || "Default Client";
}

export async function getClientById(clientId) {
  const id = cleanStr(clientId, 120);
  if (!id) return null;

  const clients = await col("clients");
  return clients.findOne({ id }, { projection: { _id: 0 } });
}

export async function getDefaultClientForOrganization(organizationId) {
  const orgId = cleanStr(organizationId, 120);
  if (!orgId) return null;

  const clients = await col("clients");
  return clients.findOne(
    { organization_id: orgId, is_default: true },
    { projection: { _id: 0 } }
  );
}

export function makeDefaultClientDoc({ organizationId, organizationName }) {
  const now = new Date();
  const orgId = cleanStr(organizationId, 120);

  if (!orgId) {
    throw new Error("organizationId is required to create a default client");
  }

  const name = buildDefaultClientName(organizationName);

  return {
    id: crypto.randomUUID(),
    organization_id: orgId,
    name,
    display_name: name,
    status: "active",
    is_default: true,
    created_at: now,
    updated_at: now,
  };
}

export async function getOrCreateDefaultClientForOrganization({
  organizationId,
  organizationName,
}) {
  const orgId = cleanStr(organizationId, 120);
  if (!orgId) {
    throw new Error("organizationId is required");
  }

  const clients = await col("clients");

  const existing = await clients.findOne(
    { organization_id: orgId, is_default: true },
    { projection: { _id: 0 } }
  );
  if (existing) return existing;

  const doc = makeDefaultClientDoc({
    organizationId: orgId,
    organizationName,
  });

  try {
    await clients.insertOne(doc);
    return doc;
  } catch (err) {
    if (err?.code === 11000) {
      const retry = await clients.findOne(
        { organization_id: orgId, is_default: true },
        { projection: { _id: 0 } }
      );
      if (retry) return retry;
    }
    throw err;
  }
}