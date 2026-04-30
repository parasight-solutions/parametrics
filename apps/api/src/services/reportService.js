import crypto from "crypto";

export const REPORT_STATUSES = Object.freeze([
  "pending",
  "running",
  "succeeded",
  "failed",
]);

export const REPORT_OUTPUT_FORMATS = Object.freeze(["pdf", "xlsx"]);

const DEFAULT_REPORT_TYPE = "dashboard_snapshot";
const DEFAULT_REPORT_NAME = "Dashboard snapshot";
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 5;
const MAX_SNAPSHOT_JSON_CHARS = 60_000;
const MAX_DATE_RANGE_DAYS = 366;

const SECRET_KEY_RE = /(?:password|passcode|secret|token|jwt|authorization|auth_code|code|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secrets_json)/i;

function cleanStr(value, max = MAX_STRING_LENGTH) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function makeError(code, message, data = null) {
  const err = new Error(message || code);
  err.code = code;
  if (data) err.data = data;
  return err;
}

function ymdFromDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }

  const s = cleanStr(value, 40);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));

  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return "";
  }

  return s;
}

function dateRangeDays(start, end) {
  const a = new Date(`${start}T00:00:00.000Z`).getTime();
  const b = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function normalizeDateRange(input = {}) {
  const range = input.date_range || input.dateRange || input.filters?.date_range || {};
  const start = ymdFromDate(range.start || input.start || input.start_date);
  const end = ymdFromDate(range.end || input.end || input.end_date);

  if (!start || !end) {
    throw makeError("invalid_date_range", "date range start and end must be YYYY-MM-DD");
  }

  const days = dateRangeDays(start, end);
  if (days < 1) {
    throw makeError("invalid_date_range", "date range end must be on or after start");
  }
  if (days > MAX_DATE_RANGE_DAYS) {
    throw makeError("invalid_date_range", `date range may not exceed ${MAX_DATE_RANGE_DAYS} days`);
  }

  return { start, end, days };
}

export function normalizeRequestedFormats(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : ["pdf"];
  const formats = Array.from(
    new Set(
      raw
        .map((item) => cleanStr(item, 20).toLowerCase())
        .filter(Boolean)
    )
  );

  if (!formats.length) {
    throw makeError("invalid_report_formats", "at least one report format is required");
  }

  const invalid = formats.filter((format) => !REPORT_OUTPUT_FORMATS.includes(format));
  if (invalid.length) {
    throw makeError("invalid_report_formats", "unsupported report format", {
      invalid,
      allowed: [...REPORT_OUTPUT_FORMATS],
    });
  }

  return formats;
}

function sanitizeValue(value, depth) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "string") return cleanStr(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;

  if (depth >= MAX_DEPTH) return "[truncated]";

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      const safeKey = cleanStr(key, 120);
      if (!safeKey) continue;
      out[safeKey] = SECRET_KEY_RE.test(safeKey)
        ? "[redacted]"
        : sanitizeValue(child, depth + 1);
    }
    return out;
  }

  return cleanStr(value);
}

export function sanitizeReportMetadata(value = {}) {
  const clean = sanitizeValue(value, 0);
  if (!clean || typeof clean !== "object" || Array.isArray(clean)) return {};

  const encoded = JSON.stringify(clean);
  if (encoded.length <= MAX_SNAPSHOT_JSON_CHARS) return clean;

  return {
    truncated: true,
    original_size_chars: encoded.length,
    message: "report metadata exceeded size cap",
  };
}

function normalizeNamedItems(value) {
  return Array.isArray(value)
    ? value.map((item) => sanitizeReportMetadata(item)).filter(Boolean)
    : [];
}

export function normalizeDashboardSnapshot(snapshot = {}) {
  const raw = snapshot.dashboard_snapshot || snapshot.dashboardSnapshot || snapshot.snapshot || snapshot;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw makeError("invalid_dashboard_snapshot", "dashboard snapshot must be an object");
  }

  const normalized = {
    title: cleanStr(raw.title || raw.name || "Dashboard snapshot", 160),
    provider: cleanStr(raw.provider || "google", 80) || "google",
    sections: normalizeNamedItems(raw.sections),
    cards: normalizeNamedItems(raw.cards || raw.kpis),
    tables: normalizeNamedItems(raw.tables),
    charts: normalizeNamedItems(raw.charts),
    metrics: normalizeNamedItems(raw.metrics),
    metadata: sanitizeReportMetadata(raw.metadata || {}),
  };

  return sanitizeReportMetadata(normalized);
}

export function summarizeDashboardSnapshot(snapshot = {}) {
  return {
    title: cleanStr(snapshot.title || "Dashboard snapshot", 160),
    provider: cleanStr(snapshot.provider || "google", 80) || "google",
    section_count: Array.isArray(snapshot.sections) ? snapshot.sections.length : 0,
    card_count: Array.isArray(snapshot.cards) ? snapshot.cards.length : 0,
    table_count: Array.isArray(snapshot.tables) ? snapshot.tables.length : 0,
    chart_count: Array.isArray(snapshot.charts) ? snapshot.charts.length : 0,
    metric_count: Array.isArray(snapshot.metrics) ? snapshot.metrics.length : 0,
  };
}

export function createPendingOutput(format, now = new Date()) {
  const normalizedFormat = cleanStr(format, 20).toLowerCase();
  if (!REPORT_OUTPUT_FORMATS.includes(normalizedFormat)) {
    throw makeError("invalid_report_format", "unsupported report output format", {
      format,
      allowed: [...REPORT_OUTPUT_FORMATS],
    });
  }

  return {
    format: normalizedFormat,
    status: "pending",
    path: null,
    size: null,
    error: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
}

export function markOutputSucceeded(output, { path = null, size = null, completedAt = new Date() } = {}) {
  const n = Number(size);
  return {
    ...output,
    status: "succeeded",
    path: cleanStr(path, 1000) || null,
    size: Number.isFinite(n) && n >= 0 ? Math.floor(n) : null,
    error: null,
    updated_at: completedAt,
    completed_at: completedAt,
  };
}

export function markOutputFailed(output, { error = null, completedAt = new Date() } = {}) {
  const message = typeof error === "string" ? error : error?.message || error?.code || "report_output_failed";
  const code = typeof error === "object" && error?.code ? error.code : "report_output_failed";

  return {
    ...output,
    status: "failed",
    error: {
      code: cleanStr(code, 120) || "report_output_failed",
      message: cleanStr(message, 500) || "report_output_failed",
    },
    updated_at: completedAt,
    completed_at: completedAt,
  };
}

export function buildDashboardSnapshotReportRun(input = {}, opts = {}) {
  const now = opts.now || new Date();
  const idFactory = opts.idFactory || crypto.randomUUID;
  const requestedFormats = normalizeRequestedFormats(
    input.requested_formats || input.requestedFormats || input.formats
  );
  const dateRange = normalizeDateRange(input);
  const snapshot = normalizeDashboardSnapshot(input.dashboard_snapshot || input.dashboardSnapshot || input.snapshot);
  const actor = input.actor || input.requester || input.user || {};

  const reportType = cleanStr(input.report_type || input.reportType || DEFAULT_REPORT_TYPE, 80) || DEFAULT_REPORT_TYPE;
  const reportName = cleanStr(input.report_name || input.reportName || DEFAULT_REPORT_NAME, 160) || DEFAULT_REPORT_NAME;
  const reportKey = cleanStr(input.report_key || input.reportKey || reportType, 160) || DEFAULT_REPORT_TYPE;

  return {
    id: idFactory(),
    report_id: cleanStr(input.report_id || input.reportId, 200) || null,
    report_key: reportKey,
    report_type: reportType,
    report_name: reportName,
    status: "pending",
    requested_formats: requestedFormats,
    outputs: requestedFormats.map((format) => createPendingOutput(format, now)),
    input_snapshot: snapshot,
    input_snapshot_summary: summarizeDashboardSnapshot(snapshot),
    filters: {
      date_range: dateRange,
      metadata: sanitizeReportMetadata(input.filters?.metadata || {}),
    },
    organization_id: cleanStr(input.organization_id || input.organizationId, 200) || null,
    client_id: cleanStr(input.client_id || input.clientId, 200) || null,
    location_id: cleanStr(input.location_id || input.locationId, 200) || null,
    requested_by_user_id: cleanStr(
      input.requested_by_user_id ||
      input.requestedByUserId ||
      actor.user_id ||
      actor.id,
      200
    ) || null,
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
  };
}
