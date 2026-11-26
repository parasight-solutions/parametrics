export function buildReviewSyncDocument({
  userId,
  locationId,
  location,
  review,
  updatedAt = new Date(),
}) {
  return {
    user_id: userId,
    organization_id: location.organization_id,
    client_id: location.client_id,
    location_id: locationId,
    provider: "google",
    integration_id: location.integration_id,
    provider_account_name: location.provider_account_name || null,
    provider_location_name: location.provider_location_name || null,
    provider_review_name: review.name,
    starRating: review.starRating || null,
    comment: review.comment || null,
    reviewer: review.reviewer || null,
    createTime: review.createTime || null,
    updateTime: review.updateTime || null,
    reviewReply: review.reviewReply || null,
    updated_at: updatedAt,
  };
}
