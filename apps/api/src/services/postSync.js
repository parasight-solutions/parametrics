import { createHash } from "node:crypto";
import { providerFieldsFromGooglePost } from "./postList.js";

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
  { posts, ensureAccessToken, listAccounts, listLocations, listLocalPosts },
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
  const eligible = [];
  for (const candidate of candidates) {
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
      if (Number(result?.upsertedCount || 0) === 1) inserted += 1;
      else {
        const outcome = outcomes.find((item) => item.postId === candidate.identity.postId);
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
    failed: 0,
    unusuallyLarge: fetched.unusuallyLarge,
    outcomes,
  };
}
