import { describe, expect, it } from "vitest";
import {
  getPostDeleteErrorMessage,
  isPostDeleteDisabled,
} from "./postDeleteUi";

describe("getPostDeleteErrorMessage", () => {
  it("uses the actionable backend error message", () => {
    expect(
      getPostDeleteErrorMessage({
        statusCode: 429,
        message: "Google temporarily rate-limited this deletion. Please retry later.",
        errors: [{
          code: "google_post_delete_rate_limited",
          message: "Google temporarily rate-limited this deletion. Please retry later.",
        }],
      }),
    ).toBe(
      "Google temporarily rate-limited this deletion. Please retry later.",
    );
  });

  it("falls back without exposing arbitrary response data", () => {
    expect(getPostDeleteErrorMessage(new Error("Network Error"))).toBe(
      "Failed to delete post. Please try again.",
    );
  });
});

describe("isPostDeleteDisabled", () => {
  it("disables publishing posts", () => {
    expect(
      isPostDeleteDisabled({
        status: "publishing",
        postId: "post-1",
        deletingPostId: null,
      }),
    ).toBe(true);
  });

  it("disables only the row whose deletion is active", () => {
    const deletingPostIds = new Set(["post-1"]);
    expect(
      isPostDeleteDisabled({
        status: "published",
        postId: "post-1",
        deletingPostIds,
      }),
    ).toBe(true);
    expect(
      isPostDeleteDisabled({
        status: "published",
        postId: "post-2",
        deletingPostIds,
      }),
    ).toBe(false);
  });
});
