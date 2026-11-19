import test from "node:test";
import assert from "node:assert/strict";
import { deletePostWithProvider } from "./postDeletion.js";
import { claimPostForPublishing } from "./postPublishLifecycle.js";

function matchesValue(actual, expected) {
  if (!expected || typeof expected !== "object" || expected instanceof Date)
    return actual === expected;
  if ("$in" in expected) return expected.$in.includes(actual);
  if ("$exists" in expected)
    return expected.$exists ? actual !== undefined : actual === undefined;
  if ("$lte" in expected)
    return actual instanceof Date && actual <= expected.$lte;
  return actual === expected;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return expected.some((part) => matches(doc, part));
    return matchesValue(doc?.[key], expected);
  });
}

function applyUpdate(doc, update) {
  Object.assign(doc, update.$set || {});
  for (const key of Object.keys(update.$unset || {})) delete doc[key];
}

function makePosts(initial, { failDeleteOnce = false } = {}) {
  const state = {
    doc: initial ? structuredClone(initial) : null,
    deleteAttempts: 0,
  };
  return {
    state,
    async findOne(filter) {
      return state.doc && matches(state.doc, filter)
        ? structuredClone(state.doc)
        : null;
    },
    async findOneAndUpdate(filter, update) {
      if (!state.doc || !matches(state.doc, filter)) return { value: null };
      applyUpdate(state.doc, update);
      return { value: structuredClone(state.doc) };
    },
    async updateOne(filter, update) {
      if (!state.doc || !matches(state.doc, filter))
        return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(state.doc, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(filter) {
      state.deleteAttempts += 1;
      if (failDeleteOnce && state.deleteAttempts === 1)
        throw new Error("database unavailable");
      if (!state.doc || !matches(state.doc, filter)) return { deletedCount: 0 };
      state.doc = null;
      return { deletedCount: 1 };
    },
  };
}

const now = new Date("2026-11-19T10:00:00Z");
const location = {
  id: "location-1",
  user_id: "user-1",
  organization_id: "org-1",
  client_id: "client-1",
  integration_id: "integration-1",
  provider_account_name: "accounts/123",
  provider_location_name: "locations/456",
};
const basePost = {
  id: "post-1",
  user_id: "user-1",
  organization_id: "org-1",
  client_id: "client-1",
  location_id: "location-1",
  integration_id: "integration-1",
  provider_account_name: "accounts/123",
  provider_location_name: "locations/456",
  provider_post_name: null,
  status: "queued",
};
const remoteName = "accounts/123/locations/456/localPosts/789";

function dependencies(posts, overrides = {}) {
  const calls = { jobs: 0, google: 0, tokens: 0, integrations: 0 };
  return {
    calls,
    deps: {
      posts,
      leaseMs: 30_000,
      operationId: () => "delete-operation-1",
      removePublishJob: async () => {
        calls.jobs += 1;
      },
      getIntegrationById: async (_userId, integrationId) => {
        calls.integrations += 1;
        return { id: integrationId };
      },
      ensureAccessToken: async () => {
        calls.tokens += 1;
        return { access_token: "test-access-token" };
      },
      deleteLocalPost: async (_access, name) => {
        calls.google += 1;
        assert.equal(name, remoteName);
        return {};
      },
      ...overrides,
    },
  };
}

async function run(post, deps, at = now) {
  return deletePostWithProvider(
    { post, location, userId: "user-1", now: at },
    deps,
  );
}

test("scheduled and queued posts are cancelled and removed without Google deletion", async () => {
  for (const status of ["scheduled", "queued", "retrying"]) {
    const post = { ...basePost, status };
    const posts = makePosts(post);
    const { calls, deps } = dependencies(posts);
    const result = await run(post, deps);
    assert.deepEqual(result, { ok: true, remote: "not_required" });
    assert.equal(posts.state.doc, null);
    assert.equal(calls.jobs, 1);
    assert.equal(calls.google, 0);
  }
});

test("publishing posts cannot be claimed for deletion", async () => {
  const post = {
    ...basePost,
    status: "publishing",
    publish_attempt_id: "attempt-1",
  };
  const posts = makePosts(post);
  const { deps } = dependencies(posts);
  await assert.rejects(
    run(post, deps),
    (error) => error.status === 409 && error.code === "post_publishing",
  );
  assert.equal(posts.state.doc.status, "publishing");
});

test("a post outside the authenticated user scope is rejected without mutation", async () => {
  const post = { ...basePost, user_id: "user-2" };
  const posts = makePosts(post);
  const { calls, deps } = dependencies(posts);
  await assert.rejects(
    run(post, deps),
    (error) => error.status === 409 && error.code === "post_scope_mismatch",
  );
  assert.equal(posts.state.doc.status, "queued");
  assert.equal(calls.jobs, 0);
  assert.equal(calls.google, 0);
});

test("uncoordinated draft generation posts are not claimed for deletion", async () => {
  const post = { ...basePost, status: "draft" };
  const posts = makePosts(post);
  const { deps } = dependencies(posts);
  await assert.rejects(
    run(post, deps),
    (error) =>
      error.status === 409 && error.code === "post_delete_status_conflict",
  );
  assert.equal(posts.state.doc.status, "draft");
});

test("a deletion claim prevents a worker from claiming the same queued post", async () => {
  const post = { ...basePost, status: "queued" };
  const posts = makePosts(post);
  const { deps } = dependencies(posts, {
    removePublishJob: async () => {
      const workerClaim = await claimPostForPublishing(posts, {
        postId: post.id,
        userId: post.user_id,
        attemptId: "worker-attempt",
        now,
      });
      assert.equal(workerClaim, null);
    },
  });
  await run(post, deps);
  assert.equal(posts.state.doc, null);
});

test("published posts use the bound integration and exact provider resource", async () => {
  const post = {
    ...basePost,
    status: "published",
    provider_post_name: remoteName,
  };
  const posts = makePosts(post);
  let integrationArgs = null;
  let tokenIntegration = null;
  const { calls, deps } = dependencies(posts, {
    getIntegrationById: async (...args) => {
      integrationArgs = args;
      return { id: "integration-1" };
    },
    ensureAccessToken: async (integration) => {
      tokenIntegration = integration;
      return { access_token: "test-access-token" };
    },
  });
  const result = await run(post, deps);
  assert.deepEqual(result, { ok: true, remote: "deleted" });
  assert.deepEqual(integrationArgs, ["user-1", "integration-1"]);
  assert.deepEqual(tokenIntegration, { id: "integration-1" });
  assert.equal(calls.google, 1);
  assert.equal(posts.state.doc, null);
});

test("published posts with missing, malformed, or mismatched provider references require reconciliation", async () => {
  const variants = [
    { provider_post_name: null },
    { provider_post_name: "post-uuid" },
    { provider_post_name: "accounts/999/locations/456/localPosts/789" },
    { provider_post_name: remoteName, integration_id: "integration-other" },
    { provider_post_name: remoteName, provider_location_name: "locations/999" },
  ];
  for (const patch of variants) {
    const post = { ...basePost, status: "published", ...patch };
    const posts = makePosts(post);
    const { calls, deps } = dependencies(posts);
    await assert.rejects(
      run(post, deps),
      (error) =>
        error.status === 409 &&
        error.code === "post_delete_reconciliation_required",
    );
    assert.ok(posts.state.doc);
    assert.equal(calls.google, 0);
  }
});

test("validated Google 404 permits local cleanup", async () => {
  const post = {
    ...basePost,
    status: "published",
    provider_post_name: remoteName,
  };
  const posts = makePosts(post);
  const { deps } = dependencies(posts, {
    deleteLocalPost: async () => {
      const error = new Error("google_http_error");
      error.status = 404;
      error.body = { error: { code: 404 } };
      throw error;
    },
  });
  assert.deepEqual(await run(post, deps), { ok: true, remote: "absent" });
  assert.equal(posts.state.doc, null);
});

test("temporary and permission Google failures preserve the post and allow retry", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const post = {
      ...basePost,
      status: "published",
      provider_post_name: remoteName,
    };
    const posts = makePosts(post);
    let fail = true;
    const { calls, deps } = dependencies(posts, {
      deleteLocalPost: async () => {
        calls.google += 1;
        if (fail) {
          const error = new Error("google_http_error");
          error.status = status;
          throw error;
        }
        return {};
      },
    });
    await assert.rejects(run(post, deps), (error) =>
      error.code.startsWith("google_post_delete_"),
    );
    assert.equal(posts.state.doc.status, "deleting");
    assert.equal(posts.state.doc.deletion_operation_id, undefined);
    fail = false;
    const retryPost = structuredClone(posts.state.doc);
    assert.deepEqual(
      await run(retryPost, deps, new Date(now.getTime() + 1000)),
      { ok: true, remote: "deleted" },
    );
    assert.equal(calls.google, 2);
  }
});

test("unexpected Google 400 is not treated as remote absence", async () => {
  const post = {
    ...basePost,
    status: "published",
    provider_post_name: remoteName,
  };
  const posts = makePosts(post);
  const { deps } = dependencies(posts, {
    deleteLocalPost: async () => {
      const error = new Error("google_http_error");
      error.status = 400;
      throw error;
    },
  });
  await assert.rejects(
    run(post, deps),
    (error) => error.code === "google_post_delete_failed",
  );
  assert.ok(posts.state.doc);
});

test("Google token refresh failures return an actionable auth error and remain retryable", async () => {
  const post = {
    ...basePost,
    status: "published",
    provider_post_name: remoteName,
  };
  const posts = makePosts(post);
  const { calls, deps } = dependencies(posts, {
    ensureAccessToken: async () => {
      const error = new Error("reauth_required");
      error.code = "reauth_required";
      error.status = 409;
      throw error;
    },
  });

  await assert.rejects(
    run(post, deps),
    (error) =>
      error.code === "google_post_delete_auth_failed" &&
      /Reconnect/.test(error.message),
  );
  assert.equal(posts.state.doc.status, "deleting");
  assert.equal(posts.state.doc.deletion_operation_id, undefined);
  assert.equal(calls.google, 0);
});

test("MongoDB failure after Google deletion resumes without a second Google call", async () => {
  const post = {
    ...basePost,
    status: "published",
    provider_post_name: remoteName,
  };
  const posts = makePosts(post, { failDeleteOnce: true });
  const { calls, deps } = dependencies(posts);
  await assert.rejects(
    run(post, deps),
    (error) => error.code === "post_local_delete_failed",
  );
  assert.ok(posts.state.doc.provider_deleted_at instanceof Date);
  assert.equal(posts.state.doc.deletion_operation_id, undefined);

  const retryPost = structuredClone(posts.state.doc);
  assert.deepEqual(await run(retryPost, deps, new Date(now.getTime() + 1000)), {
    ok: true,
    remote: "already_deleted",
  });
  assert.equal(calls.google, 1);
  assert.equal(posts.state.doc, null);
});

test("duplicate deletion conflicts during a live lease and resumes after expiry", async () => {
  const deleting = {
    ...basePost,
    status: "deleting",
    deletion_previous_status: "published",
    provider_post_name: remoteName,
    deletion_operation_id: "active-operation",
    deletion_operation_expires_at: new Date(now.getTime() + 30_000),
  };
  const posts = makePosts(deleting);
  const { calls, deps } = dependencies(posts);
  await assert.rejects(
    run(deleting, deps),
    (error) =>
      error.status === 409 && error.code === "post_deletion_in_progress",
  );
  assert.equal(calls.google, 0);

  const afterExpiry = new Date(now.getTime() + 31_000);
  const retryPost = structuredClone(posts.state.doc);
  assert.deepEqual(await run(retryPost, deps, afterExpiry), {
    ok: true,
    remote: "deleted",
  });
  assert.equal(calls.google, 1);
});
