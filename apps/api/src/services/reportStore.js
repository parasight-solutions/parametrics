import crypto from "crypto";
import { col } from "../lib/mongo.js";
import {
  REPORT_OUTPUT_FORMATS,
  REPORT_STATUSES,
  normalizeRequestedFormats,
  sanitizeReportMetadata,
} from "./reportService.js";

export const REPORT_DEFINITION_STATUSES = Object.freeze(["active", "archived"]);

const DEFAULT_REPORT_TYPE = "dashboard_snapshot";
const DEFAULT_REPORT_NAME = "Dashboard report";

function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function makeError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function compactError(error = null) {
  if (!error) return null;

  const code = cleanStr(error.code || error.name || "report_run_failed", 120) || "report_run_failed";
  const message = cleanStr(error.message || error.code || "report run failed", 500) || "report run failed";

  return { code, message };
}

function normalizeStatus(value, allowed, fallback, code) {
  const status = cleanStr(value, 40).toLowerCase() || fallback;
  if (!allowed.includes(status)) {
    throw makeError(code, `unsupported status: ${status}`);
  }
  return status;
}

function normalizeScope(input = {}) {
  const organizationId = cleanStr(input.organization_id || input.organizationId, 200);
  const clientId = cleanStr(input.client_id || input.clientId, 200);
  const locationId = cleanStr(input.location_id || input.locationId, 200);

  if (!organizationId) {
    throw makeError("missing_report_scope", "organization_id is required for report persistence");
  }

  if (locationId && !clientId) {
    throw makeError("missing_report_scope", "client_id is required when location_id is set");
  }

  return {
    organization_id: organizationId,
    client_id: clientId || null,
    location_id: locationId || null,
  };
}

function normalizeReportKey(input = {}) {
  const key = cleanStr(input.report_key || input.reportKey, 160);
  if (!key) throw makeError("missing_report_key", "report_key is required");
  return key;
}

function normalizeChecksum(value) {
  if (!value || typeof value !== "object") return null;
  const algorithm = cleanStr(value.algorithm, 40).toLowerCase();
  const checksum = cleanStr(value.value, 256);
  if (!algorithm || !checksum) return null;
  return { algorithm, value: checksum };
}

function normalizeOutputs(outputs = []) {
  if (!Array.isArray(outputs)) return [];

  return outputs
    .filter((output) => REPORT_OUTPUT_FORMATS.includes(cleanStr(output?.format, 20).toLowerCase()))
    .map((output) => ({
      format: cleanStr(output.format, 20).toLowerCase(),
      status: normalizeStatus(output.status, REPORT_STATUSES, "pending", "invalid_report_run_status"),
      path: cleanStr(output.path, 1000) || null,
      size: Number.isFinite(Number(output.size)) && Number(output.size) >= 0
        ? Math.floor(Number(output.size))
        : null,
      storage_provider: cleanStr(output.storage_provider, 80) || null,
      storage_key: cleanStr(output.storage_key, 1000) || null,
      content_type: cleanStr(output.content_type, 200) || null,
      filename: cleanStr(output.filename, 200) || null,
      checksum: normalizeChecksum(output.checksum),
      generated_at: output.generated_at || null,
      expires_at: output.expires_at || null,
      error: compactError(output.error),
      created_at: output.created_at || null,
      updated_at: output.updated_at || null,
      completed_at: output.completed_at || null,
    }));
}

function normalizeRunStatus(status) {
  return normalizeStatus(status, REPORT_STATUSES, "pending", "invalid_report_run_status");
}

async function resolveCollections(options = {}) {
  const collections = options.collections || {};
  if (collections.reports && (collections.reportRuns || collections.report_runs)) {
    return {
      reports: collections.reports,
      reportRuns: collections.reportRuns || collections.report_runs,
    };
  }

  const db = options.db;
  if (db?.collection) {
    return {
      reports: db.collection("reports"),
      reportRuns: db.collection("report_runs"),
    };
  }

  return {
    reports: await col("reports"),
    reportRuns: await col("report_runs"),
  };
}

async function findOneAndUpdate(collection, filter, update, options = {}) {
  if (collection.findOneAndUpdate) {
    const result = await collection.findOneAndUpdate(filter, update, {
      returnDocument: "after",
      projection: { _id: 0 },
      ...options,
    });
    if (result && Object.prototype.hasOwnProperty.call(result, "value")) {
      return result.value || null;
    }
    return result || null;
  }

  await collection.updateOne(filter, update);
  return collection.findOne ? collection.findOne(filter, { projection: { _id: 0 } }) : null;
}

export function buildReportDefinitionDoc(input = {}, opts = {}) {
  const now = opts.now || new Date();
  const idFactory = opts.idFactory || crypto.randomUUID;
  const scope = normalizeScope(input);
  const reportKey = normalizeReportKey(input);
  const type = cleanStr(input.type || input.report_type || input.reportType || DEFAULT_REPORT_TYPE, 80) || DEFAULT_REPORT_TYPE;
  const name = cleanStr(input.name || input.report_name || input.reportName || DEFAULT_REPORT_NAME, 160) || DEFAULT_REPORT_NAME;
  const status = normalizeStatus(
    input.status,
    REPORT_DEFINITION_STATUSES,
    "active",
    "invalid_report_definition_status"
  );

  return {
    id: cleanStr(input.id, 200) || idFactory(),
    report_key: reportKey,
    name,
    type,
    scope: { ...scope },
    organization_id: scope.organization_id,
    client_id: scope.client_id,
    location_id: scope.location_id,
    default_formats: normalizeRequestedFormats(input.default_formats || input.defaultFormats || input.requested_formats),
    status,
    created_by_user_id: cleanStr(input.created_by_user_id || input.createdByUserId, 200) || null,
    metadata: sanitizeReportMetadata(input.metadata || {}),
    created_at: input.created_at || now,
    updated_at: input.updated_at || now,
  };
}

export async function createReportDefinition(input = {}, options = {}) {
  const { reports } = await resolveCollections(options);
  const doc = buildReportDefinitionDoc(input, options);
  await reports.insertOne(doc);
  return doc;
}

export function buildReportRunDoc(reportRun = {}, opts = {}) {
  const now = opts.now || new Date();
  const scope = normalizeScope(reportRun);

  return {
    id: cleanStr(reportRun.id, 200) || (opts.idFactory || crypto.randomUUID)(),
    report_id: cleanStr(reportRun.report_id || reportRun.reportId, 200) || null,
    report_key: normalizeReportKey(reportRun),
    report_type: cleanStr(reportRun.report_type || reportRun.reportType || DEFAULT_REPORT_TYPE, 80) || DEFAULT_REPORT_TYPE,
    report_name: cleanStr(reportRun.report_name || reportRun.reportName || DEFAULT_REPORT_NAME, 160) || DEFAULT_REPORT_NAME,
    status: normalizeRunStatus(reportRun.status),
    requested_formats: normalizeRequestedFormats(reportRun.requested_formats || reportRun.requestedFormats),
    outputs: normalizeOutputs(reportRun.outputs),
    input_snapshot_summary: sanitizeReportMetadata(reportRun.input_snapshot_summary || {}),
    filters: sanitizeReportMetadata(reportRun.filters || {}),
    organization_id: scope.organization_id,
    client_id: scope.client_id,
    location_id: scope.location_id,
    requested_by_user_id: cleanStr(reportRun.requested_by_user_id || reportRun.requestedByUserId, 200) || null,
    created_at: reportRun.created_at || now,
    updated_at: reportRun.updated_at || now,
    started_at: reportRun.started_at || null,
    completed_at: reportRun.completed_at || null,
    error: compactError(reportRun.error),
  };
}

export async function savePendingReportRun(reportRun = {}, options = {}) {
  const { reportRuns } = await resolveCollections(options);
  const doc = buildReportRunDoc({ ...reportRun, status: "pending" }, options);
  await reportRuns.insertOne(doc);
  return doc;
}

export async function markReportRunRunning(runId, options = {}) {
  const id = cleanStr(runId, 200);
  if (!id) throw makeError("missing_report_run_id", "report run id is required");

  const now = options.now || new Date();
  const { reportRuns } = await resolveCollections(options);

  return findOneAndUpdate(reportRuns, { id }, {
    $set: {
      status: "running",
      started_at: options.startedAt || now,
      updated_at: now,
      error: null,
    },
  });
}

export async function markReportRunSucceeded(runId, { outputs = [], completedAt = null, ...options } = {}) {
  const id = cleanStr(runId, 200);
  if (!id) throw makeError("missing_report_run_id", "report run id is required");

  const doneAt = completedAt || options.now || new Date();
  const { reportRuns } = await resolveCollections(options);

  return findOneAndUpdate(reportRuns, { id }, {
    $set: {
      status: "succeeded",
      outputs: normalizeOutputs(outputs),
      completed_at: doneAt,
      updated_at: doneAt,
      error: null,
    },
  });
}

export const REPORT_LIST_DEFAULT_LIMIT = 25;
export const REPORT_LIST_MAX_LIMIT = 100;

const DATE_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseYmdStart(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value;
  }
  const s = cleanStr(value, 40);
  if (!DATE_YMD_RE.test(s)) {
    throw makeError("invalid_date_range", "date must be YYYY-MM-DD");
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw makeError("invalid_date_range", "date must be a valid YYYY-MM-DD");
  }
  return d;
}

function parseYmdEnd(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value;
  }
  const s = cleanStr(value, 40);
  if (!DATE_YMD_RE.test(s)) {
    throw makeError("invalid_date_range", "date must be YYYY-MM-DD");
  }
  const d = new Date(`${s}T23:59:59.999Z`);
  if (Number.isNaN(d.getTime())) {
    throw makeError("invalid_date_range", "date must be a valid YYYY-MM-DD");
  }
  return d;
}

function clampLimit(value) {
  if (value === undefined || value === null || value === "") {
    return REPORT_LIST_DEFAULT_LIMIT;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw makeError("invalid_report_run_limit", "limit must be a positive integer");
  }
  const floored = Math.floor(n);
  return Math.min(REPORT_LIST_MAX_LIMIT, Math.max(1, floored));
}

function sanitizeOutputForList(output = {}) {
  return {
    format: cleanStr(output.format, 20).toLowerCase(),
    status: cleanStr(output.status, 40).toLowerCase(),
    size: Number.isFinite(Number(output.size)) ? Math.floor(Number(output.size)) : null,
    path: cleanStr(output.path, 1000) || null,
    storage_provider: cleanStr(output.storage_provider, 80) || null,
    storage_key: cleanStr(output.storage_key, 1000) || null,
    content_type: cleanStr(output.content_type, 200) || null,
    filename: cleanStr(output.filename, 200) || null,
    checksum: normalizeChecksum(output.checksum),
    generated_at: output.generated_at || null,
    expires_at: output.expires_at || null,
    error: compactError(output.error),
    created_at: output.created_at || null,
    updated_at: output.updated_at || null,
    completed_at: output.completed_at || null,
  };
}

export function sanitizeReportRunRow(doc = {}) {
  const outputs = Array.isArray(doc.outputs) ? doc.outputs.map(sanitizeOutputForList) : [];
  return {
    id: cleanStr(doc.id, 200),
    report_id: cleanStr(doc.report_id, 200) || null,
    report_key: cleanStr(doc.report_key, 160),
    report_type: cleanStr(doc.report_type, 80),
    report_name: cleanStr(doc.report_name, 160),
    status: cleanStr(doc.status, 40).toLowerCase(),
    requested_formats: Array.isArray(doc.requested_formats)
      ? doc.requested_formats
          .filter((format) => REPORT_OUTPUT_FORMATS.includes(cleanStr(format, 20).toLowerCase()))
          .map((format) => cleanStr(format, 20).toLowerCase())
      : [],
    outputs,
    input_snapshot_summary: doc.input_snapshot_summary && typeof doc.input_snapshot_summary === "object"
      ? sanitizeReportMetadata(doc.input_snapshot_summary)
      : {},
    filters: doc.filters && typeof doc.filters === "object"
      ? sanitizeReportMetadata(doc.filters)
      : {},
    organization_id: cleanStr(doc.organization_id, 200),
    client_id: cleanStr(doc.client_id, 200) || null,
    location_id: cleanStr(doc.location_id, 200) || null,
    requested_by_user_id: cleanStr(doc.requested_by_user_id, 200) || null,
    created_at: doc.created_at || null,
    updated_at: doc.updated_at || null,
    started_at: doc.started_at || null,
    completed_at: doc.completed_at || null,
    error: compactError(doc.error),
  };
}

function normalizeListStatus(status) {
  if (!status) return null;
  const value = cleanStr(status, 40).toLowerCase();
  if (!REPORT_STATUSES.includes(value)) {
    throw makeError("invalid_report_run_status", `unsupported report run status: ${status}`);
  }
  return value;
}

function normalizeListFormat(value) {
  if (!value) return null;
  const v = cleanStr(value, 80);
  return v || null;
}

export function buildReportRunListQuery(filter = {}) {
  const organization_id = cleanStr(filter.organization_id || filter.organizationId, 200);
  if (!organization_id) {
    throw makeError("missing_report_scope", "organization_id is required for report run listing");
  }

  const client_id = cleanStr(filter.client_id || filter.clientId, 200) || null;
  const location_id = cleanStr(filter.location_id || filter.locationId, 200) || null;
  const status = normalizeListStatus(filter.status);
  const report_type = normalizeListFormat(filter.report_type || filter.reportType);
  const report_key = cleanStr(filter.report_key || filter.reportKey, 160) || null;

  const date_from = parseYmdStart(filter.date_from || filter.dateFrom);
  const date_to = parseYmdEnd(filter.date_to || filter.dateTo);
  if (date_from && date_to && date_from.getTime() > date_to.getTime()) {
    throw makeError("invalid_date_range", "date_from must be on or before date_to");
  }

  const query = { organization_id };
  if (client_id) query.client_id = client_id;
  if (location_id) query.location_id = location_id;
  if (status) query.status = status;
  if (report_type) query.report_type = report_type;
  if (report_key) query.report_key = report_key;
  if (date_from || date_to) {
    query.created_at = {};
    if (date_from) query.created_at.$gte = date_from;
    if (date_to) query.created_at.$lte = date_to;
  }

  return query;
}

async function fetchReportRunListDocs(reportRuns, query, { limit }) {
  const sort = { created_at: -1, id: -1 };
  const projection = { _id: 0, input_snapshot: 0 };

  if (typeof reportRuns.find === "function") {
    const cursor = reportRuns.find(query, { sort, limit: limit + 1, projection });
    if (cursor && typeof cursor.toArray === "function") {
      return cursor.toArray();
    }
    if (Array.isArray(cursor)) {
      return cursor;
    }
  }

  throw makeError(
    "report_run_list_unsupported_collection",
    "collection does not support listing report runs",
  );
}

export async function listReportRuns(filter = {}, options = {}) {
  const limit = clampLimit(filter.limit);
  const query = buildReportRunListQuery(filter);

  const { reportRuns } = await resolveCollections(options);
  const docs = await fetchReportRunListDocs(reportRuns, query, { limit });

  const has_more = docs.length > limit;
  const trimmed = has_more ? docs.slice(0, limit) : docs;

  return {
    runs: trimmed.map(sanitizeReportRunRow),
    pagination: {
      limit,
      has_more,
      next_cursor: null,
    },
  };
}

export async function getReportRunById(runId, options = {}) {
  const id = cleanStr(runId, 200);
  if (!id) return null;

  const { reportRuns } = await resolveCollections(options);
  if (typeof reportRuns.findOne !== "function") return null;

  const doc = await reportRuns.findOne(
    { id },
    { projection: { _id: 0, input_snapshot: 0 } },
  );
  if (!doc) return null;

  // Defensive: drop _id and input_snapshot in case the underlying collection
  // ignored the projection (e.g., the test in-memory adapter).
  const { _id, input_snapshot, ...rest } = doc;
  return rest;
}

export function findReportRunOutput(run, format) {
  if (!run || !Array.isArray(run.outputs)) return null;
  const fmt = cleanStr(format, 20).toLowerCase();
  if (!fmt) return null;
  return run.outputs.find((output) => cleanStr(output?.format, 20).toLowerCase() === fmt) || null;
}

export async function markReportRunFailed(runId, { error = null, outputs = null, completedAt = null, ...options } = {}) {
  const id = cleanStr(runId, 200);
  if (!id) throw makeError("missing_report_run_id", "report run id is required");

  const doneAt = completedAt || options.now || new Date();
  const { reportRuns } = await resolveCollections(options);
  const set = {
    status: "failed",
    completed_at: doneAt,
    updated_at: doneAt,
    error: compactError(error),
  };

  if (Array.isArray(outputs)) {
    set.outputs = normalizeOutputs(outputs);
  }

  return findOneAndUpdate(reportRuns, { id }, {
    $set: set,
  });
}
