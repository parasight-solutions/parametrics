import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboardSnapshotReportRun } from "./reportService.js";
import {
  buildDashboardSnapshotXlsxSheets,
  buildXlsxOutputResult,
  renderDashboardSnapshotXlsx,
} from "./reportXlsx.js";

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
      requested_formats: ["xlsx"],
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
    { now: fixedNow, idFactory: () => "run_xlsx_1" }
  );
}

test("renderDashboardSnapshotXlsx creates a valid minimal workbook buffer", () => {
  const buffer = renderDashboardSnapshotXlsx(sampleRun(), { now: fixedNow });
  const text = buffer.toString("utf8");

  assert.equal(Buffer.isBuffer(buffer), true);
  assert.equal(buffer.subarray(0, 2).toString("utf8"), "PK");
  assert.equal(text.includes("[Content_Types].xml"), true);
  assert.equal(text.includes("xl/workbook.xml"), true);
  assert.equal(text.includes("xl/worksheets/sheet1.xml"), true);
  assert.equal(text.includes('sheet name="Summary"'), true);
  assert.equal(text.includes('sheet name="Cards"'), true);
  assert.equal(text.includes('sheet name="Metrics"'), true);
  assert.equal(text.includes('sheet name="Tables"'), true);
  assert.equal(text.includes('sheet name="Charts"'), true);
  assert.equal(text.includes("April GBP Dashboard"), true);
  assert.equal(text.includes("gbp_dashboard_april"), true);
  assert.equal(text.includes("2026-04-01"), true);
  assert.equal(text.includes("Website Clicks"), true);
  assert.equal(text.includes("BUSINESS_IMPRESSIONS_SEARCH"), true);
  assert.equal(text.includes("Raw totals"), true);
  assert.equal(text.includes("Trend"), true);
  assert.equal(buffer.length > 2000, true);
});

test("buildXlsxOutputResult returns succeeded output metadata with size", () => {
  const result = buildXlsxOutputResult(sampleRun(), {
    now: fixedNow,
    path: "reports/run_xlsx_1.xlsx",
  });

  assert.equal(Buffer.isBuffer(result.buffer), true);
  assert.equal(result.output.format, "xlsx");
  assert.equal(result.output.status, "succeeded");
  assert.equal(result.output.path, "reports/run_xlsx_1.xlsx");
  assert.equal(result.output.size, result.buffer.length);
  assert.equal(result.output.error, null);
  assert.equal(result.output.completed_at, fixedNow);
});

test("buildXlsxOutputResult fails compactly when xlsx was not requested", () => {
  const result = buildXlsxOutputResult(sampleRun({ requested_formats: ["pdf"] }), {
    now: fixedNow,
  });

  assert.equal(result.buffer, null);
  assert.equal(result.output.format, "xlsx");
  assert.equal(result.output.status, "failed");
  assert.deepEqual(result.output.error, {
    code: "xlsx_not_requested",
    message: "report run did not request xlsx output",
  });
});

test("XLSX sheets use sanitized snapshot content and avoid secret values", () => {
  const sheets = buildDashboardSnapshotXlsxSheets(sampleRun(), { now: fixedNow });
  const joined = sheets.flatMap((sheet) => sheet.rows).flat().join("\n");

  assert.equal(joined.includes("must redact"), false);
  assert.equal(joined.includes("[redacted]"), false);
  assert.equal(joined.includes("Call Clicks"), true);
  assert.equal(joined.includes("CALL_CLICKS"), true);
});
