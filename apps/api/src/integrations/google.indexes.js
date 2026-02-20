// apps/api/src/integrations/google.indexes.js
import { col } from "../lib/mongo.js";

const KEY_USER_PROVIDER = JSON.stringify({ user_id: 1, provider: 1 });
const KEY_USER_PROVIDER_SUBJECT = JSON.stringify({ user_id: 1, provider: 1, provider_subject: 1 });
const KEY_USER_PROVIDER_IS_ACTIVE = JSON.stringify({ user_id: 1, provider: 1, is_active: 1 });

let lastRunAt = 0;
const MIN_INTERVAL_MS = 10_000; // avoid hammering during dev reloads

function keyStr(k) {
  try { return JSON.stringify(k || {}); } catch { return ""; }
}

export async function ensureGoogleIntegrationIndexes() {
  const now = Date.now();
  if (now - lastRunAt < MIN_INTERVAL_MS) return;
  lastRunAt = now;

  const c = await col("integrations");
  const indexes = await c.indexes();

  // 1) Drop legacy UNIQUE index on { user_id, provider } (this breaks multi-account)
  for (const idx of indexes) {
    if (!idx?.unique) continue;
    if (idx?.name === "_id_") continue;

    if (keyStr(idx.key) === KEY_USER_PROVIDER) {
      try {
        await c.dropIndex(idx.name);
        console.warn("[integrations.indexes] dropped legacy unique index:", idx.name);
      } catch (e) {
        // if it's already gone or another process raced, ignore
        console.warn("[integrations.indexes] dropIndex failed:", idx.name, e?.message || e);
      }
    }
  }

  // refresh list after potential drop
  const fresh = await c.indexes();

  // 2) Ensure unique index on (user_id, provider, provider_subject) exists
  // IMPORTANT: do NOT specify "name" to avoid IndexOptionsConflict.
  const hasUserProviderSubject = fresh.some(
    (i) => i?.unique && keyStr(i.key) === KEY_USER_PROVIDER_SUBJECT
  );

  if (!hasUserProviderSubject) {
    await c.createIndex(
      { user_id: 1, provider: 1, provider_subject: 1 },
      {
        unique: true,
        partialFilterExpression: { provider_subject: { $type: "string" } },
      }
    );
    console.warn("[integrations.indexes] created index: user_id+provider+provider_subject unique partial");
  }

  // 3) Ensure "only one default connection" unique partial exists
  const hasUserProviderIsActive = fresh.some(
    (i) => i?.unique && keyStr(i.key) === KEY_USER_PROVIDER_IS_ACTIVE
  );

  if (!hasUserProviderIsActive) {
    await c.createIndex(
      { user_id: 1, provider: 1, is_active: 1 },
      {
        unique: true,
        partialFilterExpression: { is_active: true, active: true },
      }
    );
    console.warn("[integrations.indexes] created index: user_id+provider+is_active unique partial");
  }
}
