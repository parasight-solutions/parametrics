import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewSyncDocument } from "./reviewSyncDocument.js";

test("synced review documents retain the complete authorized tenant scope", () => {
  const updatedAt = new Date("2026-11-25T10:00:00.000Z");
  assert.deepEqual(buildReviewSyncDocument({
    userId: "user-1",
    locationId: "location-1",
    location: {
      organization_id: "org-1",
      client_id: "client-1",
      integration_id: "integration-1",
      provider_account_name: "accounts/1",
      provider_location_name: "locations/1",
    },
    review: {
      name: "locations/1/reviews/1",
      starRating: "FIVE",
      comment: "Excellent",
      reviewer: { displayName: "Ada" },
      createTime: "2026-11-24T10:00:00Z",
      updateTime: "2026-11-25T09:00:00Z",
      reviewReply: null,
    },
    updatedAt,
  }), {
    user_id: "user-1",
    organization_id: "org-1",
    client_id: "client-1",
    location_id: "location-1",
    provider: "google",
    integration_id: "integration-1",
    provider_account_name: "accounts/1",
    provider_location_name: "locations/1",
    provider_review_name: "locations/1/reviews/1",
    starRating: "FIVE",
    comment: "Excellent",
    reviewer: { displayName: "Ada" },
    createTime: "2026-11-24T10:00:00Z",
    updateTime: "2026-11-25T09:00:00Z",
    reviewReply: null,
    updated_at: updatedAt,
  });
});
