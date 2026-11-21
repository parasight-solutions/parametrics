export function getPostDeleteErrorMessage(error) {
  const message = error?.response?.data?.error?.message;

  return typeof message === "string" && message.trim()
    ? message.trim()
    : "Failed to delete post. Please try again.";
}

export function isPostDeleteDisabled({ status, postId, deletingPostIds }) {
  return status === "publishing" || deletingPostIds?.has(postId) === true;
}
