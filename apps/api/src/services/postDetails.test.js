import test from "node:test";
import assert from "node:assert/strict";
import { getPostDetailsForUser } from "./postDetails.js";

const storedPost = {
  _id: "mongo-internal-id",
  id: "post-1",
  user_id: "user-1",
  organization_id: "org-1",
  client_id: "client-1",
  location_id: "location-1",
  summary: "A post",
  image_url: "https://example.com/image.jpg",
  call_to_action_url: "https://example.com/action",
  call_to_action_type: "LEARN_MORE",
  topic_type: "STANDARD",
  language_code: "en-US",
  status: "draft",
  scheduled_at: null,
  integration_id: "integration-1",
  provider_post_name: null,
  provider_post_url: null,
  provider_error: null,
  created_at: new Date("2026-11-13T10:00:00.000Z"),
  updated_at: new Date("2026-11-13T10:05:00.000Z"),
};

function dependencies(post = storedPost) {
  const calls = { access: [], scope: [] };
  return {
    calls,
    posts: {
      async findOne(filter) {
        if (post?.id === filter.id && post?.user_id === filter.user_id) return post;
        return null;
      },
    },
    async requireLocationAccess(input) {
      calls.access.push(input);
      return {
        location: {
          id: "location-1",
          title: "Downtown",
          organization_id: "org-1",
          client_id: "client-1",
        },
      };
    },
    assertScope(postInput, locationInput, resourceName) {
      calls.scope.push({ postInput, locationInput, resourceName });
    },
  };
}

test("single-post read returns a sanitized public post and validates read scope", async () => {
  const deps = dependencies();

  const post = await getPostDetailsForUser(
    { userId: "user-1", postId: "post-1" },
    deps,
  );

  assert.deepEqual(post, {
    id: "post-1",
    user_id: "user-1",
    organization_id: "org-1",
    client_id: "client-1",
    location_id: "location-1",
    location: { id: "location-1", title: "Downtown" },
    summary: "A post",
    image_url: "https://example.com/image.jpg",
    call_to_action_url: "https://example.com/action",
    call_to_action_type: "LEARN_MORE",
    topic_type: "STANDARD",
    language_code: "en-US",
    status: "draft",
    scheduled_at: null,
    integration_id: "integration-1",
    provider_post_name: null,
    provider_post_url: null,
    provider_error: null,
    created_at: new Date("2026-11-13T10:00:00.000Z"),
    updated_at: new Date("2026-11-13T10:05:00.000Z"),
  });
  assert.equal("_id" in post, false);
  assert.deepEqual(deps.calls.access, [{
    userId: "user-1",
    locationId: "location-1",
    provider: "google",
    allowedRoles: ["owner", "admin", "manager", "viewer"],
  }]);
  assert.equal(deps.calls.scope.length, 1);
  assert.equal(deps.calls.scope[0].resourceName, "post");
});

test("single-post read hides missing and foreign-user posts behind not_found", async () => {
  for (const input of [
    { userId: "user-1", postId: "missing" },
    { userId: "user-2", postId: "post-1" },
    { userId: "user-1", postId: "" },
  ]) {
    await assert.rejects(
      () => getPostDetailsForUser(input, dependencies()),
      (error) => error?.status === 404 && error?.code === "not_found",
    );
  }
});

test("single-post read propagates canonical scope validation failures", async () => {
  const deps = dependencies();
  deps.assertScope = () => {
    const error = new Error("post_scope_mismatch");
    error.status = 403;
    error.code = "post_scope_mismatch";
    throw error;
  };

  await assert.rejects(
    () => getPostDetailsForUser({ userId: "user-1", postId: "post-1" }, deps),
    (error) => error?.status === 403 && error?.code === "post_scope_mismatch",
  );
});

test("single-post read hides a post when location read access is unavailable", async () => {
  const deps = dependencies();
  deps.requireLocationAccess = async () => {
    const error = new Error("organization_role_required");
    error.status = 403;
    error.code = "organization_role_required";
    throw error;
  };

  await assert.rejects(
    () => getPostDetailsForUser({ userId: "user-1", postId: "post-1" }, deps),
    (error) => error?.status === 404 && error?.code === "not_found",
  );
});
