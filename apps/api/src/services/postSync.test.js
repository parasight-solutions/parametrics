import test from "node:test";
import assert from "node:assert/strict";
import { deletePostWithProvider } from "./postDeletion.js";
import {
  buildGoogleRecoveryIdentity,
  buildImportedPost,
  fetchAllGoogleLocalPosts,
  recoverGooglePosts,
  validateGooglePostName,
} from "./postSync.js";

const location = {
  id: "loc-1",
  user_id: "user-1",
  organization_id: "org-1",
  client_id: "client-1",
  integration_id: "integration-1",
  provider_account_name: "accounts/123",
  provider_location_name: "locations/456",
};
const postName = "accounts/123/locations/456/localPosts/789";

test("validateGooglePostName accepts only the selected Google location resource", () => {
  assert.deepEqual(validateGooglePostName(postName, location), { valid: true, code: null });
  for (const [name, code] of [
    [null, "provider_post_name_missing"],
    ["not-a-resource", "provider_post_name_malformed"],
    ["accounts/999/locations/456/localPosts/789", "provider_post_name_scope_mismatch"],
    ["accounts/123/locations/999/localPosts/789", "provider_post_name_scope_mismatch"],
  ]) assert.deepEqual(validateGooglePostName(name, location), { valid: false, code });
});

test("fetchAllGoogleLocalPosts follows every token and rejects repeated tokens", async () => {
  const calls = [];
  const result = await fetchAllGoogleLocalPosts({ access: "token", location }, {
    listLocalPosts: async (_access, _account, _location, options) => {
      calls.push(options);
      return calls.length === 1
        ? { localPosts: [{ name: postName }], nextPageToken: "next" }
        : { localPosts: [{ name: `${postName}-2` }] };
    },
  });
  assert.equal(result.posts.length, 2);
  assert.deepEqual(calls, [{ pageSize: 100 }, { pageSize: 100, pageToken: "next" }]);
  await assert.rejects(
    fetchAllGoogleLocalPosts({ access: "token", location }, {
      listLocalPosts: async () => ({ localPosts: [], nextPageToken: "same" }),
    }),
    (error) => error.code === "google_posts_repeated_page_token",
  );
});

test("fetchAllGoogleLocalPosts enforces page and record bounds", async () => {
  await assert.rejects(
    fetchAllGoogleLocalPosts({ access: "token", location, maxPages: 1 }, {
      listLocalPosts: async () => ({ localPosts: [], nextPageToken: "next" }),
    }),
    (error) => error.code === "google_posts_page_limit",
  );
  await assert.rejects(
    fetchAllGoogleLocalPosts({ access: "token", location, maxPosts: 1 }, {
      listLocalPosts: async () => ({ localPosts: [{ name: postName }, { name: `${postName}-2` }] }),
    }),
    (error) => error.code === "google_posts_record_limit",
  );
});

function memoryPosts(seed = []) {
  const docs = seed.map((doc) => structuredClone(doc));
  let writes = 0;
  return {
    docs,
    get writes() { return writes; },
    async findRelevant() { return docs.map((doc) => structuredClone(doc)); },
    async findOne(filter) {
      const doc = docs.find((item) => item._id === filter._id);
      return doc ? structuredClone(doc) : null;
    },
    async updateOne(filter, update, options) {
      writes += 1;
      const existing = docs.find((doc) => doc._id === filter._id);
      if (existing) return { matchedCount: 1, upsertedCount: 0 };
      assert.deepEqual(Object.keys(update), ["$setOnInsert"]);
      assert.equal(options.upsert, true);
      docs.push(structuredClone(update.$setOnInsert));
      return { matchedCount: 0, upsertedCount: 1 };
    },
  };
}

function recoveryDeps(posts, pages) {
  let page = 0;
  return {
    posts,
    ensureAccessToken: async () => ({ access_token: "token" }),
    listAccounts: async () => ({ accounts: [{ name: location.provider_account_name }] }),
    listLocations: async () => ({ locations: [{ name: location.provider_location_name }] }),
    listLocalPosts: async () => pages[page++] || { localPosts: [] },
  };
}

test("recoverGooglePosts fetches all pages before touching MongoDB", async () => {
  const posts = memoryPosts();
  let reads = 0;
  posts.findRelevant = async () => { reads += 1; return []; };
  const deps = recoveryDeps(posts, [{ localPosts: [{ name: postName }], nextPageToken: "next" }]);
  deps.listLocalPosts = async (_a, _b, _c, options) => {
    if (options.pageToken) throw Object.assign(new Error("provider failed"), { code: "provider_failed" });
    return { localPosts: [{ name: postName }], nextPageToken: "next" };
  };
  await assert.rejects(recoverGooglePosts({ location, integration: { id: location.integration_id }, apply: true }, deps));
  assert.equal(reads, 0);
  assert.equal(posts.writes, 0);
});

test("recoverGooglePosts dry-run classifies missing, existing, invalid, duplicate, and conflicts without writes", async () => {
  const existing = { _id: "legacy", provider_post_name: `${postName}-existing`, ...location, location_id: location.id };
  const conflict = { _id: "foreign", provider_post_name: `${postName}-conflict`, user_id: "other" };
  const posts = memoryPosts([existing, conflict]);
  const duplicateName = `${postName}-duplicate`;
  const names = [postName, `${postName}-existing`, `${postName}-conflict`, "bad", duplicateName, duplicateName];
  const result = await recoverGooglePosts(
    { location, integration: { id: location.integration_id }, apply: false },
    recoveryDeps(posts, [{ localPosts: names.map((name) => ({ name })) }]),
  );
  assert.equal(result.eligible, 1);
  assert.equal(result.existing, 1);
  assert.equal(result.invalid, 3);
  assert.equal(result.conflicts, 1);
  assert.equal(result.inserted, 0);
  assert.equal(posts.writes, 0);
});

test("recoverGooglePosts apply is idempotent and concurrent calls converge", async () => {
  const posts = memoryPosts();
  const run = () => recoverGooglePosts(
    { location, integration: { id: location.integration_id }, apply: true, now: new Date("2026-11-19T10:00:00Z") },
    recoveryDeps(posts, [{ localPosts: [{ name: postName, summary: "Recovered" }] }]),
  );
  const [first, second] = await Promise.all([run(), run()]);
  assert.equal(first.inserted + second.inserted, 1);
  assert.equal(posts.docs.length, 1);
  assert.equal(posts.docs[0].status, "published");
  const rerun = await run();
  assert.equal(rerun.inserted, 0);
  assert.equal(rerun.existing, 1);
});

test("recoverGooglePosts stops before post listing when account or location access is missing", async () => {
  for (const missing of ["account", "location"]) {
    const posts = memoryPosts();
    let listed = 0;
    const deps = recoveryDeps(posts, []);
    deps.listLocalPosts = async () => { listed += 1; return { localPosts: [] }; };
    if (missing === "account") deps.listAccounts = async () => ({ accounts: [] });
    else deps.listLocations = async () => ({ locations: [] });
    await assert.rejects(
      recoverGooglePosts({ location, integration: { id: location.integration_id }, apply: true }, deps),
      (error) => error.code === `google_${missing}_inaccessible`,
    );
    assert.equal(listed, 0);
    assert.equal(posts.writes, 0);
  }
});

test("recoverGooglePosts reports deterministic id and duplicate local references as conflicts", async () => {
  const identity = buildGoogleRecoveryIdentity({ locationId: location.id, providerPostName: postName });
  for (const seed of [
    [{ _id: identity.mongoId, provider_post_name: `${postName}-other`, ...location, location_id: location.id }],
    [
      { _id: "legacy-1", id: "one", provider_post_name: postName, ...location, location_id: location.id },
      { _id: "legacy-2", id: "two", provider_post_name: postName, ...location, location_id: location.id },
    ],
  ]) {
    const posts = memoryPosts(seed);
    const result = await recoverGooglePosts(
      { location, integration: { id: location.integration_id }, apply: true },
      recoveryDeps(posts, [{ localPosts: [{ name: postName }] }]),
    );
    assert.equal(result.conflicts, 1);
    assert.equal(result.inserted, 0);
    assert.equal(posts.writes, 0);
  }
});

test("buildGoogleRecoveryIdentity is stable, scoped, versioned, and UUID-compatible", () => {
  const a = buildGoogleRecoveryIdentity({ locationId: location.id, providerPostName: postName });
  const again = buildGoogleRecoveryIdentity({ locationId: location.id, providerPostName: postName });
  const other = buildGoogleRecoveryIdentity({ locationId: "loc-2", providerPostName: postName });
  assert.deepEqual(a, again);
  assert.match(a.mongoId, /^google-post-recovery:v1:[0-9a-f]{64}$/);
  assert.match(a.postId, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notDeepEqual(a, other);
});

test("buildImportedPost maps a Google post to a deletion-compatible published record", () => {
  const now = new Date("2026-11-19T10:00:00.000Z");
  const identity = buildGoogleRecoveryIdentity({ locationId: location.id, providerPostName: postName });
  const doc = buildImportedPost({
    googlePost: {
      name: postName,
      searchUrl: "https://www.google.com/search?q=post",
      summary: "Recovered post",
      topicType: "STANDARD",
      languageCode: "en-US",
      media: [{ sourceUrl: "https://images.example/post.jpg" }],
      callToAction: { actionType: "LEARN_MORE", url: "https://example.com" },
      createTime: "2026-10-01T00:00:00Z",
      updateTime: "2026-10-02T00:00:00Z",
    },
    location,
    identity,
    now,
  });
  assert.equal(doc._id, identity.mongoId);
  assert.equal(doc.id, identity.postId);
  assert.equal(doc.status, "published");
  assert.equal(doc.origin, "google_imported");
  assert.equal(doc.provider_post_name, postName);
  assert.equal(doc.provider_post_url, "https://www.google.com/search?q=post");
  assert.equal(doc.image_url, "https://images.example/post.jpg");
  assert.equal(doc.user_id, location.user_id);
  assert.equal(doc.organization_id, location.organization_id);
  assert.equal(doc.client_id, location.client_id);
  assert.equal(doc.location_id, location.id);
  assert.equal(doc.integration_id, location.integration_id);
  assert.equal(doc.call_to_action_type, "LEARN_MORE");
  assert.equal(doc.call_to_action_url, "https://example.com");
  assert.equal(doc.scheduled_at, null);
  assert.equal(doc.provider_error, null);
  assert.equal(doc.created_at, now);
  for (const field of ["ai_status", "ai_history", "recurrence", "queue", "publish_attempts"]) {
    assert.equal(Object.hasOwn(doc, field), false);
  }
});

test("an imported post is accepted by the existing Google-first deletion flow", async () => {
  const now = new Date("2026-11-19T10:00:00Z");
  const identity = buildGoogleRecoveryIdentity({ locationId: location.id, providerPostName: postName });
  const imported = buildImportedPost({ googlePost: { name: postName }, location, identity, now });
  let doc = structuredClone(imported);
  const matches = (filter) => Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some(matches);
    if (value && typeof value === "object" && "$exists" in value) return value.$exists ? doc[key] !== undefined : doc[key] === undefined;
    if (value && typeof value === "object" && "$lte" in value) return doc[key] <= value.$lte;
    return doc[key] === value;
  });
  const apply = (update) => { Object.assign(doc, update.$set || {}); for (const key of Object.keys(update.$unset || {})) delete doc[key]; };
  const posts = {
    findOne: async (filter) => doc && matches(filter) ? structuredClone(doc) : null,
    findOneAndUpdate: async (filter, update) => { if (!doc || !matches(filter)) return { value: null }; apply(update); return { value: structuredClone(doc) }; },
    updateOne: async (filter, update) => { if (!doc || !matches(filter)) return { matchedCount: 0 }; apply(update); return { matchedCount: 1 }; },
    deleteOne: async (filter) => { if (!doc || !matches(filter)) return { deletedCount: 0 }; doc = null; return { deletedCount: 1 }; },
  };
  let deletedName;
  const result = await deletePostWithProvider({ post: imported, location, userId: location.user_id, now }, {
    posts,
    operationId: () => "operation-1",
    removePublishJob: async () => {},
    getIntegrationById: async () => ({ id: location.integration_id }),
    ensureAccessToken: async () => ({ access_token: "token" }),
    deleteLocalPost: async (_access, name) => { deletedName = name; },
  });
  assert.deepEqual(result, { ok: true, remote: "deleted" });
  assert.equal(deletedName, postName);
  assert.equal(doc, null);
});
