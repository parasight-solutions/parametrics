import assert from "node:assert/strict";
import test from "node:test";

import {
  extractGoogleReviewIdentity,
  validateGoogleReviewIdentity,
} from "./googleReviewIdentity.js";

test("extracts the account, location, and stable review id from a Google review name", () => {
  assert.deepEqual(
    extractGoogleReviewIdentity("accounts/105611384841512279530/locations/4394236421618650033/reviews/AbFvOqlTugMgtzqCb68ltu0I2iwVu3Sr4Hbpfact-viSj5vyqfo4LMYrm3Zmv-VqYMJPEB3j9Xz5Og"),
    {
      accountId: "105611384841512279530",
      locationId: "4394236421618650033",
      reviewId: "AbFvOqlTugMgtzqCb68ltu0I2iwVu3Sr4Hbpfact-viSj5vyqfo4LMYrm3Zmv-VqYMJPEB3j9Xz5Og",
    },
  );
});

test("different account paths produce the same canonical review id", () => {
  const first = extractGoogleReviewIdentity("accounts/105611384841512279530/locations/4394236421618650033/reviews/review-1");
  const second = extractGoogleReviewIdentity("accounts/103094208499803762981/locations/4394236421618650033/reviews/review-1");
  assert.equal(first.reviewId, second.reviewId);
  assert.equal(first.locationId, second.locationId);
  assert.notEqual(first.accountId, second.accountId);
});

test("rejects malformed or mismatched Google review resource names", () => {
  assert.equal(extractGoogleReviewIdentity("locations/1/reviews/1"), null);
  assert.equal(extractGoogleReviewIdentity("accounts/not-numeric/locations/1/reviews/1"), null);
  assert.throws(
    () => validateGoogleReviewIdentity({
      reviewName: "accounts/1/locations/2/reviews/3",
      providerLocationName: "locations/9",
    }),
    /provider_review_location_mismatch/,
  );
});
