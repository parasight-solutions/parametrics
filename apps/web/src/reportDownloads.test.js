import { describe, expect, it } from "vitest";
import {
  buildDashboardReportPayload,
  getReportDownload,
} from "./reportDownloads";

describe("report download helpers", () => {
  it("builds a compact dashboard report payload with canonical location scope", () => {
    const payload = buildDashboardReportPayload({
      location: {
        id: "loc_1",
        title: "Main Street",
        provider: "google",
        organization_id: "org_1",
        client_id: "client_1",
      },
      startStr: "2026-04-01",
      endStr: "2026-04-30",
      data: {
        range: { start: "2026-04-01", end: "2026-04-30", days: 30 },
      },
      metrics: [
        {
          metric: "WEBSITE_CLICKS",
          total: 12,
          points: [{ date: "2026-04-01", value: 4 }],
        },
      ],
    });

    expect(payload).toMatchObject({
      organization_id: "org_1",
      client_id: "client_1",
      location_id: "loc_1",
      report_name: "Google Business Profile dashboard 2026-04-01 to 2026-04-30",
      report_key: "gbp_dashboard_snapshot",
      requested_formats: ["pdf", "xlsx"],
      date_range: { start: "2026-04-01", end: "2026-04-30", days: 30 },
    });
    expect(payload.dashboard_snapshot).toMatchObject({
      title: "ParaMetrics Dashboard",
      provider: "google",
      metadata: {
        location_label: "Main Street",
        range_label: "2026-04-01 to 2026-04-30",
      },
    });
    expect(payload.dashboard_snapshot.cards[0]).toEqual({
      title: "Website Clicks",
      value: 12,
      metric: "WEBSITE_CLICKS",
    });
    expect(payload.dashboard_snapshot.metrics).toEqual([
      { name: "WEBSITE_CLICKS", value: 12 },
    ]);
    expect(payload.dashboard_snapshot.tables[0].rows).toEqual([
      ["WEBSITE_CLICKS", 12],
    ]);
    expect(payload.dashboard_snapshot.charts[0].points).toEqual([
      { date: "2026-04-01", value: 4 },
    ]);
    expect(JSON.stringify(payload)).not.toContain("token");
  });

  it("preserves backend filenames and content types when preparing downloads", async () => {
    const download = getReportDownload({
      format: "pdf",
      filename: "backend-name.pdf",
      content_type: "application/pdf",
      base64: btoa("hello report"),
    });

    expect(download.filename).toBe("backend-name.pdf");
    expect(download.format).toBe("pdf");
    expect(download.blob.type).toBe("application/pdf");
    expect(await download.blob.text()).toBe("hello report");
  });
});
