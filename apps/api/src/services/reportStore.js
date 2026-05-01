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
