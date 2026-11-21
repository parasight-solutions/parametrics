import { createHash } from "node:crypto";

const MINUTE_MS = 60_000;
const INITIAL_STAGGER_MINUTES = 5;

function locationHash(locationId) {
  return createHash("sha256").update(String(locationId || "")).digest("hex");
}

function deterministicOffsetMs(locationId, windowMinutes) {
  const prefix = locationHash(locationId).slice(0, 8);
  return Number.parseInt(prefix, 16) % (windowMinutes * MINUTE_MS);
}

export function calculateInitialAutoSyncAt({ locationId, enabledAt }) {
  const base = new Date(enabledAt);
  return new Date(base.getTime() + deterministicOffsetMs(locationId, INITIAL_STAGGER_MINUTES));
}

export function calculateNextAutoSyncAt({ locationId, completedAt, intervalMinutes = 120 }) {
  const base = new Date(completedAt);
  const jitterMs = deterministicOffsetMs(locationId, INITIAL_STAGGER_MINUTES);
  return new Date(base.getTime() + intervalMinutes * MINUTE_MS + jitterMs);
}

export function isPostAutoSyncDue({ autoEnabled, nextAutoSyncAt, now = new Date() }) {
  if (autoEnabled !== true) return false;
  if (!nextAutoSyncAt) return true;
  const due = new Date(nextAutoSyncAt);
  return !Number.isNaN(due.getTime()) && due <= new Date(now);
}

export function buildPostSyncJobId({ locationId, dueAt }) {
  const locationKey = locationHash(locationId).slice(0, 16);
  const dueWindow = Math.floor(new Date(dueAt).getTime() / MINUTE_MS);
  return `post-sync-${locationKey}-${dueWindow}`;
}

export async function claimDuePostSyncLocations(
  { now = new Date(), limit = 50, claimMs = 60_000 },
  { locations, claimIdFactory },
) {
  const due = await locations.find({
    provider: "google",
    status: "active",
    "post_sync.auto_enabled": true,
    $and: [
      { $or: [
        { "post_sync.next_auto_sync_at": { $exists: false } },
        { "post_sync.next_auto_sync_at": { $lte: now } },
      ] },
      { $or: [
        { "post_sync.enqueue_claim_id": { $exists: false } },
        { "post_sync.enqueue_claim_expires_at": { $lte: now } },
      ] },
      { $or: [
        { "post_sync.operation_id": { $exists: false } },
        { "post_sync.operation_expires_at": { $lte: now } },
      ] },
    ],
  }).sort({ "post_sync.next_auto_sync_at": 1, id: 1 }).limit(limit).toArray();

  const claimed = [];
  for (const location of due) {
    const enqueueClaimId = claimIdFactory();
    const result = await locations.findOneAndUpdate(
      {
        id: location.id,
        provider: "google",
        status: "active",
        "post_sync.auto_enabled": true,
        $and: [
          { $or: [
            { "post_sync.next_auto_sync_at": { $exists: false } },
            { "post_sync.next_auto_sync_at": { $lte: now } },
          ] },
          { $or: [
            { "post_sync.enqueue_claim_id": { $exists: false } },
            { "post_sync.enqueue_claim_expires_at": { $lte: now } },
          ] },
        ],
      },
      {
        $set: {
          "post_sync.enqueue_claim_id": enqueueClaimId,
          "post_sync.enqueue_claim_expires_at": new Date(now.getTime() + claimMs),
        },
      },
      { returnDocument: "after", includeResultMetadata: false },
    );
    const claimedLocation = result && Object.prototype.hasOwnProperty.call(result, "value")
      ? result.value
      : result;
    if (!claimedLocation) continue;
    claimed.push({
      locationId: claimedLocation.id,
      enqueueClaimId,
      dueAt: claimedLocation.post_sync?.next_auto_sync_at || now,
    });
  }
  return claimed;
}

export async function enqueueClaimedPostSync(
  record,
  { queue, locations, maxAttempts = 3 },
) {
  const dueAt = new Date(record.dueAt);
  try {
    return await queue.add(
      "automatic-post-sync",
      {
        locationId: record.locationId,
        enqueueClaimId: record.enqueueClaimId,
        dueAt: dueAt.toISOString(),
      },
      {
        jobId: buildPostSyncJobId({ locationId: record.locationId, dueAt }),
        attempts: maxAttempts,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  } catch (error) {
    await locations.updateOne(
      {
        id: record.locationId,
        "post_sync.enqueue_claim_id": record.enqueueClaimId,
      },
      {
        $unset: {
          "post_sync.enqueue_claim_id": "",
          "post_sync.enqueue_claim_expires_at": "",
        },
      },
    );
    throw error;
  }
}
