// apps/web/src/pages/Reviews.jsx
import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import ActiveLocationPicker from "../components/ActiveLocationPicker";
import { api } from "../apiClient";
import { getActiveLocationId } from "../session";

function prettyWhen(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function parseStarRating(starRating) {
  if (starRating == null) return 0;

  if (typeof starRating === "number" && Number.isFinite(starRating)) {
    return Math.max(0, Math.min(5, Math.round(starRating)));
  }
  const s = String(starRating).trim().toUpperCase();

  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  if (map[s] != null) return map[s];

  for (const k of Object.keys(map)) {
    if (s.includes(k)) return map[k];
  }

  const n = parseInt(s, 10);
  if (Number.isFinite(n)) return Math.max(0, Math.min(5, n));

  return 0;
}

function Stars({ value }) {
  const n = parseStarRating(value);
  const label = n ? `${n}/5` : "-";

  return (
    <div className="flex items-center gap-2" aria-label={`Rating ${label}`} title={`Rating ${label}`}>
      <div className="flex items-center leading-none">
        {Array.from({ length: 5 }).map((_, i) => {
          const filled = i < n;
          return (
            <span
              key={i}
              className={filled ? "text-gray-900" : "text-gray-300"}
              style={{ fontSize: 14, lineHeight: 1 }}
            >
              ★
            </span>
          );
        })}
      </div>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

function hasBusinessReply(review) {
  return Boolean((review?.reviewReply?.comment ?? "").trim().length > 0);
}

function normalizeText(v) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export default function Reviews({ onLogout }) {
  const [locationId, setLocationId] = useState(getActiveLocationId());
  const [reviews, setReviews] = useState([]);
  const [sync, setSync] = useState(null);

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [replying, setReplying] = useState({}); // reviewId -> text
  const [editing, setEditing] = useState({}); // reviewId -> boolean

  const [busyId, setBusyId] = useState("");

  // Filter: all | unreplied | replied | auto
  // auto => default workflow: if unreplied > 0 => show unreplied, else show all
  const [filter, setFilter] = useState("auto");

  // Search by reviewer / comment / reply text
  const [q, setQ] = useState("");

  const canLoad = useMemo(() => Boolean(locationId), [locationId]);

  const counts = useMemo(() => {
    let replied = 0;
    for (const r of reviews) if (hasBusinessReply(r)) replied++;
    return { total: reviews.length, replied, unreplied: reviews.length - replied };
  }, [reviews]);

  const effectiveFilter = useMemo(() => {
    if (filter === "auto") return counts.unreplied > 0 ? "unreplied" : "all";
    return filter;
  }, [filter, counts.unreplied]);

  const query = useMemo(() => normalizeText(q), [q]);

  const filteredReviews = useMemo(() => {
    let list = reviews;

    if (effectiveFilter === "unreplied") list = list.filter((r) => !hasBusinessReply(r));
    if (effectiveFilter === "replied") list = list.filter((r) => hasBusinessReply(r));

    if (query) {
      list = list.filter((r) => {
        const blob = normalizeText([
          r?.reviewer?.displayName,
          r?.reviewer?.name,
          r?.comment,
          r?.reviewReply?.comment,
        ].filter(Boolean).join(" "));
        return blob.includes(query);
      });
    }

    return list;
  }, [reviews, effectiveFilter, query]);

  async function load() {
    if (!locationId) return;
    setLoading(true);
    try {
      const out = await api(`/reviews?locationId=${encodeURIComponent(locationId)}`);
      setReviews(out.reviews || []);
      setSync(out.sync || null);
    } finally {
      setLoading(false);
    }
  }

  async function syncNow() {
    if (!locationId) return;
    setSyncing(true);
    try {
      await api("/reviews/sync", { method: "POST", body: { locationId } });
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function sendReply(review) {
    const text = (replying[review.id] ?? "").trim();
    if (!text) return;

    setBusyId(review.id);
    try {
      await api(`/reviews/${review.id}/reply`, { method: "PUT", body: { comment: text } });
      await load();
    } finally {
      setBusyId("");
    }
  }

  // Reset UI per location (keeps workflow predictable)
  useEffect(() => {
    setFilter("auto");
    setQ("");
    setReplying({});
    setEditing({});
    setBusyId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  return (
    <AppShell
      title="Reviews"
      subtitle="Sync Google Business Profile reviews and reply"
      onLogout={onLogout}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={!canLoad || loading}
            className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            onClick={syncNow}
            disabled={!canLoad || syncing}
            className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync from Google"}
          </button>
        </div>
      }
    >
      <div className="bg-white border rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div>
            <div className="text-sm text-gray-600 mb-2">Active Location</div>
            <ActiveLocationPicker value={locationId} onChange={setLocationId} />
          </div>

          <div className="text-sm text-gray-600 md:text-right space-y-2">
            <div>
              {loading ? (
                "Loading…"
              ) : (
                <>
                  <span className="font-medium text-gray-800">{filteredReviews.length}</span> shown ·{" "}
                  <span className="font-medium text-gray-800">{counts.total}</span> total
                  {query ? <span className="text-xs text-gray-500"> · Search active</span> : null}
                </>
              )}
            </div>

            <div className="text-xs text-gray-500">
              Unreplied: {counts.unreplied} · Replied: {counts.replied}
            </div>

            <div className="text-xs text-gray-500">
              Last sync: {prettyWhen(sync?.last_synced_at)}
              {sync?.last_error ? (
                <span className="text-red-700"> · Error: {sync.last_error.message || "sync_failed"}</span>
              ) : null}
            </div>

            {/* Filter + Search */}
            <div className="flex flex-col items-start md:items-end gap-2">
              <div className="inline-flex rounded-lg border overflow-hidden">
                {[
                  { key: "all", label: "All" },
                  { key: "unreplied", label: "Unreplied" },
                  { key: "replied", label: "Replied" },
                ].map((opt) => {
                  const active = effectiveFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setFilter(opt.key)}
                      aria-pressed={active}
                      className={
                        "px-3 py-1.5 text-xs " +
                        (active ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-100")
                      }
                      title={filter === "auto" && active ? "Auto-selected" : undefined}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="w-full md:w-72 relative">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search reviewer / keyword…"
                  className="w-full px-3 py-2 pr-10 rounded-lg border text-sm bg-white"
                />
                {q ? (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-900 text-sm"
                    aria-label="Clear search"
                    title="Clear"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {!locationId ? (
          <div className="py-10 text-center text-gray-500">Pick a location to load reviews.</div>
        ) : null}

        {locationId ? (
          <div className="space-y-3">
            {filteredReviews.map((r) => (
              <div key={r.id} className="border rounded-xl p-4 bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {r.reviewer?.displayName || r.reviewer?.name || "Anonymous"}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <Stars value={r.starRating} />
                      <div className="text-xs text-gray-500">Updated: {prettyWhen(r.updateTime)}</div>
                    </div>
                  </div>

                  {hasBusinessReply(r) ? (
                    <span className="text-xs px-2 py-1 rounded-full border bg-gray-50 text-gray-700">
                      Replied
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded-full border bg-white text-gray-700">
                      Unreplied
                    </span>
                  )}
                </div>

                {r.comment ? (
                  <div className="mt-3 text-gray-800 whitespace-pre-wrap">{r.comment}</div>
                ) : (
                  <div className="mt-3 text-gray-500 text-sm italic">No comment text.</div>
                )}

                {(() => {
                  const existing = (r.reviewReply?.comment ?? "").trim();
                  const hasReply = existing.length > 0;

                  const isEditing = Boolean(editing[r.id]);
                  const draft = (replying[r.id] ?? (hasReply ? existing : "")).trim();
                  const unchanged = hasReply && draft === existing;

                  function startEdit() {
                    setEditing((m) => ({ ...m, [r.id]: true }));
                    setReplying((s) => (s[r.id] !== undefined ? s : { ...s, [r.id]: existing }));
                  }

                  function cancelEdit() {
                    setEditing((m) => ({ ...m, [r.id]: false }));
                    setReplying((s) => {
                      const n = { ...s };
                      delete n[r.id];
                      return n;
                    });
                  }

                  return (
                    <div className="mt-4 pt-4 border-t space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">Reply</div>

                        {hasReply && !isEditing ? (
                          <button
                            onClick={startEdit}
                            className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-100"
                          >
                            Edit Reply
                          </button>
                        ) : null}
                      </div>

                      {hasReply && !isEditing ? (
                        <div className="text-sm bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap">
                          {existing}
                        </div>
                      ) : (
                        <>
                          <textarea
                            className="border rounded-lg w-full p-2 text-sm"
                            rows={3}
                            placeholder={hasReply ? "Edit your reply…" : "Write a reply…"}
                            value={replying[r.id] ?? (hasReply ? existing : "")}
                            onChange={(e) => setReplying((s) => ({ ...s, [r.id]: e.target.value }))}
                          />

                          <div className="flex justify-end gap-2">
                            {hasReply ? (
                              <button
                                onClick={cancelEdit}
                                disabled={busyId === r.id}
                                className="px-4 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            ) : null}

                            <button
                              onClick={async () => {
                                await sendReply(r);
                                setEditing((m) => ({ ...m, [r.id]: false }));
                              }}
                              disabled={busyId === r.id || draft.length === 0 || unchanged}
                              className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50"
                            >
                              {hasReply ? "Save Reply" : "Send Reply"}
                            </button>
                          </div>

                          {hasReply && unchanged ? (
                            <div className="text-xs text-gray-500 text-right">No changes to save.</div>
                          ) : null}
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}

            {!loading && filteredReviews.length === 0 ? (
              <div className="py-10 text-center text-gray-500">
                {query ? (
                  <>
                    No results for <b>{q.trim()}</b>. Clear search or switch filter.
                  </>
                ) : effectiveFilter === "unreplied" ? (
                  <>No unreplied reviews 🎉</>
                ) : effectiveFilter === "replied" ? (
                  <>No replied reviews yet.</>
                ) : (
                  <>
                    No reviews in DB yet. Click <b>Sync from Google</b>.
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
