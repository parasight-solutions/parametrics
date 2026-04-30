// apps/api/src/services/recurrencePlanner.js
// apps/api/src/services/recurrencePlanner.js
import crypto from "crypto";
import { DateTime } from "luxon";
import { col } from "../lib/mongo.js";
import { makeQueue } from "../lib/queues.js";
import { resolveCanonicalLocationScope } from "./locationBinding.js";

const genQ = makeQueue("post-generate");

const LIMIT_UPSERTS_PER_RULE = 200;

const HORIZON = {
  daily: 30,
  weekly: 84,
  monthly: 365,
  yearly: 365,
};

const PLAN_HORIZON_DAYS = Math.max(
  1,
  Math.min(30, Number(process.env.RECURRENCE_PLAN_HORIZON_DAYS || 1))
);

function parseHHMM(hhmm) {
  const m = String(hhmm || "").match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function timesInWindow(dayLocal, count, winStartMin, winEndMin) {
  const span = Math.max(1, winEndMin - winStartMin);
  const c = Math.max(1, Number(count || 1));

  if (c === 1) {
    const mid = winStartMin + Math.floor(span / 2);
    return [dayLocal.set({ hour: Math.floor(mid / 60), minute: mid % 60, second: 0, millisecond: 0 })];
  }

  const step = span / (c - 1);
  const out = [];
  for (let i = 0; i < c; i++) {
    const t = Math.round(winStartMin + step * i);
    out.push(dayLocal.set({ hour: Math.floor(t / 60), minute: t % 60, second: 0, millisecond: 0 }));
  }
  return out;
}

async function enqueueGenerate(postId) {
  const jobId = `gen_${postId}`;

  try {
    const existing = await genQ.getJob(jobId);

    if (existing) {
      const state = await existing.getState().catch(() => null);

      // If job is finished, we can safely replace it (post may have been reset to pending)
      if (state === "completed" || state === "failed") {
        await existing.remove().catch(() => { });
      } else {
        return; // waiting/active/delayed -> don't duplicate
      }
    }

    await genQ.add(
      "generate",
      { postId },
      {
        jobId,
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 2000,
        removeOnFail: 2000,
      }
    );
  } catch (e) {
    console.error("[recurrence] enqueue generate failed", { postId, err: e?.message || e });
  }
}

let _indexesReady = false;

export async function ensurePlannerIndexesOnce() {
  if (_indexesReady) return;
  const posts = await col("posts");
  const rules = await col("recurrence_rules");
  const mapCol = await col("location_org_map");
  const orgs = await col("orgs");

  await posts.createIndex({ recurrence_key: 1 }, { unique: true, sparse: true });
  await posts.createIndex({ recurrence_rule_id: 1, created_at: -1 });
  await posts.createIndex({ location_id: 1, scheduled_at: 1 });
  await posts.createIndex({ ai_status: 1, updated_at: -1 });

  await rules.createIndex({ user_id: 1, location_id: 1 }, { unique: true });

  await mapCol.createIndex({ user_id: 1, location_id: 1 }, { unique: true });
  await orgs.createIndex({ user_id: 1, id: 1 }, { unique: true });

  _indexesReady = true;
}

export async function planForRule(rule) {
  await ensurePlannerIndexesOnce();

  const posts = await col("posts");
  const locations = await col("locations");
  const rules = await col("recurrence_rules");
  const mapCol = await col("location_org_map");

  const tz = rule.timezone || "Asia/Kolkata";
  const nowLocal = DateTime.utc().setZone(tz);

  const winStartMin = parseHHMM(rule.window_start || "10:00") ?? 600;
  const winEndMin = parseHHMM(rule.window_end || "18:00") ?? 1080;

  const freq = String(rule.frequency || "weekly").toLowerCase();

  // 🔒 Always clamp planning to a small horizon (default 1 day)
  const endLocal = nowLocal.startOf("day").plus({ days: PLAN_HORIZON_DAYS });
  const endMs = endLocal.toMillis();

  const loc = await locations.findOne(
    { id: rule.location_id, user_id: rule.user_id, provider: "google" },
    {
      projection: {
        _id: 0,
        id: 1,
        title: 1,
        name: 1,
        provider_location_name: 1,
        provider_account_name: 1,
        integration_id: 1,
        organization_id: 1,
        client_id: 1,
        org_id: 1,
      },
    }
  );

  const map = await mapCol.findOne(
    { user_id: rule.user_id, location_id: rule.location_id },
    { projection: { _id: 0, location_id: 1, org_id: 1, organization_id: 1 } }
  );

  const scope = resolveCanonicalLocationScope(loc, map);
  if (!scope.effective.organization_id) {
    await rules.updateOne(
      { id: rule.id, user_id: rule.user_id },
      { $set: { last_error: "org_not_set_for_location", updated_at: new Date() } }
    );
    return { planned: 0, error: "org_not_set_for_location" };
  }

  if (!loc?.integration_id || !loc?.provider_account_name || !loc?.provider_location_name) {
    await rules.updateOne(
      { id: rule.id, user_id: rule.user_id },
      { $set: { last_error: "location_not_bound", updated_at: new Date() } }
    );
    return { planned: 0, error: "location_not_bound" };
  }

  const occurrences = [];
  const count = Math.max(1, Math.min(30, Number(rule.count || 1)));

  if (freq === "daily") {
    let d = nowLocal.startOf("day");
    while (d < endLocal && occurrences.length < LIMIT_UPSERTS_PER_RULE) {
      const ts = timesInWindow(d, count, winStartMin, winEndMin);
      for (let i = 0; i < ts.length && occurrences.length < LIMIT_UPSERTS_PER_RULE; i++) {
        const tLocal = ts[i];
        if (tLocal <= nowLocal.plus({ minutes: 2 })) continue;
        if (tLocal.toMillis() >= endMs) continue; // 🔒 horizon clamp
        occurrences.push({ tLocal, seq: i + 1 });
      }
      d = d.plus({ days: 1 });
    }
  } else if (freq === "weekly") {
    let weekStart = nowLocal.startOf("week");
    while (weekStart < endLocal && occurrences.length < LIMIT_UPSERTS_PER_RULE) {
      const base = Math.floor(count / 7);
      const rem = count % 7;

      for (let day = 0; day < 7 && occurrences.length < LIMIT_UPSERTS_PER_RULE; day++) {
        const c = base + (day < rem ? 1 : 0);
        if (c <= 0) continue;

        const dayLocal = weekStart.plus({ days: day }).startOf("day");
        if (dayLocal.toMillis() >= endMs) continue; // 🔒 skip days outside horizon
        const ts = timesInWindow(dayLocal, c, winStartMin, winEndMin);

        for (let i = 0; i < ts.length && occurrences.length < LIMIT_UPSERTS_PER_RULE; i++) {
          const tLocal = ts[i];
          if (tLocal <= nowLocal.plus({ minutes: 2 })) continue;
          if (tLocal.toMillis() >= endMs) continue; // 🔒 horizon clamp
          occurrences.push({ tLocal, seq: `${weekStart.toISODate()}_${day}_${i + 1}` });
        }
      }

      weekStart = weekStart.plus({ weeks: 1 });
    }
  } else if (freq === "monthly") {
    let mStart = nowLocal.startOf("month");
    while (mStart < endLocal && occurrences.length < LIMIT_UPSERTS_PER_RULE) {
      const daysInMonth = mStart.daysInMonth;
      for (let i = 0; i < count && occurrences.length < LIMIT_UPSERTS_PER_RULE; i++) {
        const dayIndex = Math.min(daysInMonth, Math.floor((i * (daysInMonth - 1)) / Math.max(1, count - 1)) + 1);
        const dayLocal = mStart.set({ day: dayIndex }).startOf("day");
        const [tLocal] = timesInWindow(dayLocal, 1, winStartMin, winEndMin);
        if (tLocal <= nowLocal.plus({ minutes: 2 })) continue;
        if (tLocal.toMillis() >= endMs) continue; // 🔒 horizon clamp
        occurrences.push({ tLocal, seq: `${mStart.toFormat("yyyy-LL")}_${i + 1}` });
      }
      mStart = mStart.plus({ months: 1 });
    }
  } else if (freq === "yearly") {
    const start = nowLocal.startOf("month");
    for (let i = 0; i < count && occurrences.length < LIMIT_UPSERTS_PER_RULE; i++) {
      const monthOffset = Math.floor((i * 11) / Math.max(1, count - 1));
      const m = start.plus({ months: monthOffset }).startOf("month");
      const day = Math.min(15, m.daysInMonth);
      const dayLocal = m.set({ day }).startOf("day");
      const [tLocal] = timesInWindow(dayLocal, 1, winStartMin, winEndMin);
      if (tLocal <= nowLocal.plus({ minutes: 2 })) continue;
      if (tLocal.toMillis() >= endMs) continue; // 🔒 horizon clamp
      occurrences.push({ tLocal, seq: `${m.toFormat("yyyy-LL")}_${i + 1}` });
    }
  }

  let inserted = 0;

  for (const occ of occurrences) {
    const tLocal = occ.tLocal;
    const tUtc = tLocal.toUTC();
    const localYmd = tLocal.toFormat("yyyy-LL-dd");
    const recurrenceKey = `${rule.id}:${localYmd}:${occ.seq}`;

    const now = new Date();
    const mode = String(rule.mode || "manual").toLowerCase();
    const autoPublishAt = mode === "auto" ? tUtc.toJSDate() : null;

    const doc = {
      id: crypto.randomUUID(),
      user_id: rule.user_id,
      location_id: rule.location_id,

      integration_id: loc.integration_id,
      provider_account_name: loc.provider_account_name,
      provider_location_name: loc.provider_location_name,

      summary: "(Generating content...)",
      image_url: null,

      call_to_action_url: rule.template_cta_url || null,
      call_to_action_type: rule.template_cta_type || null,
      topic_type: rule.template_topic_type || "STANDARD",
      language_code: rule.template_language_code || "en-US",

      status: "draft",
      scheduled_at: null,

      planned_for: tUtc.toJSDate(),
      auto_publish_at: autoPublishAt,
      recurrence_mode: mode,

      recurrence_rule_id: rule.id,
      recurrence_key: recurrenceKey,

      ai_status: "pending",
      ai_org_id: scope.effective.organization_id,
      ai_error: null,

      provider_post_name: null,
      provider_error: null,

      created_at: now,
      updated_at: now,
    };

    try {
      const r = await posts.updateOne(
        { recurrence_key: recurrenceKey },
        { $setOnInsert: doc },
        { upsert: true }
      );

      if (r.upsertedCount) {
        inserted++;
        await enqueueGenerate(doc.id);
      }
    } catch (e) {
      if (!String(e?.message || "").includes("E11000")) {
        await rules.updateOne(
          { id: rule.id, user_id: rule.user_id },
          { $set: { last_error: e?.message || "plan_failed", updated_at: new Date() } }
        );
      }
    }
  }

  await rules.updateOne(
    { id: rule.id, user_id: rule.user_id },
    { $set: { last_planned_at: new Date(), last_error: null, updated_at: new Date() } }
  );

  return { planned: inserted, error: null };
}
