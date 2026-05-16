// apps/web/src/pages/ReportHistory.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { downloadBlob } from "../reportDownloads";
import {
  REPORT_LIST_LIMIT_DEFAULT,
  REPORT_LIST_LIMIT_MAX,
  REPORT_LIST_LIMIT_MIN,
  REPORT_RUN_STATUSES,
  clampReportListLimit,
  describeReportHistoryError,
  downloadReportOutput,
  formatBytes,
  listOrganizationsForReports,
  listReportRunsForUser,
} from "../lib/reportHistory";

const emptyFilters = Object.freeze({
  status: "",
  report_type: "",
  report_key: "",
  date_from: "",
  date_to: "",
  limit: String(REPORT_LIST_LIMIT_DEFAULT),
});

function statusBadge(status) {
  const s = String(status || "").toLowerCase();
  const cls =
    s === "succeeded"
      ? "bg-green-100 text-green-700"
      : s === "failed"
      ? "bg-red-100 text-red-700"
      : s === "running"
      ? "bg-blue-100 text-blue-700"
      : s === "pending"
      ? "bg-amber-100 text-amber-800"
      : "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${cls}`}>
      {status || "-"}
    </span>
  );
}

function formatDate(value) {
  if (!value) return "-";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString();
  } catch {
    return "-";
  }
}

function shortId(value) {
  const text = String(value || "");
  if (!text) return "-";
  if (text.length <= 12) return text;
  return `${text.slice(0, 8)}…`;
}

function ScopeSummary({ run }) {
  const parts = [];
  parts.push(`org ${run.organization_id || "-"}`);
  parts.push(run.client_id ? `client ${shortId(run.client_id)}` : "client -");
  parts.push(run.location_id ? `location ${shortId(run.location_id)}` : "location -");
  return <span className="text-xs text-gray-600 break-all">{parts.join(" · ")}</span>;
}

export default function ReportHistory({ onLogout }) {
  const [orgs, setOrgs] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsError, setOrgsError] = useState("");

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);

  const [runs, setRuns] = useState([]);
  const [pagination, setPagination] = useState({
    limit: REPORT_LIST_LIMIT_DEFAULT,
    has_more: false,
    next_cursor: null,
  });
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState("");
  const [runsStatus, setRunsStatus] = useState("");

  const [downloadBusy, setDownloadBusy] = useState({});
  const [downloadMessage, setDownloadMessage] = useState("");

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === selectedOrgId) || null,
    [orgs, selectedOrgId],
  );

  const loadOrgs = useCallback(async () => {
    setOrgsLoading(true);
    setOrgsError("");
    try {
      const rows = await listOrganizationsForReports();
      setOrgs(rows);
      if (!rows.length) {
        setSelectedOrgId("");
      } else if (!rows.find((o) => o.id === selectedOrgId)) {
        setSelectedOrgId(rows[0].id);
      }
    } catch (err) {
      setOrgsError(describeReportHistoryError(err));
    } finally {
      setOrgsLoading(false);
    }
  }, [selectedOrgId]);

  const loadRuns = useCallback(
    async (orgId, filterValues) => {
      if (!orgId) {
        setRuns([]);
        setRunsStatus("Select an organization above to list runs.");
        return;
      }
      setRunsLoading(true);
      setRunsError("");
      setRunsStatus("");
      try {
        const out = await listReportRunsForUser({
          organization_id: orgId,
          status: filterValues.status,
          report_type: filterValues.report_type,
          report_key: filterValues.report_key,
          date_from: filterValues.date_from,
          date_to: filterValues.date_to,
          limit: filterValues.limit,
        });
        setRuns(out.report_runs);
        setPagination(out.pagination);
        if (!out.report_runs.length) {
          setRunsStatus("No runs match the current filters.");
        }
      } catch (err) {
        setRuns([]);
        setPagination({
          limit: clampReportListLimit(filterValues.limit),
          has_more: false,
          next_cursor: null,
        });
        setRunsError(describeReportHistoryError(err));
      } finally {
        setRunsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    loadOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedOrgId) {
      setRuns([]);
      return;
    }
    setAppliedFilters(filters);
    loadRuns(selectedOrgId, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId]);

  function setFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  function onApplyFilters(event) {
    event.preventDefault();
    if (!selectedOrgId) return;
    setAppliedFilters(filters);
    loadRuns(selectedOrgId, filters);
  }

  function onResetFilters() {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    if (selectedOrgId) loadRuns(selectedOrgId, emptyFilters);
  }

  function onRefresh() {
    if (selectedOrgId) loadRuns(selectedOrgId, appliedFilters);
  }

  async function onDownload(run, output) {
    if (!run?.id || !output?.format || !output?.downloadable) return;
    const key = `${run.id}:${output.format}`;
    setDownloadBusy((prev) => ({ ...prev, [key]: true }));
    setDownloadMessage("");
    try {
      const { blob, filename } = await downloadReportOutput({
        runId: run.id,
        format: output.format,
      });
      downloadBlob(filename, blob);
      setDownloadMessage(`Downloaded ${filename}.`);
    } catch (err) {
      setDownloadMessage(describeReportHistoryError(err));
    } finally {
      setDownloadBusy((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  const hasActiveFilters = useMemo(() => {
    return Object.entries(appliedFilters).some(([k, v]) => {
      if (k === "limit") return false;
      return !!String(v || "").trim();
    });
  }, [appliedFilters]);

  return (
    <AppShell
      title="Report history"
      subtitle="Read-only listing of generated dashboard snapshot reports. Downloads stream the persisted PDF/XLSX bytes from local storage."
      onLogout={onLogout}
    >
      <div className="space-y-6">
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <label htmlFor="org-select" className="block text-sm font-medium text-gray-700">
                Organization
              </label>
              <select
                id="org-select"
                value={selectedOrgId}
                onChange={(event) => setSelectedOrgId(event.target.value)}
                disabled={orgsLoading || !orgs.length}
                className="mt-1 w-full px-3 py-2 border rounded-lg disabled:opacity-60"
              >
                {!orgs.length ? (
                  <option value="">No organizations available</option>
                ) : (
                  orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name || o.id}
                    </option>
                  ))
                )}
              </select>
              {selectedOrg ? (
                <p className="mt-1 text-xs text-gray-500">id: {selectedOrg.id}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadOrgs}
                disabled={orgsLoading}
                className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
              >
                {orgsLoading ? "Loading…" : "Refresh orgs"}
              </button>
              <button
                type="button"
                onClick={onRefresh}
                disabled={!selectedOrgId || runsLoading}
                className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
              >
                {runsLoading ? "Loading…" : "Refresh runs"}
              </button>
            </div>
          </div>
          {orgsError ? (
            <div role="alert" className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-900">
              {orgsError}
            </div>
          ) : null}
          <p className="text-xs text-gray-500">
            Report history currently shows generated dashboard snapshot reports. Downloads require
            durable local output files; older smoke files written under <code>/tmp</code> may have
            been wiped on host reboot and may not be available.
          </p>
        </div>

        <form
          onSubmit={onApplyFilters}
          className="bg-white border rounded-xl p-5 space-y-3"
          aria-label="Report history filters"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label htmlFor="filter-status" className="block text-sm font-medium text-gray-700">
                Status
              </label>
              <select
                id="filter-status"
                value={filters.status}
                onChange={(event) => setFilter("status", event.target.value)}
                className="mt-1 w-full px-3 py-2 border rounded-lg"
              >
                <option value="">Any status</option>
                {REPORT_RUN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filter-type" className="block text-sm font-medium text-gray-700">
                Report type
              </label>
              <input
                id="filter-type"
                type="text"
                value={filters.report_type}
                onChange={(event) => setFilter("report_type", event.target.value)}
                placeholder="e.g. dashboard_snapshot"
                autoComplete="off"
                className="mt-1 w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="filter-key" className="block text-sm font-medium text-gray-700">
                Report key
              </label>
              <input
                id="filter-key"
                type="text"
                value={filters.report_key}
                onChange={(event) => setFilter("report_key", event.target.value)}
                placeholder="e.g. gbp_dashboard_snapshot"
                autoComplete="off"
                className="mt-1 w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="filter-from" className="block text-sm font-medium text-gray-700">
                Created from (UTC, YYYY-MM-DD)
              </label>
              <input
                id="filter-from"
                type="date"
                value={filters.date_from}
                onChange={(event) => setFilter("date_from", event.target.value)}
                className="mt-1 w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="filter-to" className="block text-sm font-medium text-gray-700">
                Created to (UTC, YYYY-MM-DD)
              </label>
              <input
                id="filter-to"
                type="date"
                value={filters.date_to}
                onChange={(event) => setFilter("date_to", event.target.value)}
                className="mt-1 w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="filter-limit" className="block text-sm font-medium text-gray-700">
                Limit ({REPORT_LIST_LIMIT_MIN}–{REPORT_LIST_LIMIT_MAX})
              </label>
              <input
                id="filter-limit"
                type="number"
                min={REPORT_LIST_LIMIT_MIN}
                max={REPORT_LIST_LIMIT_MAX}
                value={filters.limit}
                onChange={(event) => setFilter("limit", event.target.value)}
                className="mt-1 w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!selectedOrgId || runsLoading}
              className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50"
            >
              {runsLoading ? "Loading…" : "Apply filters"}
            </button>
            <button
              type="button"
              onClick={onResetFilters}
              disabled={runsLoading}
              className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
            >
              Reset
            </button>
            {hasActiveFilters ? (
              <span className="text-xs text-gray-500">Filters applied.</span>
            ) : null}
          </div>
        </form>

        <div className="bg-white border rounded-xl p-5 space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Runs</h2>
            <p className="text-xs text-gray-500">
              Sorted newest first. Limit {pagination?.limit ?? REPORT_LIST_LIMIT_DEFAULT}
              {pagination?.has_more ? " · more results available; narrow filters to see older runs." : ""}
            </p>
          </div>

          {runsError ? (
            <div role="alert" className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-900">
              {runsError}
            </div>
          ) : null}
          {downloadMessage ? (
            <div role="status" className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
              {downloadMessage}
            </div>
          ) : null}

          {runsLoading ? (
            <div className="text-sm text-gray-600">Loading runs…</div>
          ) : runs.length ? (
            <ul className="divide-y rounded-lg border">
              {runs.map((run) => (
                <li key={run.id || `${run.report_key}-${run.created_at}`} className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium break-all">
                        {run.report_name || run.report_key || run.id || "Untitled report"}
                      </span>
                      {statusBadge(run.status)}
                      <span className="inline-flex px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700">
                        {run.report_type || "-"}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">id {shortId(run.id)}</div>
                  </div>

                  <div className="text-xs text-gray-600 grid grid-cols-1 sm:grid-cols-2 gap-1">
                    <div>
                      <span className="font-medium text-gray-700">report_key:</span>{" "}
                      <span className="break-all font-mono">{run.report_key || "-"}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">requested:</span>{" "}
                      {(run.requested_formats || []).join(", ") || "-"}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">scope:</span>{" "}
                      <ScopeSummary run={run} />
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">requested_by_user_id:</span>{" "}
                      <span className="break-all font-mono">{run.requested_by_user_id || "-"}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">created:</span>{" "}
                      {formatDate(run.created_at)}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">completed:</span>{" "}
                      {formatDate(run.completed_at)}
                    </div>
                  </div>

                  {run.error ? (
                    <div role="alert" className="rounded-lg border bg-red-50 p-2 text-xs text-red-800">
                      {run.error.code || "error"}
                      {run.error.message ? `: ${run.error.message}` : ""}
                    </div>
                  ) : null}

                  <div className="rounded-lg border divide-y">
                    {(run.outputs || []).length ? (
                      run.outputs.map((output) => {
                        const key = `${run.id}:${output.format}`;
                        const busy = !!downloadBusy[key];
                        return (
                          <div
                            key={`${run.id}-${output.format}`}
                            className="p-2 flex flex-wrap items-center gap-2 justify-between"
                          >
                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
                              <span className="font-semibold uppercase">{output.format || "-"}</span>
                              {statusBadge(output.status)}
                              <span>{formatBytes(output.size)}</span>
                              <span className="text-gray-500">
                                storage {output.storage_provider || "-"}
                              </span>
                              {output.error ? (
                                <span className="text-red-700">
                                  {output.error.code || "error"}
                                </span>
                              ) : null}
                            </div>
                            <div>
                              <button
                                type="button"
                                onClick={() => onDownload(run, output)}
                                disabled={!output.downloadable || busy}
                                className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-100 disabled:opacity-50"
                                aria-label={`Download ${output.format} for ${run.report_key || run.id}`}
                              >
                                {busy
                                  ? "Downloading…"
                                  : output.downloadable
                                  ? `Download ${String(output.format || "").toUpperCase()}`
                                  : "Unavailable"}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-2 text-xs text-gray-500">No outputs recorded.</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-gray-600">
              {runsStatus || (selectedOrgId ? "No runs to show for this organization." : "Select an organization above to list runs.")}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
