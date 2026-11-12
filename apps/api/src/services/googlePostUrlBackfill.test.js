import test from "node:test";
import assert from "node:assert/strict";
import { backfillGooglePostUrls } from "./googlePostUrlBackfill.js";

function makePosts(rows) {
  const updates = [];
  return {
    updates,
    find() {
      return { toArray: async () => rows };
    },
    async updateOne(filter, update) {
      updates.push({ filter, update });
      return { modifiedCount: 1 };
    },
  };
}

function dependencies({ rows, pages = [], getPost } = {}) {
  const posts = makePosts(rows);
  let pageIndex = 0;
  return {
    posts,
    locations: {
      findOne: async ({ id, user_id }) => ({
        id,
        user_id,
        integration_id: "integration-1",
        provider_account_name: "accounts/1",
        provider_location_name: "locations/2",
      }),
    },
    getIntegrationById: async () => ({ id: "integration-1" }),
    ensureAccessToken: async () => ({ access_token: "secret-token" }),
    listLocalPosts: async () => pages[pageIndex++] || { localPosts: [] },
    getLocalPost: getPost || (async () => ({})),
  };
}

const candidate = {
  id: "post-1",
  user_id: "user-1",
  location_id: "location-1",
  integration_id: "integration-1",
  status: "published",
  provider_post_name: "accounts/1/locations/2/localPosts/3",
};

test("backfill dry-run follows list pagination and never writes", async () => {
  const deps = dependencies({
    rows: [candidate],
    pages: [
      { localPosts: [], nextPageToken: "page-2" },
      {
        localPosts: [
          {
            name: candidate.provider_post_name,
            searchUrl: "https://posts.gle/public-post",
          },
        ],
      },
    ],
  });

  const summary = await backfillGooglePostUrls({ ...deps, apply: false });

  assert.deepEqual(summary, {
    mode: "dry-run",
    candidates: 1,
    matched: 1,
    updated: 0,
    unavailable: 0,
    failed: 0,
    skipped: 0,
  });
  assert.equal(deps.posts.updates.length, 0);
});

test("backfill apply uses exact-name fallback and only fills a missing URL", async () => {
  const deps = dependencies({
    rows: [candidate],
    pages: [{ localPosts: [] }],
    getPost: async (_token, name) => ({
      name,
      searchUrl: "https://posts.gle/fallback-post",
    }),
  });

  const summary = await backfillGooglePostUrls({ ...deps, apply: true });

  assert.equal(summary.matched, 1);
  assert.equal(summary.updated, 1);
  assert.deepEqual(deps.posts.updates, [
    {
      filter: {
        id: "post-1",
        user_id: "user-1",
        provider_post_url: { $in: [null, ""] },
      },
      update: {
        $set: {
          provider_post_url: "https://posts.gle/fallback-post",
          updated_at: deps.posts.updates[0].update.$set.updated_at,
        },
      },
    },
  ]);
  assert.ok(deps.posts.updates[0].update.$set.updated_at instanceof Date);
});

test("backfill counts missing URLs and incomplete post scope without writing", async () => {
  const missingScope = { ...candidate, id: "post-2", location_id: "" };
  const deps = dependencies({ rows: [candidate, missingScope] });

  const summary = await backfillGooglePostUrls({ ...deps, apply: true });

  assert.equal(summary.candidates, 2);
  assert.equal(summary.unavailable, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.failed, 0);
  assert.equal(deps.posts.updates.length, 0);
});

test("backfill counts an update failure and continues with the remaining posts", async () => {
  const secondCandidate = {
    ...candidate,
    id: "post-2",
    provider_post_name: "accounts/1/locations/2/localPosts/4",
  };
  const deps = dependencies({
    rows: [candidate, secondCandidate],
    pages: [
      {
        localPosts: [candidate, secondCandidate].map((post) => ({
          name: post.provider_post_name,
          searchUrl: `https://posts.gle/${post.id}`,
        })),
      },
    ],
  });
  let attempts = 0;
  deps.posts.updateOne = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("database unavailable");
    return { modifiedCount: 1 };
  };

  const summary = await backfillGooglePostUrls({ ...deps, apply: true });

  assert.equal(summary.matched, 2);
  assert.equal(summary.updated, 1);
  assert.equal(summary.failed, 1);
  assert.equal(attempts, 2);
});

test("backfill prefers the location's current integration after reconnection", async () => {
  const deps = dependencies({
    rows: [{ ...candidate, integration_id: "stale-integration" }],
    pages: [{ localPosts: [] }],
  });
  let requestedIntegrationId = null;
  deps.getIntegrationById = async (_userId, integrationId) => {
    requestedIntegrationId = integrationId;
    return { id: integrationId };
  };

  await backfillGooglePostUrls({ ...deps, apply: false });

  assert.equal(requestedIntegrationId, "integration-1");
});
