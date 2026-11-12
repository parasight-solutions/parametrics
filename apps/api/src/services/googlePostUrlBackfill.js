function isPublicPostUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function candidateFilter() {
  return {
    status: "published",
    provider_post_name: { $type: "string", $ne: "" },
    provider_post_url: { $in: [null, ""] },
  };
}

function groupByLocation(rows) {
  const groups = new Map();
  const incomplete = [];
  for (const post of rows) {
    if (!post?.id || !post?.user_id || !post?.location_id || !post?.provider_post_name) {
      incomplete.push(post);
      continue;
    }
    const key = `${post.user_id}\u0000${post.location_id}`;
    const group = groups.get(key) || [];
    group.push(post);
    groups.set(key, group);
  }
  return { groups, incomplete };
}

async function listAllProviderPosts({
  accessToken,
  location,
  listLocalPosts,
}) {
  const byName = new Map();
  const seenTokens = new Set();
  let pageToken = "";

  do {
    const response = await listLocalPosts(
      accessToken,
      location.provider_account_name,
      location.provider_location_name,
      { pageSize: 100, ...(pageToken ? { pageToken } : {}) },
    );
    for (const post of response?.localPosts || []) {
      if (post?.name) byName.set(post.name, post);
    }
    const nextToken = response?.nextPageToken || "";
    if (!nextToken || seenTokens.has(nextToken)) break;
    seenTokens.add(nextToken);
    pageToken = nextToken;
  } while (pageToken);

  return byName;
}

export async function backfillGooglePostUrls({
  posts,
  locations,
  getIntegrationById,
  ensureAccessToken,
  listLocalPosts,
  getLocalPost,
  apply = false,
}) {
  const candidates = await posts.find(candidateFilter()).toArray();
  const summary = {
    mode: apply ? "apply" : "dry-run",
    candidates: candidates.length,
    matched: 0,
    updated: 0,
    unavailable: 0,
    failed: 0,
    skipped: 0,
  };
  const { groups, incomplete } = groupByLocation(candidates);
  summary.skipped += incomplete.length;

  for (const group of groups.values()) {
    const first = group[0];
    const location = await locations.findOne({
      id: first.location_id,
      user_id: first.user_id,
    });
    const integrationId = location?.integration_id || first.integration_id;
    if (
      !location?.provider_account_name ||
      !location?.provider_location_name ||
      !integrationId
    ) {
      summary.skipped += group.length;
      continue;
    }

    const integration = await getIntegrationById(first.user_id, integrationId);
    if (!integration) {
      summary.skipped += group.length;
      continue;
    }

    let accessToken;
    try {
      ({ access_token: accessToken } = await ensureAccessToken(integration));
    } catch {
      summary.failed += group.length;
      continue;
    }

    let listedByName = new Map();
    try {
      listedByName = await listAllProviderPosts({
        accessToken,
        location,
        listLocalPosts,
      });
    } catch {
      // Exact-name lookup below is also the fallback when listing fails.
    }

    for (const post of group) {
      let providerPost = listedByName.get(post.provider_post_name) || null;
      if (!isPublicPostUrl(providerPost?.searchUrl)) {
        try {
          providerPost = await getLocalPost(accessToken, post.provider_post_name);
        } catch (error) {
          if (error?.status === 404) summary.unavailable += 1;
          else summary.failed += 1;
          continue;
        }
      }

      if (!isPublicPostUrl(providerPost?.searchUrl)) {
        summary.unavailable += 1;
        continue;
      }

      summary.matched += 1;
      if (!apply) continue;

      try {
        const result = await posts.updateOne(
          {
            id: post.id,
            user_id: post.user_id,
            provider_post_url: { $in: [null, ""] },
          },
          {
            $set: {
              provider_post_url: providerPost.searchUrl.trim(),
              updated_at: new Date(),
            },
          },
        );
        if (result?.modifiedCount) summary.updated += 1;
        else summary.skipped += 1;
      } catch {
        summary.failed += 1;
      }
    }
  }

  return summary;
}
