import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboardSnapshotReportRun,
  createPendingOutput,
  markOutputFailed,
  markOutputSucceeded,
  normalizeDateRange,
  normalizeRequestedFormats,
  sanitizeReportMetadata,
} from "./reportService.js";

const fixedNow = new Date("2026-05-01T00:00:00.000Z");

test("buildDashboardSnapshotReportRun creates pending metadata for dashboard snapshots", () => {
  const run = buildDashboardSnapshotReportRun(
    {
      reportName: "Monthly GBP dashboard",
      reportKey: "gbp_dashboard_monthly",
      organization_id: "org_1",
      client_id: "client_1",
      location_id: "loc_1",
      requested_formats: ["PDF", "xlsx", "pdf"],
      date_range: { start: "2026-04-01", end: "2026-04-30" },
      actor: { user_id: "user_1" },
      dashboard_snapshot: {
        title: "April dashboard",
        provider: "google",
        cards: [{ title: "Website Clicks", value: 42 }],
        tables: [{ title: "Raw totals", rows: [{ metric: "WEBSITE_CLICKS", total: 42 }] }],
        charts: [{ title: "Trend", points: [{ date: "2026-04-01", value: 1 }] }],
      },
    },
    { now: fixedNow, idFactory: () => "run_1" }
  );

  assert.equal(run.id, "run_1");
  assert.equal(run.report_key, "gbp_dashboard_monthly");
  assert.equal(run.report_name, "Monthly GBP dashboard");
  assert.equal(run.status, "pending");
  assert.deepEqual(run.requested_formats, ["pdf", "xlsx"]);
  assert.equal(run.outputs.length, 2);
  assert.equal(run.outputs[0].status, "pending");
  assert.equal(run.input_snapshot_summary.card_count, 1);
  assert.equal(run.input_snapshot_summary.table_count, 1);
  assert.equal(run.input_snapshot_summary.chart_count, 1);
  assert.deepEqual(run.filters.date_range, { start: "2026-04-01", end: "2026-04-30", days: 30 });
  assert.equal(run.organization_id, "org_1");
  assert.equal(run.client_id, "client_1");
  assert.equal(run.location_id, "loc_1");
  assert.equal(run.requested_by_user_id, "user_1");
  assert.equal(run.started_at, null);
  assert.equal(run.completed_at, null);
});

test("normalizeDateRange validates shape, ordering, and maximum range", () => {
  assert.deepEqual(
    normalizeDateRange({ start: "2026-05-01", end: "2026-05-01" }),
    { start: "2026-05-01", end: "2026-05-01", days: 1 }
  );

  assert.throws(
    () => normalizeDateRange({ start: "2026-05-02", end: "2026-05-01" }),
    /date range end must be on or after start/
  );

  assert.throws(
    () => normalizeDateRange({ start: "2025-01-01", end: "2026-12-31" }),
    /date range may not exceed 366 days/
  );
});

test("normalizeRequestedFormats defaults to pdf and rejects unsupported formats", () => {
  assert.deepEqual(normalizeRequestedFormats(), ["pdf"]);
  assert.deepEqual(normalizeRequestedFormats(["PDF", "xlsx", "pdf"]), ["pdf", "xlsx"]);

  assert.throws(
    () => normalizeRequestedFormats(["csv"]),
    /unsupported report format/
  );
});

test("output helpers transition future output metadata", () => {
  const pending = createPendingOutput("pdf", fixedNow);
  assert.equal(pending.status, "pending");
  assert.equal(pending.path, null);

  const doneAt = new Date("2026-05-01T01:00:00.000Z");
  const succeeded = markOutputSucceeded(pending, {
    path: "reports/run_1.pdf",
    size: 1234.8,
    completedAt: doneAt,
  });

  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.path, "reports/run_1.pdf");
  assert.equal(succeeded.size, 1234);
  assert.equal(succeeded.completed_at, doneAt);

  const failed = markOutputFailed(pending, {
    error: { code: "pdf_failed", message: "PDF renderer unavailable" },
    completedAt: doneAt,
  });

  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.error, {
    code: "pdf_failed",
    message: "PDF renderer unavailable",
  });
});

test("sanitizeReportMetadata redacts secrets and caps large snapshots", () => {
  const sanitized = sanitizeReportMetadata({
    title: "Safe",
    access_token: "secret",
    nested: {
      refreshToken: "secret",
      kept: "yes",
    },
  });

  assert.equal(sanitized.access_token, "[redacted]");
  assert.equal(sanitized.nested.refreshToken, "[redacted]");
  assert.equal(sanitized.nested.kept, "yes");

  const huge = sanitizeReportMetadata(
    Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `series_${i}`,
        Array.from({ length: 50 }, () => "x".repeat(2000)),
      ])
    )
  );

  assert.equal(huge.truncated, true);
  assert.equal(huge.message, "report metadata exceeded size cap");
});
