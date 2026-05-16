import { describe, expect, it, vi } from "vitest";
import {
  REPORT_LIST_LIMIT_DEFAULT,
  REPORT_LIST_LIMIT_MAX,
  REPORT_LIST_LIMIT_MIN,
  REPORT_RUN_FORMATS,
  REPORT_RUN_STATUSES,
  buildReportRunsQuery,
  clampReportListLimit,
  describeReportHistoryError,
  downloadReportOutput,
  formatBytes,
  normalizeReportRunRow,
  parseContentDispositionFilename,
  safeDownloadFilename,
} from "./reportHistory";

describe("reportHistory constants", () => {
  it("exposes the canonical status, format, and limit constants", () => {
    expect(REPORT_RUN_STATUSES).toEqual(["pending", "running", "succeeded", "failed"]);
    expect(REPORT_RUN_FORMATS).toEqual(["pdf", "xlsx"]);
    expect(REPORT_LIST_LIMIT_DEFAULT).toBe(25);
    expect(REPORT_LIST_LIMIT_MIN).toBe(1);
    expect(REPORT_LIST_LIMIT_MAX).toBe(100);
  });
});

describe("clampReportListLimit", () => {
  it("returns the default for non-numeric input", () => {
    expect(clampReportListLimit(undefined)).toBe(REPORT_LIST_LIMIT_DEFAULT);
    expect(clampReportListLimit("not-a-number")).toBe(REPORT_LIST_LIMIT_DEFAULT);
  });

  it("bounds the value to [1, 100]", () => {
    expect(clampReportListLimit(0)).toBe(1);
    expect(clampReportListLimit(-50)).toBe(1);
    expect(clampReportListLimit(1)).toBe(1);
    expect(clampReportListLimit(25)).toBe(25);
    expect(clampReportListLimit(100)).toBe(100);
    expect(clampReportListLimit(1000)).toBe(100);
  });

  it("floors fractional values", () => {
    expect(clampReportListLimit(7.9)).toBe(7);
  });
});

describe("buildReportRunsQuery", () => {
  it("omits empty filters and produces an empty string when nothing is set", () => {
    expect(buildReportRunsQuery({})).toBe("");
    expect(buildReportRunsQuery({ status: "" })).toBe("");
  });

  it("includes only the populated, valid filters", () => {
    const out = buildReportRunsQuery({
      organization_id: "org_1",
      client_id: "",
      report_type: "dashboard_snapshot",
      status: "succeeded",
      report_key: "s2-22-1-smoke-dashboard",
      date_from: "2026-05-11",
      date_to: "2026-05-13",
      limit: 5,
    });

    expect(out.startsWith("?")).toBe(true);
    const params = new URLSearchParams(out.slice(1));
    expect(params.get("organization_id")).toBe("org_1");
    expect(params.has("client_id")).toBe(false);
    expect(params.get("report_type")).toBe("dashboard_snapshot");
    expect(params.get("status")).toBe("succeeded");
    expect(params.get("report_key")).toBe("s2-22-1-smoke-dashboard");
    expect(params.get("date_from")).toBe("2026-05-11");
    expect(params.get("date_to")).toBe("2026-05-13");
    expect(params.get("limit")).toBe("5");
  });

  it("drops malformed status, date_from, and date_to values", () => {
    const out = buildReportRunsQuery({
      organization_id: "org_1",
      status: "bogus",
      date_from: "2026/05/11",
      date_to: "not-a-date",
    });
    const params = new URLSearchParams(out.slice(1));
    expect(params.get("organization_id")).toBe("org_1");
    expect(params.has("status")).toBe(false);
    expect(params.has("date_from")).toBe(false);
    expect(params.has("date_to")).toBe(false);
  });

  it("clamps the limit to [1,100]", () => {
    const big = buildReportRunsQuery({ organization_id: "org_1", limit: 9999 });
    expect(new URLSearchParams(big.slice(1)).get("limit")).toBe("100");
    const small = buildReportRunsQuery({ organization_id: "org_1", limit: -2 });
    expect(new URLSearchParams(small.slice(1)).get("limit")).toBe("1");
  });
});

describe("parseContentDispositionFilename", () => {
  it("returns an empty string for missing or empty input", () => {
    expect(parseContentDispositionFilename("")).toBe("");
    expect(parseContentDispositionFilename(null)).toBe("");
    expect(parseContentDispositionFilename(undefined)).toBe("");
  });

  it("extracts a quoted filename", () => {
    expect(
      parseContentDispositionFilename(
        'attachment; filename="s2-22-1-smoke-dashboard-abc-123.pdf"',
      ),
    ).toBe("s2-22-1-smoke-dashboard-abc-123.pdf");
  });

  it("extracts a bare filename when no quotes are present", () => {
    expect(
      parseContentDispositionFilename("attachment; filename=report-1.xlsx"),
    ).toBe("report-1.xlsx");
  });

  it("prefers RFC 5987 filename* when present", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''hello%20world.pdf",
      ),
    ).toBe("hello world.pdf");
  });
});

describe("safeDownloadFilename", () => {
  it("returns the candidate when it matches the safe pattern", () => {
    expect(safeDownloadFilename("report-1.pdf", "fallback.pdf")).toBe("report-1.pdf");
  });

  it("falls back when the candidate contains unsafe characters", () => {
    expect(safeDownloadFilename("../../etc/passwd", "fallback.pdf")).toBe("fallback.pdf");
    expect(safeDownloadFilename("hello world.pdf", "fallback.pdf")).toBe("fallback.pdf");
    expect(safeDownloadFilename("", "fallback.pdf")).toBe("fallback.pdf");
  });

  it("falls back to the generic default when both candidates are unsafe", () => {
    expect(safeDownloadFilename("hi there", "also bad")).toBe("report.bin");
  });
});

describe("formatBytes", () => {
  it("handles invalid and zero input", () => {
    expect(formatBytes(undefined)).toBe("-");
    expect(formatBytes(-1)).toBe("-");
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats common byte ranges with units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(8678)).toBe("8.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });
});

describe("describeReportHistoryError", () => {
  it("returns a safe default for empty input", () => {
    expect(describeReportHistoryError(null)).toBe("Unknown error.");
    expect(describeReportHistoryError(undefined)).toBe("Unknown error.");
  });

  it("formats code+message envelopes", () => {
    expect(
      describeReportHistoryError({ code: "organization_role_required", message: "nope" }),
    ).toBe("organization_role_required: nope");
  });

  it("falls back to message when code is missing", () => {
    expect(describeReportHistoryError({ message: "Boom" })).toBe("Boom");
  });

  it("handles nested error envelopes from the API client", () => {
    expect(
      describeReportHistoryError({ error: { code: "report_run_not_found", message: "x" } }),
    ).toBe("report_run_not_found: x");
  });
});

describe("normalizeReportRunRow", () => {
  it("normalizes a row and drops storage_key from outputs", () => {
    const row = normalizeReportRunRow({
      id: "run_1",
      report_key: "gbp_dashboard",
      report_type: "dashboard_snapshot",
      report_name: "Test report",
      status: "SUCCEEDED",
      requested_formats: ["PDF", "xlsx"],
      organization_id: "org_1",
      client_id: "",
      location_id: null,
      requested_by_user_id: "user_1",
      created_at: "2026-05-11T00:00:00Z",
      outputs: [
        {
          format: "PDF",
          status: "succeeded",
          size: 2047,
          storage_provider: "local",
          storage_key: "report-outputs/org_1/2026/05/run_1.pdf",
          content_type: "application/pdf",
          filename: "gbp-report.pdf",
          generated_at: "2026-05-11T00:00:01Z",
        },
        {
          format: "xlsx",
          status: "pending",
          storage_provider: null,
          storage_key: null,
        },
      ],
    });

    expect(row.id).toBe("run_1");
    expect(row.status).toBe("succeeded");
    expect(row.requested_formats).toEqual(["pdf", "xlsx"]);
    expect(row.client_id).toBe(null);
    expect(row.location_id).toBe(null);
    expect(row.outputs[0]).toMatchObject({
      format: "pdf",
      status: "succeeded",
      size: 2047,
      storage_provider: "local",
      content_type: "application/pdf",
      filename: "gbp-report.pdf",
      downloadable: true,
    });
    expect("storage_key" in row.outputs[0]).toBe(false);
    expect(row.outputs[1]).toMatchObject({
      format: "xlsx",
      status: "pending",
      downloadable: false,
    });
    expect("storage_key" in row.outputs[1]).toBe(false);
    // No storage_key field is ever exposed on the normalized row.
    expect(JSON.stringify(row)).not.toContain("storage_key");
  });

  it("returns an empty shell for non-object input", () => {
    const row = normalizeReportRunRow(null);
    expect(row.id).toBe("");
    expect(row.outputs).toEqual([]);
  });
});

describe("downloadReportOutput", () => {
  function makeResponse({
    ok = true,
    status = 200,
    headers = {},
    body = new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    jsonBody = null,
  } = {}) {
    const lowerHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      lowerHeaders[k.toLowerCase()] = String(v);
    }
    return {
      ok,
      status,
      headers: { get: (name) => lowerHeaders[String(name).toLowerCase()] || null },
      async blob() {
        return new Blob([body], { type: lowerHeaders["content-type"] || "" });
      },
      async json() {
        if (!jsonBody) throw new Error("not json");
        return jsonBody;
      },
    };
  }

  it("throws when runId is missing", async () => {
    await expect(downloadReportOutput({ format: "pdf" })).rejects.toThrow(/runId is required/);
  });

  it("throws when format is unsupported", async () => {
    await expect(
      downloadReportOutput({ runId: "run_1", format: "csv" }),
    ).rejects.toThrow(/pdf or xlsx/);
  });

  it("builds the expected URL, sends the bearer token, and returns the blob with parsed filename", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="s2-22-1-smoke-dashboard-abc.pdf"',
        },
      }),
    );

    const out = await downloadReportOutput({
      runId: "run with space",
      format: "PDF",
      apiBase: "http://127.0.0.1:5050/",
      token: "tkn",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(
      "http://127.0.0.1:5050/api/v1/reports/runs/run%20with%20space/outputs/pdf",
    );
    expect(calledInit.method).toBe("GET");
    expect(calledInit.headers.Authorization).toBe("Bearer tkn");
    expect(out.filename).toBe("s2-22-1-smoke-dashboard-abc.pdf");
    expect(out.contentType).toBe("application/pdf");
    expect(out.size).toBe(4);
    expect(out.blob).toBeInstanceOf(Blob);
  });

  it("uses a safe fallback filename when the server response has no Content-Disposition", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({
        headers: { "Content-Type": "application/pdf" },
      }),
    );

    const out = await downloadReportOutput({
      runId: "run_1",
      format: "pdf",
      apiBase: "",
      token: "",
      fetchImpl,
    });

    expect(out.filename).toBe("report-run_1.pdf");
  });

  it("throws the parsed JSON error envelope on non-2xx responses", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({
        ok: false,
        status: 403,
        headers: { "Content-Type": "application/json" },
        jsonBody: { error: { code: "organization_scope_required", message: "nope" } },
      }),
    );

    await expect(
      downloadReportOutput({
        runId: "run_1",
        format: "pdf",
        apiBase: "",
        token: "tkn",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "organization_scope_required",
      message: "nope",
      status: 403,
    });
  });
});
