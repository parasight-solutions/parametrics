const PERMANENT_LOCAL_CODES = new Set([
  "image_url_not_public",
  "image_url_must_be_public_https",
  "invalid_image_url",
  "unsupported_image_type",
]);

export function classifyPostPublishFailure(error) {
  if (PERMANENT_LOCAL_CODES.has(error?.code)) {
    return { permanent: true, reason: "invalid_image_url" };
  }

  const status = Number(error?.status || error?.body?.error?.code || 0);
  const providerStatus = String(error?.body?.error?.status || "").toUpperCase();

  if (status === 400 && providerStatus === "INVALID_ARGUMENT") {
    return { permanent: true, reason: "google_invalid_argument" };
  }
  if (status === 429) return { permanent: false, reason: "google_rate_limit" };
  if (status >= 500 && status <= 599) return { permanent: false, reason: "google_server_error" };
  return { permanent: false, reason: "network_or_unknown" };
}

export function buildPostPublishFailureDecision({ error, attempt, maxAttempts }) {
  const classification = classifyPostPublishFailure(error);
  return {
    ...classification,
    final: classification.permanent || Number(attempt) >= Number(maxAttempts),
  };
}
