function unwrapFindOneAndUpdate(result) {
  if (!result) return null;
  return Object.prototype.hasOwnProperty.call(result, "value")
    ? result.value
    : result;
}

function matched(result) {
  return Number(result?.matchedCount || 0) === 1;
}

export async function claimPostForPublishing(
  posts,
  { postId, userId, attemptId, now = new Date() },
) {
  const result = await posts.findOneAndUpdate(
    {
      id: postId,
      user_id: userId,
      status: { $in: ["queued", "retrying"] },
    },
    {
      $set: {
        status: "publishing",
        publish_attempt_id: attemptId,
        last_attempt_at: now,
        updated_at: now,
      },
      $unset: {
        provider_error: "",
        provider_error_detail: "",
      },
    },
    { returnDocument: "after" },
  );

  return unwrapFindOneAndUpdate(result);
}

export async function markPostPublished(
  posts,
  { scope, attemptId, providerFields, now = new Date() },
) {
  const result = await posts.updateOne(
    { ...scope, status: "publishing", publish_attempt_id: attemptId },
    {
      $set: {
        status: "published",
        ...providerFields,
        provider_error: null,
        updated_at: now,
      },
      $unset: {
        provider_error_detail: "",
        publish_attempt_id: "",
      },
    },
  );
  return matched(result);
}

export async function markPostPublishFailure(
  posts,
  {
    scope,
    attemptId,
    status,
    providerError,
    detail = null,
    metadata = {},
    now = new Date(),
  },
) {
  if (!["failed", "retrying"].includes(status)) {
    throw new Error("invalid_publish_failure_status");
  }

  const result = await posts.updateOne(
    { ...scope, status: "publishing", publish_attempt_id: attemptId },
    {
      $set: {
        status,
        provider_error: providerError || "publish_failed",
        provider_error_detail: detail,
        last_attempt_at: now,
        last_job_id: metadata.jobId || null,
        attempts_made: metadata.attempt || null,
        updated_at: now,
      },
      $unset: { publish_attempt_id: "" },
    },
  );
  return matched(result);
}
