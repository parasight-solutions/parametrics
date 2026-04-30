// apps/web/src/pages/Posts.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import ActiveLocationPicker from "../components/ActiveLocationPicker";
import { api } from "../apiClient";
import { getActiveLocationId } from "../session";

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function prettyWhen(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function StatusPill({ status }) {
  const s = String(status || "").toLowerCase();
  const cls =
    s === "published"
      ? "bg-green-100 text-green-700"
      : s === "failed"
      ? "bg-red-100 text-red-700"
      : s === "scheduled"
      ? "bg-blue-100 text-blue-700"
      : s === "publishing"
      ? "bg-amber-100 text-amber-800"
      : s === "queued" || s === "retrying"
      ? "bg-gray-100 text-gray-700"
      : "bg-gray-100 text-gray-700";

  return (
    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${cls}`}>
      {status || "-"}
    </span>
  );
}

function tryParseJson(str) {
  if (!str) return null;
  if (typeof str !== "string") return null;
  const s = str.trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function compactErr(err) {
  if (!err) return "-";

  // If backend stored JSON stringified error, show the meaningful part
  const parsed = tryParseJson(err);
  if (parsed?.message) {
    const msg = String(parsed.message);
    const status = parsed.status ? ` (HTTP ${parsed.status})` : "";
    const out = msg + status;
    return out.length > 140 ? out.slice(0, 140) + "…" : out;
  }

  const s = String(err);
  if (s.length <= 140) return s;
  return s.slice(0, 140) + "…";
}

function matchesSearch(p, q) {
  if (!q) return true;
  const needle = q.toLowerCase();

  const fields = [
    p.summary,
    p.location?.title,
    p.location_id,
    p.provider_post_name,
    p.status,
    p.provider_error,
  ]
    .filter(Boolean)
    .map(String)
    .join(" ")
    .toLowerCase();

  return fields.includes(needle);
}

export default function Posts({ onLogout }) {
  const nav = useNavigate();
  const [locationId, setLocationId] = useState(getActiveLocationId());
  const [showAll, setShowAll] = useState(false);

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);

  // NEW: search + status filter
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all|scheduled|queued|publishing|published|failed

  const [editing, setEditing] = useState(null); // post object
  const [editSummary, setEditSummary] = useState("");
  const [editMode, setEditMode] = useState("publish"); // 'publish' | 'schedule'
  const [editSchedule, setEditSchedule] = useState("");
  const [busyId, setBusyId] = useState("");

  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const inFlight = useRef(false);

  const query = useMemo(() => {
    if (showAll) return "";
    if (!locationId) return "";
    return `?locationId=${encodeURIComponent(locationId)}`;
  }, [showAll, locationId]);

  async function load({ silent = false } = {}) {
    if (inFlight.current) return;
    inFlight.current = true;

    if (!silent) setLoading(true);
    try {
      const out = await api(`/posts${query}`);
      setPosts(out.posts || []);
      setLastRefreshedAt(new Date());
    } finally {
      if (!silent) setLoading(false);
      inFlight.current = false;
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // NEW: auto-refresh while any post is in-flight
  const needsAutoRefresh = useMemo(() => {
    return (posts || []).some((p) => {
      const s = String(p.status || "").toLowerCase();
      return s === "queued" || s === "publishing" || s === "retrying";
    });
  }, [posts]);

  useEffect(() => {
    if (!needsAutoRefresh) return;
    if (editing) return; // don’t auto-refresh while modal open (avoids weirdness)

    const t = setInterval(() => {
      load({ silent: true });
    }, 4000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAutoRefresh, editing, query]);

  const counts = useMemo(() => {
    const c = { total: posts.length, scheduled: 0, queued: 0, publishing: 0, published: 0, failed: 0 };
    for (const p of posts) {
      const s = String(p.status || "").toLowerCase();
      if (s === "scheduled") c.scheduled++;
      else if (s === "queued" || s === "retrying") c.queued++;
      else if (s === "publishing") c.publishing++;
      else if (s === "published") c.published++;
      else if (s === "failed") c.failed++;
    }
    return c;
  }, [posts]);

  const filteredPosts = useMemo(() => {
    let list = posts;

    if (statusFilter !== "all") {
      list = list.filter((p) => String(p.status || "").toLowerCase() === statusFilter);
    }

    const q = search.trim();
    if (q) list = list.filter((p) => matchesSearch(p, q));

    return list;
  }, [posts, statusFilter, search]);

  function openEdit(p) {
    setEditing(p);
    setEditSummary(p.summary || "");

    // If it has a scheduled_at, treat as schedule mode even if status is queued (due time)
    if (p.scheduled_at) {
      setEditMode("schedule");
      setEditSchedule(toLocalInputValue(p.scheduled_at));
    } else {
      setEditMode("publish");
      setEditSchedule("");
    }
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editSummary.trim()) {
      alert("Summary is required");
      return;
    }

    const body = { summary: editSummary.trim() };

    if (editMode === "schedule") {
      if (!editSchedule) {
        alert("Pick a schedule date/time");
        return;
      }

      const dt = new Date(editSchedule);

      if (Number.isNaN(dt.getTime())) {
        alert("Invalid schedule date/time");
        return;
      }

      // If user picks <= now, publish now (more intuitive)
      if (dt.getTime() <= Date.now() + 15_000) {
        body.publishNow = true;
      } else {
        body.publishNow = false;
        body.scheduleAt = dt.toISOString();
      }
    } else {
      body.publishNow = true;
    }

    setBusyId(editing.id);
    try {
      await api(`/posts/${editing.id}`, { method: "PATCH", body });
      setEditing(null);
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function del(p) {
    if (!confirm("Delete this post?")) return;
    setBusyId(p.id);
    try {
      await api(`/posts/${p.id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function retry(p) {
    setBusyId(p.id);
    try {
      await api(`/posts/${p.id}/retry`, { method: "POST" });
      await load();
    } finally {
      setBusyId("");
    }
  }

  return (
    <AppShell
      title="Posts"
      subtitle="Create and publish Google Business Profile updates"
      onLogout={onLogout}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            onClick={() => nav("/posts/new")}
            className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black"
          >
            New Post
          </button>
        </div>
      }
    >
      <div className="bg-white border rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div>
            <div className="text-sm text-gray-600 mb-2">Active Location (for filtering)</div>
            <ActiveLocationPicker value={locationId} onChange={setLocationId} />
            <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all locations
            </label>

            {/* NEW: Search */}
            <div className="mt-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search summary / location / keyword…"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="text-sm text-gray-600 md:text-right space-y-2">
            <div>
              {loading ? (
                "Loading…"
              ) : (
                <>
                  <span className="font-medium text-gray-800">{filteredPosts.length}</span> shown ·{" "}
                  <span className="font-medium text-gray-800">{counts.total}</span> total
                </>
              )}
            </div>

            <div className="text-xs text-gray-500">
              Scheduled: {counts.scheduled} · Queued: {counts.queued} · Publishing: {counts.publishing} · Published:{" "}
              {counts.published} · Failed: {counts.failed}
            </div>

            <div className="text-xs text-gray-500">
              Last refresh: {lastRefreshedAt ? lastRefreshedAt.toLocaleTimeString() : "-"}
              {needsAutoRefresh && !editing ? <span className="ml-2 text-gray-700">· Auto-refresh ON</span> : null}
            </div>

            {/* NEW: Status tabs */}
            <div className="flex md:justify-end">
              <div className="inline-flex rounded-lg border overflow-hidden">
                {[
                  { key: "all", label: "All" },
                  { key: "scheduled", label: "Scheduled" },
                  { key: "queued", label: "Queued" },
                  { key: "publishing", label: "Publishing" },
                  { key: "published", label: "Published" },
                  { key: "failed", label: "Failed" },
                ].map((opt) => {
                  const active = statusFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setStatusFilter(opt.key)}
                      aria-pressed={active}
                      className={
                        "px-3 py-1.5 text-xs " +
                        (active ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-100")
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-auto border rounded-xl">
          <table className="min-w-[900px] w-full text-sm">
            <thead>
              <tr className="text-left border-b bg-gray-50">
                <th className="py-3 px-3">Summary</th>
                <th className="py-3 px-3">Location</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Scheduled</th>
                <th className="py-3 px-3">Provider Ref</th>
                <th className="py-3 px-3">Error</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredPosts.map((p) => (
                <tr key={p.id} className="border-b align-top">
                  <td className="py-3 px-3 font-medium">{p.summary}</td>

                  <td className="py-3 px-3">
                    <div className="font-medium">{p.location?.title || p.location_id}</div>
                    <div className="text-xs text-gray-500">{p.location_id}</div>
                  </td>

                  <td className="py-3 px-3">
                    <StatusPill status={p.status} />
                  </td>

                  <td className="py-3 px-3">{prettyWhen(p.scheduled_at)}</td>

                  <td className="py-3 px-3">
                    {p.provider_post_name ? <span className="text-xs break-all">{p.provider_post_name}</span> : "-"}
                  </td>

                  <td className="py-3 px-3">
                    {p.provider_error ? (
                      <span className="text-xs text-red-700 break-all" title={String(p.provider_error)}>
                        {compactErr(p.provider_error)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>

                  <td className="py-3 px-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(p)}
                        disabled={busyId === p.id || p.status === "published" || p.status === "publishing"}
                        className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => del(p)}
                        disabled={busyId === p.id}
                        className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => retry(p)}
                        disabled={busyId === p.id || p.status !== "failed"}
                        className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!filteredPosts.length && !loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-gray-500">
                    No posts match this filter/search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editing ? (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-lg bg-white rounded-xl border shadow-lg p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Edit Post</div>
                <div className="text-xs text-gray-500">{editing.location?.title}</div>
              </div>
              <button onClick={() => setEditing(null)} className="text-sm px-2 py-1 rounded hover:bg-gray-100">
                ✕
              </button>
            </div>

            <label className="block text-sm">
              <div className="text-gray-700 mb-1">Text</div>
              <textarea
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                rows={4}
              />
            </label>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" checked={editMode === "publish"} onChange={() => setEditMode("publish")} />
                Publish now
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" checked={editMode === "schedule"} onChange={() => setEditMode("schedule")} />
                Schedule
              </label>

              {editMode === "schedule" ? (
                <input
                  type="datetime-local"
                  value={editSchedule}
                  onChange={(e) => setEditSchedule(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              ) : null}
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-100">
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={busyId === editing.id}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
