/**
apps/api/src/routes/reviews.util.js 
* Placeholder for Google Reviews reply call (to be implemented against GBP API).
 * Keeping it here avoids import errors until we wire the real endpoint.
 */
export async function replyReview({ accessToken, reviewName, comment }) {
  return { ok: true, reviewName, comment }
}
