const POST_READ_ROLES = Object.freeze(["owner", "admin", "manager", "viewer"]);

function notFound() {
  const error = new Error("post not found");
  error.status = 404;
  error.statusCode = 404;
  error.code = "not_found";
  return error;
}

function serializePost(post, location) {
  return {
    id: post.id,
    user_id: post.user_id,
    organization_id: post.organization_id || null,
    client_id: post.client_id || null,
    location_id: post.location_id,
    location: {
      id: location.id,
      title: location.title || location.name || location.provider_location_name || location.id,
    },
    summary: post.summary,
    image_url: post.image_url || null,
    call_to_action_url: post.call_to_action_url || null,
    call_to_action_type: post.call_to_action_type || null,
    topic_type: post.topic_type || null,
    language_code: post.language_code || null,
    status: post.status,
    scheduled_at: post.scheduled_at || null,
    integration_id: post.integration_id || null,
    provider_post_name: post.provider_post_name || null,
    provider_post_url: post.provider_post_url || null,
    provider_error: post.provider_error || null,
    created_at: post.created_at,
    updated_at: post.updated_at,
  };
}

export async function getPostDetailsForUser(
  { userId, postId },
  { posts, requireLocationAccess, assertScope },
) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedPostId = String(postId || "").trim();
  if (!normalizedUserId || !normalizedPostId) throw notFound();

  const post = await posts.findOne(
    { id: normalizedPostId, user_id: normalizedUserId },
    { projection: { _id: 0 } },
  );
  if (!post) throw notFound();

  let location;
  try {
    ({ location } = await requireLocationAccess({
      userId: normalizedUserId,
      locationId: post.location_id,
      provider: "google",
      allowedRoles: POST_READ_ROLES,
    }));
  } catch (error) {
    if (error?.status === 403 || error?.status === 404) throw notFound();
    throw error;
  }
  assertScope(post, location, "post");

  return serializePost(post, location);
}
