import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import AppShell from "../components/AppShell";
import ActiveLocationPicker from "../components/ActiveLocationPicker";
import { api } from "../apiClient";
import { getActiveLocationId } from "../session";

const STATUS_VALUES = new Set(["all", "replied", "unreplied"]);
const PAGE_SIZES = [10, 20, 50, 100];

function prettyWhen(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error, fallback) {
  return error?.message || error?.errors?.[0]?.message || fallback;
}

function hasBusinessReply(review) {
  return typeof review?.reviewReply?.comment === "string"
    && review.reviewReply.comment.trim().length > 0;
}

function Stars({ value }) {
  const names = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  const raw = typeof value === "number" ? value : names[String(value || "").toUpperCase()] || Number.parseInt(value, 10);
  const rating = Number.isFinite(raw) ? Math.max(0, Math.min(5, Math.round(raw))) : 0;
  return <div className="flex items-center gap-2" aria-label={`Rating ${rating ? `${rating}/5` : "-"}`}>
    <div className="flex">{Array.from({ length: 5 }, (_, index) => <span key={index} className={index < rating ? "text-gray-900" : "text-gray-300"}>★</span>)}</div>
    <span className="text-xs text-gray-500">{rating ? `${rating}/5` : "-"}</span>
  </div>;
}

export default function Reviews({ onLogout }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [locationId, setLocationId] = useState(getActiveLocationId());
  const rawStatus = String(searchParams.get("status") || "all").toLowerCase();
  const status = STATUS_VALUES.has(rawStatus) ? rawStatus : "all";
  const keyword = searchParams.get("keyword") || "";
  const page = positiveInteger(searchParams.get("page"), 1);
  const rawPerPage = positiveInteger(searchParams.get("perPage"), 10);
  const perPage = PAGE_SIZES.includes(rawPerPage) ? rawPerPage : 10;

  const [searchInput, setSearchInput] = useState(keyword);
  const [reviews, setReviews] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, perPage: 10, total: 0, totalPages: 0 });
  const [counts, setCounts] = useState({ total: 0, replied: 0, unreplied: 0 });
  const [sync, setSync] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [replying, setReplying] = useState({});
  const [editing, setEditing] = useState({});
  const [busyId, setBusyId] = useState("");
  const generationRef = useRef(0);
  const requestRef = useRef(null);
  const previousLocationRef = useRef(locationId);
  const scopeRef = useRef("");
  const latestLoadRef = useRef(null);
  scopeRef.current = `${locationId}|${status}|${keyword}|${page}|${perPage}`;

  const updateQuery = useCallback((changes) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === "" || value == null) next.delete(key);
        else next.set(key, String(value));
      });
      return next;
    });
  }, [setSearchParams]);

  useEffect(() => setSearchInput(keyword), [keyword]);
  useEffect(() => {
    if (searchInput === keyword) return undefined;
    const timeout = setTimeout(() => updateQuery({ keyword: searchInput.trim(), page: 1 }), 350);
    return () => clearTimeout(timeout);
  }, [keyword, searchInput, updateQuery]);

  const load = useCallback(async () => {
    if (!locationId) return null;
    const generation = ++generationRef.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      locationId,
      status,
      keyword,
      page: String(page),
      perPage: String(perPage),
    });
    try {
      const result = await api(`/reviews?${query.toString()}`, { signal: controller.signal });
      if (generation !== generationRef.current) return null;
      const data = result.data || {};
      setReviews(Array.isArray(data.reviews) ? data.reviews : []);
      setPagination(data.pagination || { page, perPage, total: 0, totalPages: 0 });
      setCounts(data.counts || { total: 0, replied: 0, unreplied: 0 });
      setSync(data.sync || null);
      return data;
    } catch (requestError) {
      if (requestError?.name === "AbortError" || generation !== generationRef.current) return null;
      setReviews([]);
      setError(errorMessage(requestError, "Unable to load reviews"));
      return null;
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [keyword, locationId, page, perPage, status]);
  latestLoadRef.current = load;

  useEffect(() => {
    load();
    return () => requestRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (previousLocationRef.current === locationId) return;
    previousLocationRef.current = locationId;
    setReplying({});
    setEditing({});
    setBusyId("");
    setReviews([]);
    setPagination({ page: 1, perPage, total: 0, totalPages: 0 });
    setCounts({ total: 0, replied: 0, unreplied: 0 });
    setSync(null);
    setError("");
    setNotice("");
    updateQuery({ page: 1 });
  }, [locationId, perPage, updateQuery]);

  async function syncNow() {
    if (!locationId || syncing) return;
    setSyncing(true);
    setError("");
    setNotice("");
    const mutationScope = scopeRef.current;
    try {
      const result = await api("/reviews/sync", { method: "POST", body: { locationId } });
      if (scopeRef.current !== mutationScope) return;
      setNotice(result.message || "Review synchronization queued");
      await latestLoadRef.current?.();
    } catch (syncError) {
      setError(errorMessage(syncError, "Unable to queue review synchronization"));
    } finally {
      setSyncing(false);
    }
  }

  async function sendReply(review) {
    const comment = String(replying[review.id] ?? "").trim();
    if (!comment || busyId) return;
    setBusyId(review.id);
    setError("");
    const mutationScope = scopeRef.current;
    try {
      await api(`/reviews/${review.id}/reply`, { method: "PUT", body: { comment } });
      if (scopeRef.current !== mutationScope) return;
      const data = await latestLoadRef.current?.();
      if (!data || scopeRef.current !== mutationScope) return;
      const lastPage = Math.max(1, data?.pagination?.totalPages || 1);
      if (page > lastPage) updateQuery({ page: lastPage });
      setEditing((current) => ({ ...current, [review.id]: false }));
    } catch (replyError) {
      setError(errorMessage(replyError, "Unable to update review reply"));
    } finally {
      setBusyId("");
    }
  }

  const range = useMemo(() => {
    if (!pagination.total || !reviews.length) return "0 shown";
    const start = (pagination.page - 1) * pagination.perPage + 1;
    return `${start}–${start + reviews.length - 1} of ${pagination.total} matching`;
  }, [pagination, reviews.length]);

  return <AppShell title="Reviews" subtitle="Sync Google Business Profile reviews and reply" onLogout={onLogout} actions={<div className="flex items-center gap-2">
    <button onClick={load} disabled={!locationId || loading} className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-50">Refresh</button>
    <button onClick={syncNow} disabled={!locationId || syncing} className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm disabled:opacity-50">{syncing ? "Queueing…" : "Sync from Google"}</button>
  </div>}>
    <div className="bg-white border rounded-xl p-5 space-y-4">
      {error ? <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</div> : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <div><div className="text-sm text-gray-600 mb-2">Active Location</div><ActiveLocationPicker value={locationId} onChange={setLocationId} /></div>
        <div className="text-sm text-gray-600 md:text-right space-y-2">
          <div><span className="font-medium text-gray-800">{range}</span> · <span className="font-medium text-gray-800">{counts.total} total</span></div>
          <div className="text-xs text-gray-500">Unreplied: {counts.unreplied} · Replied: {counts.replied}</div>
          <div className="text-xs text-gray-500">Last sync: {prettyWhen(sync?.last_synced_at)}{sync?.last_error ? <span className="text-red-700"> · Error: {sync.last_error.message || "sync_failed"}</span> : null}</div>
          <div className="flex flex-col items-start md:items-end gap-2">
            <div className="inline-flex rounded-lg border overflow-hidden">{["all", "unreplied", "replied"].map((value) => <button key={value} type="button" aria-pressed={status === value} onClick={() => updateQuery({ status: value, page: 1 })} className={`px-3 py-1.5 text-xs ${status === value ? "bg-gray-900 text-white" : "bg-white text-gray-700"}`}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
            <div className="w-full md:w-72 relative"><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search reviewer / keyword…" className="w-full px-3 py-2 pr-10 rounded-lg border text-sm bg-white" />{searchInput ? <button type="button" onClick={() => setSearchInput("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500">✕</button> : null}</div>
          </div>
        </div>
      </div>

      {!locationId ? <div className="py-10 text-center text-gray-500">Pick a location to load reviews.</div> : null}
      {locationId && loading && !reviews.length ? <div className="py-10 text-center text-gray-500">Loading…</div> : null}
      {locationId && !loading && !error && !reviews.length ? <div className="py-10 text-center text-gray-500">{keyword ? <>No reviews match <b>{keyword}</b>.</> : status === "unreplied" ? "No unreplied reviews." : status === "replied" ? "No replied reviews yet." : <>No reviews in DB yet. Click <b>Sync from Google</b>.</>}</div> : null}

      <div className="space-y-3">{reviews.map((review) => {
        const existing = typeof review.reviewReply?.comment === "string" ? review.reviewReply.comment.trim() : "";
        const hasReply = hasBusinessReply(review);
        const isEditing = Boolean(editing[review.id]);
        const draft = String(replying[review.id] ?? existing);
        return <div key={review.id} className="border rounded-xl p-4 bg-white">
          <div className="flex items-start justify-between gap-3"><div><div className="font-semibold">{review.reviewer?.displayName || review.reviewer?.name || "Anonymous"}</div><div className="mt-1 flex gap-3"><Stars value={review.starRating} /><span className="text-xs text-gray-500">Updated: {prettyWhen(review.updateTime)}</span></div></div><span className="text-xs px-2 py-1 rounded-full border">{hasReply ? "Replied" : "Unreplied"}</span></div>
          {review.comment ? <div className="mt-3 text-gray-800 whitespace-pre-wrap">{review.comment}</div> : <div className="mt-3 text-gray-500 text-sm italic">No comment text.</div>}
          <div className="mt-4 pt-4 border-t space-y-2"><div className="flex items-center justify-between"><div className="text-sm font-semibold">Reply</div>{hasReply && !isEditing ? <button onClick={() => { setEditing((value) => ({ ...value, [review.id]: true })); setReplying((value) => ({ ...value, [review.id]: existing })); }} className="px-3 py-1.5 rounded-lg border text-xs">Edit Reply</button> : null}</div>
            {hasReply && !isEditing ? <div className="text-sm bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap">{existing}</div> : <><textarea rows={3} placeholder={hasReply ? "Edit your reply…" : "Write a reply…"} value={draft} onChange={(event) => setReplying((value) => ({ ...value, [review.id]: event.target.value }))} className="border rounded-lg w-full p-2 text-sm" /><div className="flex justify-end"><button onClick={() => sendReply(review)} disabled={busyId === review.id || !draft.trim() || (hasReply && draft.trim() === existing)} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm disabled:opacity-50">{busyId === review.id ? "Saving…" : hasReply ? "Save Reply" : "Send Reply"}</button></div></>}
          </div>
        </div>;
      })}</div>

      {locationId ? <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <label className="text-sm text-gray-600">Rows <select aria-label="Reviews per page" value={perPage} onChange={(event) => updateQuery({ perPage: event.target.value, page: 1 })} className="ml-2 rounded border px-2 py-1">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        <div className="flex items-center gap-3"><button aria-label="Previous page" disabled={loading || page <= 1} onClick={() => updateQuery({ page: page - 1 })} className="rounded border px-3 py-1.5 disabled:opacity-50">Previous</button><span className="text-sm">Page {page} of {Math.max(1, pagination.totalPages)}</span><button aria-label="Next page" disabled={loading || page >= pagination.totalPages} onClick={() => updateQuery({ page: page + 1 })} className="rounded border px-3 py-1.5 disabled:opacity-50">Next</button></div>
      </div> : null}
    </div>
  </AppShell>;
}
