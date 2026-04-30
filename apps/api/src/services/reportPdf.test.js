import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboardSnapshotReportRun } from "./reportService.js";
import {
  buildDashboardSnapshotPdfLines,
  buildPdfOutputResult,
  renderDashboardSnapshotPdf,
} from "./reportPdf.js";

const fixedNow = new Date("2026-05-01T12:00:00.000Z");

function sampleRun(overrides = {}) {
  return buildDashboardSnapshotReportRun(
    {
      report_name: "April GBP Dashboard",
      report_key: "gbp_dashboard_april",
      report_type: "dashboard_snapshot",
      organization_id: "org_1",
      client_id: "client_1",
      location_id: "loc_1",
      requested_by_user_id: "user_1",
      requested_formats: ["pdf"],
      date_range: { start: "2026-04-01", end: "2026-04-30" },
      dashboard_snapshot: {
        title: "April dashboard",
        provider: "google",
        cards: [
          { title: "Website Clicks", value: 42 },
          { title: "Call Clicks", value: 7, access_token: "must redact" },
        ],
        metrics: [{ metric: "BUSINESS_IMPRESSIONS_SEARCH", total: 1234 }],
        tables: [
          {
            title: "Raw totals",
            rows: [
              { metric: "WEBSITE_CLICKS", total: 42 },
              { metric: "CALL_CLICKS", total: 7, refresh_token: "must redact" },
            ],
          },
        ],
        charts: [{ title: "Trend", points: [{ date: "2026-04-01", value: 3 }] }],
      },
      ...overrides,
    },
    { now: fixedNow, idFactory: () => "run_pdf_1" }
  );
}

test("renderDashboardSnapshotPdf creates a valid text PDF buffer", () => {
  const buffer = renderDashboardSnapshotPdf(sampleRun(), { now: fixedNow });
  const text = buffer.toString("binary");

  assert.equal(Buffer.isBuffer(buffer), true);
  assert.equal(text.startsWith("%PDF-1.4"), true);
  assert.equal(text.includes("%%EOF"), true);
  assert.equal(text.includes("April GBP Dashboard"), true);
  assert.equal(text.includes("gbp_dashboard_april"), true);
  assert.equal(text.includes("2026-04-01 to 2026-04-30"), true);
  assert.equal(text.includes("Organization: org_1"), true);
  assert.equal(text.includes("Website Clicks: 42"), true);
  assert.equal(text.includes("BUSINESS_IMPRESSIONS_SEARCH: 1234"), true);
  assert.equal(buffer.length > 1000, true);
});

test("buildPdfOutputResult returns succeeded output metadata with size", () => {
  const result = buildPdfOutputResult(sampleRun(), {
    now: fixedNow,
    path: "reports/run_pdf_1.pdf",
  });

  assert.equal(Buffer.isBuffer(result.buffer), true);
  assert.equal(result.output.format, "pdf");
  assert.equal(result.output.status, "succeeded");
  assert.equal(result.output.path, "reports/run_pdf_1.pdf");
  assert.equal(result.output.size, result.buffer.length);
  assert.equal(result.output.error, null);
  assert.equal(result.output.completed_at, fixedNow);
});

test("buildPdfOutputResult fails compactly when pdf was not requested", () => {
  const result = buildPdfOutputResult(sampleRun({ requested_formats: ["xlsx"] }), {
    now: fixedNow,
  });

  assert.equal(result.buffer, null);
  assert.equal(result.output.format, "pdf");
  assert.equal(result.output.status, "failed");
  assert.deepEqual(result.output.error, {
    code: "pdf_not_requested",
    message: "report run did not request pdf output",
  });
});

test("PDF lines use sanitized snapshot content and avoid secret values", () => {
  const lines = buildDashboardSnapshotPdfLines(sampleRun(), { now: fixedNow });
  const joined = lines.join("\n");

  assert.equal(joined.includes("must redact"), false);
  assert.equal(joined.includes("[redacted]"), false);
  assert.equal(joined.includes("Call Clicks: 7"), true);
});
