const GOOGLE_REVIEW_NAME = /^accounts\/(\d+)\/locations\/(\d+)\/reviews\/([A-Za-z0-9_-]+)$/;
const GOOGLE_LOCATION_NAME = /^locations\/(\d+)$/;

export function extractGoogleReviewIdentity(value) {
  if (typeof value !== "string") return null;
  const match = GOOGLE_REVIEW_NAME.exec(value.trim());
  if (!match) return null;
  return { accountId: match[1], locationId: match[2], reviewId: match[3] };
}

export function extractGoogleLocationId(value) {
  if (typeof value !== "string") return null;
  return GOOGLE_LOCATION_NAME.exec(value.trim())?.[1] || null;
}

export function validateGoogleReviewIdentity({ reviewName, providerLocationName }) {
  const identity = extractGoogleReviewIdentity(reviewName);
  if (!identity) throw new Error("invalid_provider_review_name");
  const expectedLocationId = extractGoogleLocationId(providerLocationName);
  if (!expectedLocationId) throw new Error("invalid_provider_location_name");
  if (identity.locationId !== expectedLocationId) {
    throw new Error("provider_review_location_mismatch");
  }
  return identity;
}

export function canonicalReviewFilter({ userId, locationId, reviewId }) {
  return {
    user_id: userId,
    location_id: locationId,
    provider: "google",
    provider_review_id: reviewId,
  };
}
