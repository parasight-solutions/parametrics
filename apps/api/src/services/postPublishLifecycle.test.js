import test from "node:test";
import assert from "node:assert/strict";
import {
  claimPostForPublishing,
  markPostPublished,
  markPostPublishFailure,
} from "./postPublishLifecycle.js";

function matches(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === "object" && "$in" in expected) {
      return expected.$in.includes(doc[key]);
    }
    return doc[key] === expected;
  });
}

function applyUpdate(doc, update) {
  Object.assign(doc, update.$set || {});
  for (const key of Object.keys(update.$unset || {})) delete doc[key];
}

function makePosts(initial) {
  const state = { doc: structuredClone(initial) };
  return {
    state,
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
  };
}

const basePost = {
  id: "post-1",
  user_id: "user-1",
  organization_id: "org-1",
  client_id: "client-1",
  location_id: "location-1",
  status: "queued",
};

const scope = {
  id: "post-1",
  user_id: "user-1",
  organization_id: "org-1",
  client_id: "client-1",
  location_id: "location-1",
};

test("claimPostForPublishing atomically claims only queued or retrying posts", async () => {
  for (const status of ["queued", "retrying"]) {
    const posts = makePosts({ ...basePost, status });
    const claimed = await claimPostForPublishing(posts, {
      postId: "post-1",
      userId: "user-1",
      attemptId: "attempt-1",
      now: new Date("2026-11-19T10:00:00Z"),
    });
    assert.equal(claimed.status, "publishing");
    assert.equal(claimed.publish_attempt_id, "attempt-1");
  }

  for (const status of [
    "scheduled",
    "publishing",
    "published",
    "deleting",
    "failed",
  ]) {
    const posts = makePosts({ ...basePost, status });
    const claimed = await claimPostForPublishing(posts, {
      postId: "post-1",
      userId: "user-1",
      attemptId: "attempt-1",
    });
    assert.equal(claimed, null, status);
    assert.equal(posts.state.doc.status, status);
  }
});

test("publish success requires the current publishing attempt", async () => {
  const posts = makePosts({
    ...basePost,
    status: "publishing",
    publish_attempt_id: "attempt-1",
  });
  assert.equal(
    await markPostPublished(posts, {
      scope,
      attemptId: "stale-attempt",
      providerFields: {
        provider_post_name: "accounts/1/locations/2/localPosts/3",
      },
    }),
    false,
  );
  assert.equal(posts.state.doc.status, "publishing");

  assert.equal(
    await markPostPublished(posts, {
      scope,
      attemptId: "attempt-1",
      providerFields: {
        provider_post_name: "accounts/1/locations/2/localPosts/3",
      },
    }),
    true,
  );
  assert.equal(posts.state.doc.status, "published");
  assert.equal(posts.state.doc.publish_attempt_id, undefined);
});

test("failure and retry updates cannot overwrite deleting or a newer attempt", async () => {
  for (const nextStatus of ["failed", "retrying"]) {
    const deleting = makePosts({
      ...basePost,
      status: "deleting",
      publish_attempt_id: "attempt-1",
    });
    assert.equal(
      await markPostPublishFailure(deleting, {
        scope,
        attemptId: "attempt-1",
        status: nextStatus,
        providerError: "provider failed",
      }),
      false,
    );
    assert.equal(deleting.state.doc.status, "deleting");

    const newer = makePosts({
      ...basePost,
      status: "publishing",
      publish_attempt_id: "attempt-2",
    });
    assert.equal(
      await markPostPublishFailure(newer, {
        scope,
        attemptId: "attempt-1",
        status: nextStatus,
        providerError: "stale failure",
      }),
      false,
    );
    assert.equal(newer.state.doc.publish_attempt_id, "attempt-2");
  }
});
