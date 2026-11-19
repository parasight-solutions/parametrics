import test from "node:test";
import assert from "node:assert/strict";
import { deleteLocalPost } from "./google.js";

const POST_NAME = "accounts/123/locations/456/localPosts/789";

function withFetch(response, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return response;
  };
  return Promise.resolve()
    .then(() => run(calls))
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

test("deleteLocalPost sends the exact Google DELETE request without a body", async () => {
  await withFetch(
    { ok: true, status: 204, text: async () => "" },
    async (calls) => {
      const result = await deleteLocalPost(
        { access_token: "test-access-token" },
        POST_NAME,
      );

      assert.deepEqual(result, {});
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0][0],
        `https://mybusiness.googleapis.com/v4/${POST_NAME}`,
      );
      assert.equal(calls[0][1].method, "DELETE");
      assert.equal(
        calls[0][1].headers.Authorization,
        "Bearer test-access-token",
      );
      assert.equal("body" in calls[0][1], false);
      assert.ok(calls[0][1].signal instanceof AbortSignal);
    },
  );
});

test("deleteLocalPost rejects malformed names before making a request", async () => {
  for (const name of [
    "",
    "post-uuid",
    "accounts/1/locations/2",
    "accounts/1/locations/2/localPosts",
  ]) {
    await withFetch(
      { ok: true, status: 204, text: async () => "" },
      async (calls) => {
        await assert.rejects(
          deleteLocalPost("test-access-token", name),
          (error) => error.code === "invalid_local_post_name",
        );
        assert.equal(calls.length, 0);
      },
    );
  }
});

test("deleteLocalPost preserves Google status and parsed error details", async () => {
  const body = {
    error: { code: 404, message: "Requested entity was not found." },
  };
  await withFetch(
    { ok: false, status: 404, text: async () => JSON.stringify(body) },
    async () => {
      await assert.rejects(
        deleteLocalPost("test-access-token", POST_NAME),
        (error) => error.status === 404 && error.body?.error?.code === 404,
      );
    },
  );
});
