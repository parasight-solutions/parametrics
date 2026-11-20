import { createHash } from "node:crypto";
import { providerFieldsFromGooglePost } from "./postList.js";
import { findPostDeletionTombstones } from "./postDeletionTombstones.js";

const ID_NAMESPACE = "google-post-recovery:v1";

function recoveryError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateGooglePostName(name, location = {}) {
  if (typeof name !== "string" || !name.trim()) return { valid: false, code: "provider_post_name_missing" };
  const value = name.trim();
  if (!/^accounts\/[^/]+\/locations\/[^/]+\/localPosts\/[^/]+$/.test(value)) {
    return { valid: false, code: "provider_post_name_malformed" };
  }
  const prefix = `${location.provider_account_name}/${location.provider_location_name}/localPosts/`;
  return value.startsWith(prefix)
    ? { valid: true, code: null }
    : { valid: false, code: "provider_post_name_scope_mismatch" };
}

export function buildGoogleRecoveryIdentity({ locationId, providerPostName }) {
  const digest = createHash("sha256")
    .update(`${ID_NAMESPACE}|location:${locationId}|post:${providerPostName}`, "utf8")
    .digest();
  const uuid = Buffer.from(digest.subarray(0, 16));
  uuid[6] = (uuid[6] & 0x0f) | 0x80;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;
  const hex = uuid.toString("hex");
  return {
    mongoId: `${ID_NAMESPACE}:${digest.toString("hex")}`,
    postId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  };
}

function httpsUrl(value) {
  if (typeof value !== "string") return null;
  try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; }
}

export function buildImportedPost({ googlePost, location, identity, now = new Date() }) {
  const provider = providerFieldsFromGooglePost(googlePost);
  return {
    _id: identity.mongoId,
    id: identity.postId,
    user_id: location.user_id,
    organization_id: location.organization_id,
    client_id: location.client_id,
    location_id: location.id,
    integration_id: location.integration_id,
    provider_account_name: location.provider_account_name,
    provider_location_name: location.provider_location_name,
    ...provider,
    summary: String(googlePost.summary || ""),
    image_url: httpsUrl(googlePost.media?.[0]?.sourceUrl),
    topic_type: googlePost.topicType || null,
    language_code: googlePost.languageCode || null,
    call_to_action_type: googlePost.callToAction?.actionType || null,
    call_to_action_url: httpsUrl(googlePost.callToAction?.url),
    status: "published",
    origin: "google_imported",
    provider_error: null,
    scheduled_at: null,
    provider_created_at: googlePost.createTime || null,
    provider_updated_at: googlePost.updateTime || null,
    synced_at: now,
    imported_at: now,
    created_at: now,
    updated_at: now,
  };
}

export function buildGoogleOwnedPostPatch({ googlePost, existingPost, now = new Date() }) {
  const patch = { synced_at: now, provider_sync_status: "present" };
  const has = (key) => Object.prototype.hasOwnProperty.call(googlePost, key);
  if (has("summary")) patch.summary = String(googlePost.summary || "");
  if (has("media")) patch.image_url = httpsUrl(googlePost.media?.[0]?.sourceUrl);
  if (has("callToAction")) {
    patch.call_to_action_type = googlePost.callToAction?.actionType || null;
    patch.call_to_action_url = httpsUrl(googlePost.callToAction?.url);
  }
  if (has("searchUrl")) patch.provider_post_url = providerFieldsFromGooglePost(googlePost).provider_post_url;
  if (has("topicType")) patch.topic_type = googlePost.topicType || null;
  if (has("languageCode")) patch.language_code = googlePost.languageCode || null;
  if (has("createTime")) patch.provider_created_at = googlePost.createTime || null;
  if (has("updateTime")) patch.provider_updated_at = googlePost.updateTime || null;
  if (existingPost?.provider_missing_since) patch.provider_missing_since = null;
  return patch;
}

export async function fetchAllGoogleLocalPosts(
  { access, location, pageSize = 100, maxPages = 100, maxPosts = 10_000 },
  { listLocalPosts },
) {
  const posts = [];
  const seenTokens = new Set();
  let pageToken;
  let pages = 0;
  do {
    if (pages >= maxPages) throw recoveryError("google_posts_page_limit", "Google post page limit exceeded.");
    const response = await listLocalPosts(
      access,
      location.provider_account_name,
      location.provider_location_name,
      { pageSize, ...(pageToken ? { pageToken } : {}) },
    );
    pages += 1;
    posts.push(...(Array.isArray(response?.localPosts) ? response.localPosts : []));
    if (posts.length > maxPosts) throw recoveryError("google_posts_record_limit", "Google post record limit exceeded.");
    const next = String(response?.nextPageToken || "").trim();
    if (next && seenTokens.has(next)) throw recoveryError("google_posts_repeated_page_token", "Google repeated a page token.");
    if (next) seenTokens.add(next);
    pageToken = next || undefined;
  } while (pageToken);
  return { posts, pages, unusuallyLarge: pages > 50 || posts.length > 5000 };
}

function sameScope(doc, location) {
  return [
    ["user_id", location.user_id],
    ["organization_id", location.organization_id],
    ["client_id", location.client_id],
    ["location_id", location.id],
    ["integration_id", location.integration_id],
    ["provider_account_name", location.provider_account_name],
    ["provider_location_name", location.provider_location_name],
  ].every(([key, expected]) => doc[key] === expected);
}

async function findRelevantPosts(posts, names, ids) {
  if (typeof posts.findRelevant === "function") return posts.findRelevant({ names, ids });
  const cursor = posts.find({ $or: [
    { provider_post_name: { $in: names } },
    { _id: { $in: ids } },
  ] });
  return typeof cursor?.toArray === "function" ? cursor.toArray() : [];
}

function visibleAccount(accounts, name) {
  return (accounts || []).some((account) => account?.name === name);
}

export async function recoverGooglePosts(
  { location, integration, apply = false, now = new Date() },
  { posts, tombstones, ensureAccessToken, listAccounts, listLocations, listLocalPosts },
) {
  if (!integration || integration.id !== location.integration_id) {
    throw recoveryError("google_integration_mismatch", "The bound Google integration is unavailable.");
  }
  const token = await ensureAccessToken(integration);
  const access = token?.access_token || token;
  const accounts = await listAccounts(access);
  if (!visibleAccount(accounts?.accounts, location.provider_account_name)) {
    throw recoveryError("google_account_inaccessible", "The Google account is not accessible.");
  }
  const locations = await listLocations(access, location.provider_account_name);
  if (!(locations?.locations || []).some((item) => item?.name === location.provider_location_name)) {
    throw recoveryError("google_location_inaccessible", "The Google location is not accessible.");
  }
  const fetched = await fetchAllGoogleLocalPosts({ access, location }, { listLocalPosts });

  const counts = new Map();
  for (const item of fetched.posts) {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  const candidates = [];
  const outcomes = [];
  for (const googlePost of fetched.posts) {
    const validation = validateGooglePostName(googlePost?.name, location);
    if (!validation.valid) {
      outcomes.push({ outcome: "invalid", code: validation.code, providerPostName: googlePost?.name || null });
      continue;
    }
    if (counts.get(googlePost.name) > 1) {
      outcomes.push({ outcome: "invalid", code: "provider_post_name_duplicate", providerPostName: googlePost.name });
      continue;
    }
    const identity = buildGoogleRecoveryIdentity({ locationId: location.id, providerPostName: googlePost.name });
    candidates.push({ googlePost, identity });
  }
  const local = await findRelevantPosts(
    posts,
    candidates.map(({ googlePost }) => googlePost.name),
    candidates.map(({ identity }) => identity.mongoId),
  );
  const tombstoneMap = tombstones
    ? await findPostDeletionTombstones(tombstones, { providerPostNames: candidates.map(({ googlePost }) => googlePost.name) })
    : new Map();
  const eligible = [];
  for (const candidate of candidates) {
    if (tombstoneMap.has(candidate.googlePost.name)) {
      outcomes.push({ outcome: "tombstone_skipped", providerPostName: candidate.googlePost.name });
      continue;
    }
    const nameMatches = local.filter((doc) => doc.provider_post_name === candidate.googlePost.name);
    const idMatch = local.find((doc) => doc._id === candidate.identity.mongoId);
    if (nameMatches.length > 1 || nameMatches.some((doc) => !sameScope(doc, location)) ||
        (idMatch && (idMatch.provider_post_name !== candidate.googlePost.name || !sameScope(idMatch, location)))) {
      outcomes.push({ outcome: "conflict", code: "local_provider_reference_conflict", providerPostName: candidate.googlePost.name });
    } else if (nameMatches.length === 1 || idMatch) {
      outcomes.push({ outcome: "existing", providerPostName: candidate.googlePost.name, postId: (nameMatches[0] || idMatch).id });
    } else {
      eligible.push(candidate);
      outcomes.push({ outcome: "eligible", providerPostName: candidate.googlePost.name, postId: candidate.identity.postId });
    }
  }

  let inserted = 0;
  if (apply) {
    for (const candidate of eligible) {
      const document = buildImportedPost({ ...candidate, location, now });
      const result = await posts.updateOne(
        { _id: candidate.identity.mongoId },
        { $setOnInsert: document },
        { upsert: true },
      );
      const outcome = outcomes.find((item) => item.postId === candidate.identity.postId);
      const afterTombstones = tombstones
        ? await findPostDeletionTombstones(tombstones, { providerPostNames: [candidate.googlePost.name] })
        : new Map();
      if (afterTombstones.has(candidate.googlePost.name)) {
        if (typeof posts.deleteOne === "function") {
          await posts.deleteOne({
            _id: candidate.identity.mongoId,
            provider_post_name: candidate.googlePost.name,
            location_id: location.id,
            origin: "google_imported",
            status: "published",
          });
        }
        if (outcome) outcome.outcome = "tombstone_skipped";
      } else if (Number(result?.upsertedCount || 0) === 1) inserted += 1;
      else {
        const concurrent = typeof posts.findOne === "function"
          ? await posts.findOne({ _id: candidate.identity.mongoId })
          : null;
        if (concurrent && (concurrent.provider_post_name !== candidate.googlePost.name || !sameScope(concurrent, location))) {
          if (outcome) {
            outcome.outcome = "conflict";
            outcome.code = "local_provider_reference_conflict";
          }
        } else if (outcome) outcome.outcome = "existing";
      }
    }
  }
  return {
    mode: apply ? "apply" : "dry-run",
    location: { id: location.id, providerAccountName: location.provider_account_name, providerLocationName: location.provider_location_name },
    pages: fetched.pages,
    providerTotal: fetched.posts.length,
    existing: outcomes.filter((item) => item.outcome === "existing").length,
    eligible: outcomes.filter((item) => item.outcome === "eligible").length,
    inserted,
    invalid: outcomes.filter((item) => item.outcome === "invalid").length,
    conflicts: outcomes.filter((item) => item.outcome === "conflict").length,
    tombstoneSkipped: outcomes.filter((item) => item.outcome === "tombstone_skipped").length,
    failed: 0,
    unusuallyLarge: fetched.unusuallyLarge,
    outcomes,
  };
}

async function findScopedPosts(posts, location) {
  if (typeof posts.findScoped === "function") return posts.findScoped(location);
  return posts.find({
    user_id: location.user_id,
    organization_id: location.organization_id,
    client_id: location.client_id,
    location_id: location.id,
  }).toArray();
}

function changedFields(existing, patch) {
  return Object.entries(patch).some(([key, value]) => key !== "synced_at" && existing[key] !== value);
}

export async function syncGooglePosts(
  { location, integration, now = new Date() },
  { posts, tombstones, ensureAccessToken, listAccounts, listLocations, listLocalPosts },
) {
  if (!integration || integration.id !== location.integration_id) throw recoveryError("google_integration_mismatch");
  const token = await ensureAccessToken(integration);
  const access = token?.access_token || token;
  const accounts = await listAccounts(access);
  if (!visibleAccount(accounts?.accounts, location.provider_account_name)) throw recoveryError("google_account_inaccessible");
  const visibleLocations = await listLocations(access, location.provider_account_name);
  if (!(visibleLocations?.locations || []).some((item) => item?.name === location.provider_location_name)) throw recoveryError("google_location_inaccessible");
  const fetched = await fetchAllGoogleLocalPosts({ access, location }, { listLocalPosts });
  const nameCounts = new Map();
  for (const remote of fetched.posts) if (remote?.name) nameCounts.set(remote.name, (nameCounts.get(remote.name) || 0) + 1);
  const valid = fetched.posts.filter((remote) => validateGooglePostName(remote?.name, location).valid && nameCounts.get(remote.name) === 1);
  const names = valid.map((remote) => remote.name);
  const identities = valid.map((remote) => buildGoogleRecoveryIdentity({ locationId: location.id, providerPostName: remote.name }));
  const [relevant, scoped, initialTombstones] = await Promise.all([
    findRelevantPosts(posts, names, identities.map((item) => item.mongoId)),
    findScopedPosts(posts, location),
    tombstones ? findPostDeletionTombstones(tombstones, { providerPostNames: names }) : new Map(),
  ]);
  const summary = { fetched: fetched.posts.length, inserted: 0, updated: 0, unchanged: 0, missingOnGoogle: 0, tombstoneSkipped: 0, skipped: fetched.posts.length - valid.length, conflicts: 0 };
  const remoteNames = new Set(names);
  for (let index = 0; index < valid.length; index += 1) {
    const remote = valid[index];
    const identity = identities[index];
    if (initialTombstones.has(remote.name)) { summary.tombstoneSkipped += 1; continue; }
    const matches = relevant.filter((doc) => doc.provider_post_name === remote.name);
    const idMatch = relevant.find((doc) => doc._id === identity.mongoId);
    if (matches.length > 1 || matches.some((doc) => !sameScope(doc, location)) || (idMatch && (idMatch.provider_post_name !== remote.name || !sameScope(idMatch, location)))) {
      summary.conflicts += 1; continue;
    }
    const existing = matches[0] || idMatch;
    if (!existing) {
      const document = buildImportedPost({ googlePost: remote, location, identity, now });
      const result = await posts.updateOne({ _id: identity.mongoId }, { $setOnInsert: document }, { upsert: true });
      const after = tombstones ? await findPostDeletionTombstones(tombstones, { providerPostNames: [remote.name] }) : new Map();
      if (after.has(remote.name)) {
        await posts.deleteOne({ _id: identity.mongoId, provider_post_name: remote.name, location_id: location.id, origin: "google_imported", status: "published" });
        summary.tombstoneSkipped += 1;
      } else if (Number(result?.upsertedCount || 0) === 1) summary.inserted += 1;
      else summary.unchanged += 1;
      continue;
    }
    if (existing.status !== "published") { summary.conflicts += 1; continue; }
    const patch = buildGoogleOwnedPostPatch({ googlePost: remote, existingPost: existing, now });
    if (!changedFields(existing, patch)) { summary.unchanged += 1; continue; }
    const update = { $set: { ...patch, updated_at: now } };
    if (patch.provider_missing_since === null) { delete update.$set.provider_missing_since; update.$unset = { provider_missing_since: "" }; }
    const result = await posts.updateOne({
      _id: existing._id,
      user_id: location.user_id,
      organization_id: location.organization_id,
      client_id: location.client_id,
      location_id: location.id,
      integration_id: location.integration_id,
      provider_account_name: location.provider_account_name,
      provider_location_name: location.provider_location_name,
      status: "published",
      provider_post_name: remote.name,
    }, update);
    if (Number(result?.matchedCount || 0) === 1) summary.updated += 1; else summary.conflicts += 1;
  }
  for (const existing of scoped) {
    if (existing.status !== "published" || !validateGooglePostName(existing.provider_post_name, location).valid || remoteNames.has(existing.provider_post_name)) continue;
    const result = await posts.updateOne(
      {
        _id: existing._id,
        user_id: location.user_id,
        organization_id: location.organization_id,
        client_id: location.client_id,
        location_id: location.id,
        integration_id: location.integration_id,
        status: "published",
        provider_post_name: existing.provider_post_name,
      },
      { $set: { provider_sync_status: "missing", provider_missing_since: existing.provider_missing_since || now, synced_at: now, updated_at: now } },
    );
    if (Number(result?.matchedCount || 0) === 1) summary.missingOnGoogle += 1; else summary.conflicts += 1;
  }
  return { summary, pages: fetched.pages };
}
