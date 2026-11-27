import {
  extractGoogleLocationId,
  extractGoogleReviewIdentity,
} from "./googleReviewIdentity.js";

function accountIdFromName(value) {
  return typeof value === "string" ? /^accounts\/(\d+)$/.exec(value.trim())?.[1] || null : null;
}

function reliableTimestamp(review) {
  for (const value of [review?.updateTime, review?.createTime, review?.updated_at, review?.created_at]) {
    const timestamp = value ? new Date(value).getTime() : Number.NaN;
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function rank(review, identity, location) {
  const currentAccount = accountIdFromName(location.provider_account_name);
  return [
    identity.locationId === extractGoogleLocationId(location.provider_location_name) ? 1 : 0,
    identity.accountId === currentAccount && review.integration_id === location.integration_id ? 1 : 0,
    review.provider_sync_status === "active" ? 1 : 0,
    reliableTimestamp(review),
  ];
}

function compareRank(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return 0;
}

function keeperReason(tuple) {
  const reasons = [];
  if (tuple[0]) reasons.push("valid authorized location identity");
  if (tuple[1]) reasons.push("current connected account and integration");
  if (tuple[2]) reasons.push("active provider observation");
  if (tuple[3]) reasons.push("newer reliable provider metadata");
  return reasons.join(", ");
}

function scopeFilter({ userId, locationId }) {
  return {
    provider: "google",
    ...(userId ? { user_id: String(userId) } : {}),
    ...(locationId ? { location_id: String(locationId) } : {}),
  };
}

async function remapReferences(references, duplicateId, keeperId) {
  for (const reference of references) {
    for (const field of reference.fields || []) {
      await reference.collection.updateMany(
        { ...(reference.baseFilter || {}), [field]: duplicateId },
        { $set: { [field]: keeperId } },
      );
    }
  }
}

export async function cleanupDuplicateGoogleReviews({
  reviews,
  locations,
  archive,
  references = [],
  apply = false,
  backupConfirmed = false,
  userId = null,
  locationId = null,
  now = () => new Date(),
}) {
  if (apply && !backupConfirmed) throw new Error("review_cleanup_backup_required");

  const filter = scopeFilter({ userId, locationId });
  const [reviewRows, locationRows, beforeCount] = await Promise.all([
    reviews.find(filter).toArray(),
    locations.find({
      provider: "google",
      ...(userId ? { user_id: String(userId) } : {}),
      ...(locationId ? { id: String(locationId) } : {}),
    }).toArray(),
    reviews.countDocuments(filter),
  ]);
  const locationByScope = new Map(locationRows.map((item) => [`${item.user_id}\0${item.id}`, item]));
  const groups = new Map();
  const conflictedKeys = new Set();
  let invalidRecords = 0;
  let conflictingRecords = 0;

  for (const review of reviewRows) {
    const identity = extractGoogleReviewIdentity(review.provider_review_name);
    const location = locationByScope.get(`${review.user_id}\0${review.location_id}`);
    if (!identity || !location) {
      invalidRecords += 1;
      continue;
    }
    const key = `${review.user_id}\0${review.location_id}\0google\0${identity.reviewId}`;
    const expectedLocationId = extractGoogleLocationId(location.provider_location_name);
    const scopeMatches = identity.locationId === expectedLocationId
      && review.organization_id === location.organization_id
      && review.client_id === location.client_id;
    if (!scopeMatches) {
      conflictingRecords += 1;
      conflictedKeys.add(key);
      const group = groups.get(key) || { key, identity, location, rows: [], conflictingRows: [] };
      group.conflictingRows.push({ review, identity });
      groups.set(key, group);
      continue;
    }
    const group = groups.get(key) || { key, identity, location, rows: [], conflictingRows: [] };
    group.rows.push({ review, identity });
    groups.set(key, group);
  }

  const reportGroups = [];
  const actionable = [];
  let ambiguousGroups = 0;
  let conflictingGroups = 0;
  for (const group of groups.values()) {
    const allRows = [...group.rows, ...(group.conflictingRows || [])];
    if (allRows.length < 2) continue;
    const conflicting = conflictedKeys.has(group.key);
    if (conflicting) {
      conflictingGroups += 1;
      reportGroups.push({
        userId: allRows[0].review.user_id,
        locationId: allRows[0].review.location_id,
        providerReviewId: group.identity.reviewId,
        keeperId: null,
        duplicateIds: allRows.map(({ review }) => review.id),
        keeperReason: "conflicting tenant scope; manual review required",
        status: "skipped_conflict",
      });
      continue;
    }
    const ranked = group.rows.map((entry) => ({ ...entry, rank: rank(entry.review, entry.identity, group.location) }));
    ranked.sort((a, b) => compareRank(a.rank, b.rank));
    const ambiguous = compareRank(ranked[0].rank, ranked[1].rank) === 0;
    if (ambiguous) ambiguousGroups += 1;
    const detail = {
      userId: ranked[0].review.user_id,
      locationId: ranked[0].review.location_id,
      providerReviewId: group.identity.reviewId,
      keeperId: ambiguous ? null : ranked[0].review.id,
      duplicateIds: ambiguous ? ranked.map(({ review }) => review.id) : ranked.slice(1).map(({ review }) => review.id),
      keeperReason: ambiguous ? "ambiguous keeper; manual review required" : keeperReason(ranked[0].rank),
      status: ambiguous ? "skipped_ambiguous" : "ready",
    };
    reportGroups.push(detail);
    if (!ambiguous) actionable.push({ ...group, ranked, detail });
  }

  const result = {
    mode: apply ? "apply" : "dry-run",
    beforeCount,
    afterCount: beforeCount,
    canonicalCandidates: groups.size,
    duplicateGroups: reportGroups.length,
    ambiguousGroups,
    conflictingGroups,
    invalidRecords,
    conflictingRecords,
    archived: 0,
    deleted: 0,
    canonicalized: 0,
    groups: reportGroups,
  };
  if (!apply) return result;

  for (const group of actionable) {
    const keeper = group.ranked[0].review;
    for (const { review: duplicate } of group.ranked.slice(1)) {
      const sourceReviewId = String(duplicate._id);
      const archivedAt = now();
      await archive.updateOne(
        { source_review_id: sourceReviewId },
        { $setOnInsert: {
          source_review_id: sourceReviewId,
          source_local_review_id: duplicate.id,
          keeper_local_review_id: keeper.id,
          provider: "google",
          user_id: duplicate.user_id,
          location_id: duplicate.location_id,
          provider_review_id: group.identity.reviewId,
          reason: "duplicate_canonical_google_review_identity",
          archived_at: archivedAt,
          document: duplicate,
        } },
        { upsert: true },
      );
      const verifiedArchive = await archive.findOne({ source_review_id: sourceReviewId });
      if (!verifiedArchive?.document) throw new Error("review_cleanup_archive_verification_failed");
      result.archived += 1;
      await remapReferences(references, duplicate.id, keeper.id);
      const deletion = await reviews.deleteOne({
        _id: duplicate._id,
        user_id: duplicate.user_id,
        location_id: duplicate.location_id,
        provider: "google",
      });
      result.deleted += Number(deletion?.deletedCount || 0);
    }
  }

  for (const group of groups.values()) {
    const report = reportGroups.find((item) => item.providerReviewId === group.identity.reviewId
      && item.userId === group.rows[0].review.user_id
      && item.locationId === group.rows[0].review.location_id);
    if (report?.status === "skipped_ambiguous" || report?.status === "skipped_conflict") continue;
    const keeper = report
      ? group.rows.find(({ review }) => review.id === report.keeperId)?.review
      : group.rows[0].review;
    if (!keeper) continue;
    const update = await reviews.updateOne(
      { _id: keeper._id, user_id: keeper.user_id, location_id: keeper.location_id, provider: "google" },
      { $set: {
        provider_review_id: group.identity.reviewId,
        provider_google_location_id: group.identity.locationId,
      } },
    );
    if (update?.matchedCount) result.canonicalized += 1;
  }

  result.afterCount = await reviews.countDocuments(filter);
  return result;
}
