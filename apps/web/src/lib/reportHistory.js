// apps/web/src/lib/reportHistory.js
// Frontend helpers for the read-only report history page.
// Wraps the existing backend endpoints:
//   GET /api/v1/reports/runs
//   GET /api/v1/reports/runs/:runId/outputs/:format
//
// The listing call goes through the existing JSON-aware api() client.
// The download call uses fetch directly because the response body is raw
// PDF/XLSX bytes (the api() client only parses JSON envelopes).
import { api } from "../apiClient";
import { getToken } from "../session";

export const REPORT_RUN_STATUSES = Object.freeze([
  "pending",
  "running",
  "succeeded",
  "failed",
]);

export const REPORT_RUN_FORMATS = Object.freeze(["pdf", "xlsx"]);

export const REPORT_LIST_LIMIT_DEFAULT = 25;
export const REPORT_LIST_LIMIT_MIN = 1;
export const REPORT_LIST_LIMIT_MAX = 100;

const SAFE_DOWNLOAD_FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value, max = 200) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

export function clampReportListLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return REPORT_LIST_LIMIT_DEFAULT;
  const rounded = Math.floor(n);
  if (rounded < REPORT_LIST_LIMIT_MIN) return REPORT_LIST_LIMIT_MIN;
  if (rounded > REPORT_LIST_LIMIT_MAX) return REPORT_LIST_LIMIT_MAX;
  return rounded;
}

export function buildReportRunsQuery(params = {}) {
  const search = new URLSearchParams();
  const organizationId = cleanText(params.organization_id, 200);
  if (organizationId) search.set("organization_id", organizationId);

  const clientId = cleanText(params.client_id, 200);
  if (clientId) search.set("client_id", clientId);

  const locationId = cleanText(params.location_id, 200);
  if (locationId) search.set("location_id", locationId);

  const reportType = cleanText(params.report_type, 80);
  if (reportType) search.set("report_type", reportType);

  const reportKey = cleanText(params.report_key, 200);
  if (reportKey) search.set("report_key", reportKey);

  const status = cleanText(params.status, 40).toLowerCase();
  if (status && REPORT_RUN_STATUSES.includes(status)) {
    search.set("status", status);
  }

  const dateFrom = cleanText(params.date_from, 20);
  if (dateFrom && YMD_PATTERN.test(dateFrom)) search.set("date_from", dateFrom);

  const dateTo = cleanText(params.date_to, 20);
  if (dateTo && YMD_PATTERN.test(dateTo)) search.set("date_to", dateTo);

  if (params.limit !== undefined && params.limit !== null && params.limit !== "") {
    search.set("limit", String(clampReportListLimit(params.limit)));
  }

  const out = search.toString();
  return out ? `?${out}` : "";
}

export function parseContentDispositionFilename(header) {
  const text = cleanText(header, 1000);
  if (!text) return "";

  const utf8Match = text.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      // Fall through to ASCII parsing below.
    }
  }

  const quotedMatch = text.match(/filename\s*=\s*"([^"]*)"/i);
  if (quotedMatch) return quotedMatch[1].trim();

  const bareMatch = text.match(/filename\s*=\s*([^;]+)/i);
  if (bareMatch) return bareMatch[1].trim();

  return "";
}

export function safeDownloadFilename(name, fallback = "report.bin") {
  const cleaned = cleanText(name, 240);
  if (cleaned && SAFE_DOWNLOAD_FILENAME_PATTERN.test(cleaned)) return cleaned;
  const fall = cleanText(fallback, 240);
  if (fall && SAFE_DOWNLOAD_FILENAME_PATTERN.test(fall)) return fall;
  return "report.bin";
}

export function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function normalizeOutput(rawOutput) {
  const output = rawOutput && typeof rawOutput === "object" ? rawOutput : {};
  const format = cleanText(output.format, 20).toLowerCase();
  const status = cleanText(output.status, 40).toLowerCase();
  const size = Number.isFinite(Number(output.size)) ? Number(output.size) : null;
  const storageProvider = cleanText(output.storage_provider, 80);
  const contentType = cleanText(output.content_type, 200);
  const filenameRaw = cleanText(output.filename, 240);
  const generatedAt = output.generated_at || null;
  const downloadable =
    status === "succeeded" && !!storageProvider && !!cleanText(output.storage_key, 1000);

  return {
    format,
    status,
    size,
    storage_provider: storageProvider,
    content_type: contentType,
    filename: filenameRaw,
    generated_at: generatedAt,
    downloadable,
    error: output.error || null,
  };
}

export function normalizeReportRunRow(rawRow) {
  const row = rawRow && typeof rawRow === "object" ? rawRow : {};
  const outputs = Array.isArray(row.outputs) ? row.outputs.map(normalizeOutput) : [];

  return {
    id: cleanText(row.id, 200),
    report_id: row.report_id || null,
    report_key: cleanText(row.report_key, 200),
    report_type: cleanText(row.report_type, 80),
    report_name: cleanText(row.report_name, 240),
    status: cleanText(row.status, 40).toLowerCase(),
    requested_formats: Array.isArray(row.requested_formats)
      ? row.requested_formats.map((value) => cleanText(value, 20).toLowerCase()).filter(Boolean)
      : [],
    outputs,
    organization_id: cleanText(row.organization_id, 200),
    client_id: cleanText(row.client_id, 200) || null,
    location_id: cleanText(row.location_id, 200) || null,
    requested_by_user_id: cleanText(row.requested_by_user_id, 200),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    error: row.error || null,
  };
}

export function describeReportHistoryError(err) {
  if (!err) return "Unknown error.";
  const code = err.code || err.error?.code || "";
  const message = err.message || err.error?.message || "";
  if (code && message) return `${code}: ${message}`;
  return message || code || "Request failed.";
}

export async function listOrganizationsForReports(apiImpl = api) {
  const out = await apiImpl("/orgs");
  return Array.isArray(out?.orgs) ? out.orgs : [];
}

export async function listReportRunsForUser(params = {}, apiImpl = api) {
  const qs = buildReportRunsQuery(params);
  if (!qs.includes("organization_id=")) {
    throw new Error("organization_id is required");
  }
  const out = await apiImpl(`/reports/runs${qs}`);
  const rows = Array.isArray(out?.report_runs) ? out.report_runs.map(normalizeReportRunRow) : [];
  const pagination = (out && typeof out.pagination === "object" && out.pagination) || {
    limit: clampReportListLimit(params.limit),
    has_more: false,
    next_cursor: null,
  };
  return { report_runs: rows, pagination };
}

function resolveApiBase() {
  try {
    const fromEnv = import.meta?.env?.VITE_API_BASE_URL;
    return String(fromEnv || "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

export async function downloadReportOutput({
  runId,
  format,
  apiBase,
  token,
  fetchImpl,
} = {}) {
  const cleanRunId = cleanText(runId, 200);
  if (!cleanRunId) throw new Error("runId is required");
  const cleanFormat = cleanText(format, 20).toLowerCase();
  if (!REPORT_RUN_FORMATS.includes(cleanFormat)) {
    throw new Error("format must be pdf or xlsx");
  }

  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  if (!doFetch) {
    throw new Error("fetch is unavailable");
  }

  const base = (apiBase !== undefined ? String(apiBase || "") : resolveApiBase()).replace(/\/$/, "");
  const authToken = token !== undefined ? token : safeGetToken();

  const url = `${base}/api/v1/reports/runs/${encodeURIComponent(cleanRunId)}/outputs/${encodeURIComponent(cleanFormat)}`;
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await doFetch(url, { method: "GET", headers });
  if (!res.ok) {
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      // Body may be empty or non-JSON; fall back to a synthetic envelope below.
    }
    const err = (parsed && (parsed.error || parsed)) || {
      code: "http_error",
      message: `HTTP ${res.status}`,
    };
    if (typeof err.status !== "number") err.status = res.status;
    throw err;
  }

  const contentDisposition = res.headers.get("content-disposition") || "";
  const contentType = res.headers.get("content-type") || "";
  const parsedName = parseContentDispositionFilename(contentDisposition);
  const filename = safeDownloadFilename(parsedName, `report-${cleanRunId}.${cleanFormat}`);
  const blob = await res.blob();

  return {
    blob,
    filename,
    contentType: contentType || (blob && blob.type) || "application/octet-stream",
    size: blob && Number.isFinite(blob.size) ? blob.size : 0,
  };
}

function safeGetToken() {
  try {
    return getToken();
  } catch {
    return "";
  }
}
