export function getPostDeleteErrorMessage(error) {
  const message = Number.isInteger(error?.statusCode)
    ? error?.message || error?.errors?.[0]?.message
    : null;

  return typeof message === "string" && message.trim()
    ? message.trim()
    : "Failed to delete post. Please try again.";
}

export function isPostDeleteDisabled({ status, postId, deletingPostIds }) {
  return status === "publishing" || deletingPostIds?.has(postId) === true;
}
