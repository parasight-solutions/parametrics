import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  generationRateLimit,
  reportDownloadRateLimit,
  reportListRateLimit,
} from "../middleware/rateLimit.js";
import { requireOwnedLocation, toApiError } from "../services/ownership.js";
import { auditFailure, auditQueued, auditSuccess } from "../services/auditLog.js";
import { buildDashboardSnapshotReportRun } from "../services/reportService.js";
import { buildPdfOutputResult } from "../services/reportPdf.js";
import { buildXlsxOutputResult } from "../services/reportXlsx.js";
import {
  REPORT_LIST_DEFAULT_LIMIT,
  REPORT_LIST_MAX_LIMIT,
  findReportRunOutput,
  getReportRunById,
  listReportRuns,
  markReportRunFailed,
  markReportRunRunning,
  markReportRunSucceeded,
  savePendingReportRun,
} from "../services/reportStore.js";
import {
  isMembershipAssignedToLocation,
  requireOrganizationLocationAccess,
  requireOrganizationMembership,
  requireOrganizationRole,
} from "../services/organizationAccess.js";
import { getDefaultReportStorage } from "../services/reportStorage.js";
import crypto from "node:crypto";

const router = Router();
const MAX_TOTAL_FILE_BYTES = 5 * 1024 * 1024;
const DASHBOARD_REPORT_GENERATION_ROLES = Object.freeze(["owner", "admin", "manager"]);
const DASHBOARD_REPORT_ORGANIZATION_ROLES = Object.freeze(["owner", "admin"]);
const REPORT_RUN_LIST_ROLES = Object.freeze(["owner", "admin", "manager", "viewer"]);
const REPORT_RUN_LIST_BROAD_ROLES = Object.freeze(["owner", "admin"]);

const FILE_INFO = Object.freeze({
  pdf: { extension: "pdf", content_type: "application/pdf" },
  xlsx: {
    extension: "xlsx",
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
});

function cleanStr(value, max = 500) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function makeError(status, code, message, data = null) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  if (data) err.data = data;
  return err;
}

function mapValidationError(error) {
  if (error?.status) return error;

  const code = cleanStr(error?.code, 120);
  if (
    [
      "invalid_report_formats",
      "invalid_report_format",
      "invalid_date_range",
      "invalid_dashboard_snapshot",
      "missing_report_key",
      "missing_report_scope",
      "invalid_report_run_status",
      "invalid_report_run_limit",
    ].includes(code)
  ) {
    error.status = 400;
  }
  return error;
}

function safeFilenamePart(value) {
  const clean = cleanStr(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || "dashboard-snapshot";
}

function compactReason(error) {
  return {
    code: cleanStr(error?.code || "server_error", 120) || "server_error",
    message: cleanStr(error?.message || "server_error", 300) || "server_error",
  };
}

export function assertDashboardSnapshotLocationScope(body = {}, locationDoc = {}) {
  const locationId = cleanStr(body.location_id || body.locationId, 200);
  const organizationId = cleanStr(body.organization_id || body.organizationId, 200);
  const clientId = cleanStr(body.client_id || body.clientId, 200);
  const locId = cleanStr(locationDoc.id, 200);
  const locOrgId = cleanStr(locationDoc.organization_id, 200);
  const locClientId = cleanStr(locationDoc.client_id, 200);

  if (!locationId) return null;

  if (!clientId) {
    throw makeError(400, "bad_request", "client_id is required when location_id is provided");
  }

  if (locationId !== locId || organizationId !== locOrgId || clientId !== locClientId) {
    throw makeError(409, "scope_mismatch", "request scope does not match location scope", {
      expected: {
        organization_id: locOrgId || null,
        client_id: locClientId || null,
        location_id: locId || null,
      },
      received: {
        organization_id: organizationId || null,
        client_id: clientId || null,
        location_id: locationId || null,
      },
    });
  }

  return locationDoc;
}

function buildReportInput({ body, user, locationDoc = null }) {
  const organizationId = cleanStr(body.organization_id || body.organizationId, 200);
  if (!organizationId) {
    throw makeError(400, "bad_request", "organization_id is required");
  }

  const locationId = cleanStr(body.location_id || body.locationId, 200);
  if (locationId && locationDoc) {
    assertDashboardSnapshotLocationScope(body, locationDoc);
  }

  return {
    ...body,
    report_type: "dashboard_snapshot",
    organization_id: organizationId,
    client_id: cleanStr(body.client_id || body.clientId, 200) || null,
    location_id: locationId || null,
    requested_by_user_id: cleanStr(user?.user_id || user?.id, 200) || null,
  };
}

function buildFileResult(reportRun, format, buffer) {
  const info = FILE_INFO[format];
  const base = safeFilenamePart(reportRun.report_key || reportRun.report_name || reportRun.id);
  return {
    format,
    filename: `${base}-${reportRun.id}.${info.extension}`,
    content_type: info.content_type,
    base64: buffer.toString("base64"),
    size: buffer.length,
  };
}

function outputBuilderForFormat(format, deps) {
  if (format === "pdf") return deps.buildPdfOutputResult || buildPdfOutputResult;
  if (format === "xlsx") return deps.buildXlsxOutputResult || buildXlsxOutputResult;
  return null;
}

async function generateOutputs(reportRun, deps = {}, options = {}) {
  const outputs = [];
  const files = [];
  const buffers = [];
  let totalBytes = 0;

  for (const format of reportRun.requested_formats) {
    const builder = outputBuilderForFormat(format, deps);
    if (!builder) {
      throw makeError(400, "bad_request", `unsupported report format: ${format}`);
    }

    const result = builder(reportRun, { now: options.now || new Date() });
    outputs.push(result.output);

    if (result.output?.status !== "succeeded" || !Buffer.isBuffer(result.buffer)) {
      buffers.push(null);
      continue;
    }

    totalBytes += result.buffer.length;
    if (totalBytes > (options.maxTotalFileBytes || MAX_TOTAL_FILE_BYTES)) {
      throw makeError(400, "report_response_too_large", "generated report response exceeds size cap", {
        max_total_file_bytes: options.maxTotalFileBytes || MAX_TOTAL_FILE_BYTES,
      });
    }

    files.push(buildFileResult(reportRun, format, result.buffer));
    buffers.push(result.buffer);
  }

  return { outputs, files, buffers };
}

function hasFailedOutput(outputs) {
  return outputs.some((output) => output?.status !== "succeeded");
}

function resolveStorageAdapter(deps = {}) {
  if (deps.reportStorage === null) return null;
  if (deps.reportStorage) return deps.reportStorage;
  return getDefaultReportStorage();
}

function fileForFormat(files, format) {
  return files.find((file) => file?.format === format) || null;
}

function applyStorageMetadata(output, meta) {
  return {
    ...output,
    storage_provider: meta.storage_provider,
    storage_key: meta.storage_key,
    content_type: meta.content_type,
    filename: meta.filename,
    size: meta.size,
    checksum: meta.checksum,
    generated_at: meta.generated_at,
    expires_at: meta.expires_at,
  };
}

function markOutputStorageFailed(output, error, completedAt) {
  const code = cleanStr(error?.code || "report_storage_failed", 120) || "report_storage_failed";
  const message = cleanStr(error?.message || "report storage failed", 500) || "report storage failed";
  return {
    ...output,
    status: "failed",
    error: { code, message },
    updated_at: completedAt,
    completed_at: completedAt,
  };
}

export async function persistOutputsToStorage(reportRun, generated, storage, options = {}) {
  if (!storage) return generated.outputs.slice();

  const completedAt = options.now || new Date();
  const next = generated.outputs.slice();

  for (let i = 0; i < generated.outputs.length; i += 1) {
    const output = generated.outputs[i];
    const buffer = generated.buffers[i];
    if (!output || output.status !== "succeeded" || !Buffer.isBuffer(buffer)) continue;

    const file = fileForFormat(generated.files, output.format);
    if (!file) continue;

    try {
      const meta = await storage.writeOutput({
        organization_id: reportRun.organization_id,
        run_id: reportRun.id,
        format: output.format,
        content_type: file.content_type,
        filename: file.filename,
        buffer,
        now: completedAt,
      });
      next[i] = applyStorageMetadata(output, meta);
    } catch (error) {
      next[i] = markOutputStorageFailed(output, error, completedAt);
    }
  }

  return next;
}

export async function generateDashboardSnapshotReport({
  body = {},
  user = {},
  storeOptions = {},
  buildRunOptions = {},
  onPendingRun = null,
  onMembership = null,
  deps = {},
  now = new Date(),
  maxTotalFileBytes = MAX_TOTAL_FILE_BYTES,
} = {}) {
  const userId = cleanStr(user.user_id || user.id, 200);
  if (!userId) {
    throw makeError(401, "unauthorized", "Unauthorized");
  }

  const organizationId = cleanStr(body.organization_id || body.organizationId, 200);
  if (!organizationId) {
    throw makeError(400, "bad_request", "organization_id is required");
  }

  const locationId = cleanStr(body.location_id || body.locationId, 200);
  const clientId = cleanStr(body.client_id || body.clientId, 200);
  if (locationId && !clientId) {
    throw makeError(400, "bad_request", "client_id is required when location_id is provided");
  }

  let locationDoc = null;
  let membership = null;

  if (locationId) {
    const ownedLocation = deps.requireOwnedLocation || requireOwnedLocation;
    locationDoc = await ownedLocation(userId, locationId, { provider: "google" });
    const requireLocationAccess = deps.requireOrganizationLocationAccess || requireOrganizationLocationAccess;
    membership = await requireLocationAccess({
      organizationId: locationDoc.organization_id,
      clientId: locationDoc.client_id,
      locationId: locationDoc.id,
      userId,
      allowedRoles: DASHBOARD_REPORT_GENERATION_ROLES,
    }, deps.organizationAccessOptions || {});
  } else {
    const requireReportRole = deps.requireOrganizationRole || requireOrganizationRole;
    membership = await requireReportRole({
      organizationId,
      userId,
      allowedRoles: DASHBOARD_REPORT_ORGANIZATION_ROLES,
    }, deps.organizationAccessOptions || {});
  }

  if (onMembership) await onMembership(membership);

  const reportInput = buildReportInput({ body, user, locationDoc });
  let run = null;
  let outputs = [];

  try {
    const reportRun = buildDashboardSnapshotReportRun(reportInput, {
      now,
      ...buildRunOptions,
    });

    run = await (deps.savePendingReportRun || savePendingReportRun)(reportRun, storeOptions);
    if (onPendingRun) await onPendingRun(run);

    await (deps.markReportRunRunning || markReportRunRunning)(run.id, {
      ...storeOptions,
      now,
    });

    const generated = await generateOutputs(reportRun, deps, { now, maxTotalFileBytes });
    const storage = resolveStorageAdapter(deps);
    outputs = await persistOutputsToStorage(reportRun, generated, storage, { now });

    if (hasFailedOutput(outputs)) {
      throw makeError(500, "report_generation_failed", "one or more report outputs failed");
    }

    const persistedRun = await (deps.markReportRunSucceeded || markReportRunSucceeded)(run.id, {
      ...storeOptions,
      outputs,
      completedAt: now,
    });

    return {
      report_run: persistedRun,
      outputs,
      files: generated.files,
    };
  } catch (error) {
    const mapped = mapValidationError(error);
    if (run?.id) {
      mapped.reportRun = await (deps.markReportRunFailed || markReportRunFailed)(run.id, {
        ...storeOptions,
        outputs,
        error: mapped,
        completedAt: now,
      });
    }
    throw mapped;
  }
}

function auditDetailsFromRun(run, extra = {}) {
  return {
    target_type: "report_run",
    target_id: run?.id || null,
    organization_id: run?.organization_id || null,
    client_id: run?.client_id || null,
    location_id: run?.location_id || null,
    metadata: {
      report_key: run?.report_key || null,
      requested_formats: run?.requested_formats || [],
      ...extra,
    },
  };
}

function parseListLimit(value) {
  if (value === undefined || value === null || value === "") {
    return REPORT_LIST_DEFAULT_LIMIT;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw makeError(400, "bad_request", "limit must be a positive integer");
  }
  return Math.min(REPORT_LIST_MAX_LIMIT, Math.max(1, Math.floor(n)));
}

function listFilterFromQuery(query = {}) {
  return {
    organization_id: cleanStr(query.organization_id || query.organizationId, 200),
    client_id: cleanStr(query.client_id || query.clientId, 200) || null,
    location_id: cleanStr(query.location_id || query.locationId, 200) || null,
    status: cleanStr(query.status, 40) || null,
    report_type: cleanStr(query.report_type || query.reportType, 80) || null,
    report_key: cleanStr(query.report_key || query.reportKey, 160) || null,
    date_from: cleanStr(query.date_from || query.dateFrom, 40) || null,
    date_to: cleanStr(query.date_to || query.dateTo, 40) || null,
    limit: parseListLimit(query.limit),
  };
}

function assertManagerOrViewerListScope(filter, membership) {
  const role = String(membership?.role || "").toLowerCase();
  if (REPORT_RUN_LIST_BROAD_ROLES.includes(role)) return;

  const hasScope = Boolean(filter.client_id || filter.location_id);
  if (!hasScope) {
    throw makeError(
      403,
      "organization_scope_required",
      "client_id or location_id is required for the requested role",
    );
  }

  if (!isMembershipAssignedToLocation(membership, {
    clientId: filter.client_id || "",
    locationId: filter.location_id || "",
  })) {
    throw makeError(
      403,
      "organization_scope_required",
      "required organization assignment is missing",
    );
  }
}

export async function listReportRunsForUser({
  body = null,
  query = {},
  user = {},
  storeOptions = {},
  deps = {},
} = {}) {
  const userId = cleanStr(user.user_id || user.id, 200);
  if (!userId) {
    throw makeError(401, "unauthorized", "Unauthorized");
  }

  let filter;
  try {
    filter = listFilterFromQuery(body || query || {});
  } catch (error) {
    throw mapValidationError(error);
  }

  if (!filter.organization_id) {
    throw makeError(400, "bad_request", "organization_id is required");
  }

  const requireMembership = deps.requireOrganizationMembership || requireOrganizationMembership;
  const membership = await requireMembership({
    organizationId: filter.organization_id,
    userId,
  }, deps.organizationAccessOptions || {});

  const role = String(membership?.role || "").toLowerCase();
  if (!REPORT_RUN_LIST_ROLES.includes(role)) {
    throw makeError(403, "organization_role_required", "required organization role is missing");
  }

  assertManagerOrViewerListScope(filter, membership);

  try {
    const result = await (deps.listReportRuns || listReportRuns)(filter, storeOptions);
    return {
      report_runs: result.runs,
      pagination: result.pagination,
      membership_role: role,
    };
  } catch (error) {
    throw mapValidationError(error);
  }
}

export function compactListAuditFilters(query = {}) {
  const reportType = cleanStr(query.report_type || query.reportType, 80) || null;
  const reportKey = cleanStr(query.report_key || query.reportKey, 160) || null;
  const status = cleanStr(query.status, 40) || null;
  const dateFrom = cleanStr(query.date_from || query.dateFrom, 40) || null;
  const dateTo = cleanStr(query.date_to || query.dateTo, 40) || null;
  const out = {};
  if (reportType) out.report_type = reportType;
  if (reportKey) out.report_key = reportKey;
  if (status) out.status = status;
  if (dateFrom) out.date_from = dateFrom;
  if (dateTo) out.date_to = dateTo;
  return out;
}

function parseListLimitForAudit(value) {
  try {
    return parseListLimit(value);
  } catch {
    return null;
  }
}

export function buildListAuditDetails(query = {}, result = {}) {
  return {
    target_type: "report_run",
    organization_id: cleanStr(query.organization_id || query.organizationId, 200) || null,
    client_id: cleanStr(query.client_id || query.clientId, 200) || null,
    location_id: cleanStr(query.location_id || query.locationId, 200) || null,
    metadata: {
      ...compactListAuditFilters(query),
      limit: result?.pagination?.limit ?? parseListLimitForAudit(query.limit),
      result_count: Array.isArray(result.report_runs) ? result.report_runs.length : 0,
      has_more: Boolean(result?.pagination?.has_more),
      membership_role: cleanStr(result.membership_role, 80) || null,
    },
  };
}

export function buildListFailureAuditDetails(query = {}, error = null) {
  return {
    target_type: "report_run",
    organization_id: cleanStr(query.organization_id || query.organizationId, 200) || null,
    client_id: cleanStr(query.client_id || query.clientId, 200) || null,
    location_id: cleanStr(query.location_id || query.locationId, 200) || null,
    metadata: {
      ...compactListAuditFilters(query),
      limit: parseListLimitForAudit(query.limit),
      reason: compactReason(error || {}),
      status: Number.isFinite(error?.status) ? error.status : null,
    },
  };
}

router.get("/runs", authenticate, reportListRateLimit, async (req, res) => {
  const query = req.query || {};

  try {
    const result = await listReportRunsForUser({
      query,
      user: req.user || {},
    });

    await auditSuccess(req, "report.run.list", buildListAuditDetails(query, result));

    return res.json({
      report_runs: result.report_runs,
      pagination: result.pagination,
    });
  } catch (error) {
    const mapped = mapValidationError(error);
    await auditFailure(req, "report.run.list_failed", buildListFailureAuditDetails(query, mapped));
    return toApiError(res, mapped);
  }
});

router.post("/dashboard-snapshot", authenticate, generationRateLimit, async (req, res) => {
  let membershipRole = null;

  try {
    const result = await generateDashboardSnapshotReport({
      body: req.body || {},
      user: req.user || {},
      onMembership: async (membership) => {
        membershipRole = membership?.role || null;
      },
      onPendingRun: async (run) => {
        await auditQueued(req, "report.dashboard_snapshot.generate", auditDetailsFromRun(run, {
          membership_role: membershipRole,
        }));
      },
    });

    await auditSuccess(req, "report.dashboard_snapshot.generate", auditDetailsFromRun(result.report_run, {
      output_count: result.outputs.length,
      file_count: result.files.length,
      membership_role: membershipRole,
    }));

    return res.json(result);
  } catch (error) {
    await auditFailure(req, "report.dashboard_snapshot.generate", {
      ...auditDetailsFromRun(error.reportRun || req.body, {
        reason: compactReason(error),
        membership_role: membershipRole,
      }),
    });

    return toApiError(res, mapValidationError(error));
  }
});

const REPORT_DOWNLOAD_BROAD_ROLES = Object.freeze(["owner", "admin"]);
const REPORT_DOWNLOAD_SCOPED_ROLES = Object.freeze(["manager", "viewer"]);
const REPORT_DOWNLOAD_FORMATS = Object.freeze(["pdf", "xlsx"]);
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function sha256HexBuffer(buffer) {
  const hash = crypto.createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

function downloadFilenameFor(run, output, format) {
  const persisted = cleanStr(output?.filename, 200);
  if (persisted && SAFE_FILENAME_PATTERN.test(persisted)) return persisted;
  const base = safeFilenamePart(run?.report_key || run?.report_name || run?.id);
  return `${base}-${cleanStr(run?.id, 200) || "run"}.${format}`;
}

function contentTypeFor(output, format) {
  const persisted = cleanStr(output?.content_type, 200);
  if (persisted) return persisted;
  return FILE_INFO[format].content_type;
}

function assertManagerOrViewerDownloadScope(run, membership) {
  const role = String(membership?.role || "").toLowerCase();
  if (REPORT_DOWNLOAD_BROAD_ROLES.includes(role)) return;
  if (!REPORT_DOWNLOAD_SCOPED_ROLES.includes(role)) {
    throw makeError(403, "organization_role_required", "required organization role is missing");
  }

  const clientId = cleanStr(run?.client_id, 200);
  const locationId = cleanStr(run?.location_id, 200);
  if (!clientId && !locationId) {
    throw makeError(
      403,
      "organization_scope_required",
      "organization-level reports are not available for the requested role",
    );
  }

  if (!isMembershipAssignedToLocation(membership, {
    clientId: clientId || "",
    locationId: locationId || "",
  })) {
    throw makeError(
      403,
      "organization_scope_required",
      "required organization assignment is missing",
    );
  }
}

export async function downloadReportOutputForUser({
  runId,
  format,
  user = {},
  storeOptions = {},
  deps = {},
} = {}) {
  const userId = cleanStr(user.user_id || user.id, 200);
  if (!userId) {
    throw makeError(401, "unauthorized", "Unauthorized");
  }

  const cleanRunId = cleanStr(runId, 200);
  if (!cleanRunId) {
    throw makeError(400, "bad_request", "runId is required");
  }

  const cleanFormat = cleanStr(format, 20).toLowerCase();
  if (!REPORT_DOWNLOAD_FORMATS.includes(cleanFormat)) {
    throw makeError(400, "bad_request", "format must be pdf or xlsx");
  }

  const loadRun = deps.getReportRunById || getReportRunById;
  const run = await loadRun(cleanRunId, storeOptions);
  if (!run) {
    throw makeError(404, "report_run_not_found", "report run not found");
  }

  const organizationId = cleanStr(run.organization_id, 200);
  if (!organizationId) {
    throw makeError(404, "report_run_not_found", "report run not found");
  }

  const requireMembership = deps.requireOrganizationMembership || requireOrganizationMembership;
  const membership = await requireMembership({
    organizationId,
    userId,
  }, deps.organizationAccessOptions || {});

  const role = String(membership?.role || "").toLowerCase();
  if (
    !REPORT_DOWNLOAD_BROAD_ROLES.includes(role)
    && !REPORT_DOWNLOAD_SCOPED_ROLES.includes(role)
  ) {
    throw makeError(403, "organization_role_required", "required organization role is missing");
  }

  assertManagerOrViewerDownloadScope(run, membership);

  const findOutput = deps.findReportRunOutput || findReportRunOutput;
  const output = findOutput(run, cleanFormat);
  if (!output) {
    throw makeError(404, "report_output_not_found", "report output not found for format");
  }

  if (cleanStr(output.status, 40).toLowerCase() !== "succeeded") {
    throw makeError(409, "report_output_not_ready", "report output is not ready for download");
  }

  const storageProvider = cleanStr(output.storage_provider, 80);
  const storageKey = cleanStr(output.storage_key, 1000);
  if (!storageProvider || !storageKey) {
    throw makeError(409, "report_output_not_ready", "report output storage metadata is missing");
  }

  const storage = resolveStorageAdapter(deps);
  if (!storage || typeof storage.readOutput !== "function") {
    throw makeError(500, "report_output_read_failed", "report storage adapter is unavailable");
  }

  let buffer;
  try {
    buffer = await storage.readOutput({
      storage_provider: storageProvider,
      storage_key: storageKey,
    });
  } catch (error) {
    throw makeError(500, "report_output_read_failed", compactReason(error).message);
  }

  if (!Buffer.isBuffer(buffer)) {
    throw makeError(500, "report_output_read_failed", "report storage returned no bytes");
  }

  if (Number.isFinite(Number(output.size)) && Number(output.size) >= 0
    && buffer.length !== Number(output.size)) {
    throw makeError(
      500,
      "report_output_integrity_failed",
      "report output size does not match persisted metadata",
    );
  }

  const expectedAlgo = cleanStr(output.checksum?.algorithm, 40).toLowerCase();
  const expectedValue = cleanStr(output.checksum?.value, 256);
  if (expectedAlgo === "sha256" && expectedValue) {
    const actual = sha256HexBuffer(buffer);
    if (actual !== expectedValue) {
      throw makeError(
        500,
        "report_output_integrity_failed",
        "report output checksum does not match persisted metadata",
      );
    }
  }

  return {
    buffer,
    content_type: contentTypeFor(output, cleanFormat),
    filename: downloadFilenameFor(run, output, cleanFormat),
    size: buffer.length,
    membership_role: role,
    organization_id: organizationId,
    storage_provider: storageProvider,
    checksum_algorithm: expectedAlgo || null,
  };
}

function normalizeDownloadAuditFormat(format) {
  const cleaned = cleanStr(format, 20).toLowerCase();
  return REPORT_DOWNLOAD_FORMATS.includes(cleaned) ? cleaned : null;
}

export function buildDownloadAuditDetails({ runId, format, result } = {}) {
  const safeRunId = cleanStr(runId, 200) || null;
  return {
    target_type: "report_run_output",
    target_id: safeRunId,
    organization_id: cleanStr(result?.organization_id, 200) || null,
    metadata: {
      report_run_id: safeRunId,
      format: normalizeDownloadAuditFormat(format),
      size: Number.isFinite(result?.size) ? result.size : null,
      content_type: cleanStr(result?.content_type, 200) || null,
      storage_provider: cleanStr(result?.storage_provider, 80) || null,
      checksum_algorithm: cleanStr(result?.checksum_algorithm, 40) || null,
      membership_role: cleanStr(result?.membership_role, 80) || null,
    },
  };
}

export function buildDownloadFailureAuditDetails({ runId, format, error } = {}) {
  const safeRunId = cleanStr(runId, 200) || null;
  return {
    target_type: "report_run_output",
    target_id: safeRunId,
    metadata: {
      report_run_id: safeRunId,
      format: normalizeDownloadAuditFormat(format),
      reason: compactReason(error || {}),
      status: Number.isFinite(error?.status) ? error.status : null,
    },
  };
}

router.get(
  "/runs/:runId/outputs/:format",
  authenticate,
  reportDownloadRateLimit,
  async (req, res) => {
    const runId = req.params?.runId;
    const format = req.params?.format;

    try {
      const result = await downloadReportOutputForUser({
        runId,
        format,
        user: req.user || {},
      });

      res.setHeader("Content-Type", result.content_type);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`,
      );
      res.setHeader("Content-Length", String(result.size));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");

      await auditSuccess(req, "report.output.download", buildDownloadAuditDetails({
        runId,
        format,
        result,
      }));

      return res.status(200).end(result.buffer);
    } catch (error) {
      const mapped = mapValidationError(error);
      await auditFailure(req, "report.output.download_failed", buildDownloadFailureAuditDetails({
        runId,
        format,
        error: mapped,
      }));
      return toApiError(res, mapped);
    }
  },
);

export default router;
