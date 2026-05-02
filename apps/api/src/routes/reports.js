import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { generationRateLimit } from "../middleware/rateLimit.js";
import { requireOwnedLocation, toApiError } from "../services/ownership.js";
import { auditFailure, auditQueued, auditSuccess } from "../services/auditLog.js";
import { buildDashboardSnapshotReportRun } from "../services/reportService.js";
import { buildPdfOutputResult } from "../services/reportPdf.js";
import { buildXlsxOutputResult } from "../services/reportXlsx.js";
import {
  markReportRunFailed,
  markReportRunRunning,
  markReportRunSucceeded,
  savePendingReportRun,
} from "../services/reportStore.js";
import {
  requireOrganizationLocationAccess,
  requireOrganizationRole,
} from "../services/organizationAccess.js";

const router = Router();
const MAX_TOTAL_FILE_BYTES = 5 * 1024 * 1024;
const DASHBOARD_REPORT_GENERATION_ROLES = Object.freeze(["owner", "admin", "manager"]);
const DASHBOARD_REPORT_ORGANIZATION_ROLES = Object.freeze(["owner", "admin"]);

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
  let totalBytes = 0;

  for (const format of reportRun.requested_formats) {
    const builder = outputBuilderForFormat(format, deps);
    if (!builder) {
      throw makeError(400, "bad_request", `unsupported report format: ${format}`);
    }

    const result = builder(reportRun, { now: options.now || new Date() });
    outputs.push(result.output);

    if (result.output?.status !== "succeeded" || !Buffer.isBuffer(result.buffer)) {
      continue;
    }

    totalBytes += result.buffer.length;
    if (totalBytes > (options.maxTotalFileBytes || MAX_TOTAL_FILE_BYTES)) {
      throw makeError(400, "report_response_too_large", "generated report response exceeds size cap", {
        max_total_file_bytes: options.maxTotalFileBytes || MAX_TOTAL_FILE_BYTES,
      });
    }

    files.push(buildFileResult(reportRun, format, result.buffer));
  }

  return { outputs, files };
}

function hasFailedOutput(outputs) {
  return outputs.some((output) => output?.status !== "succeeded");
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
    outputs = generated.outputs;

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

export default router;
