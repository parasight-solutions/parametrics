const DEFAULT_REPORT_FORMATS = Object.freeze(["pdf", "xlsx"]);

const KPI_DEFINITIONS = Object.freeze([
  { label: "Website Clicks", metric: "WEBSITE_CLICKS" },
  { label: "Call Clicks", metric: "CALL_CLICKS" },
  { label: "Direction Requests", metric: "DIRECTIONS_REQUESTS" },
  { label: "Search Impressions", metric: "BUSINESS_IMPRESSIONS_SEARCH" },
  { label: "Maps Impressions", metric: "BUSINESS_IMPRESSIONS_MAPS" },
]);

function cleanText(value, max = 200) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateRangeFromDashboard(data, startStr, endStr) {
  const start = cleanText(data?.range?.start || startStr, 20);
  const end = cleanText(data?.range?.end || endStr, 20);
  const days = Number(data?.range?.days || 0);

  return {
    start,
    end,
    ...(Number.isFinite(days) && days > 0 ? { days } : {}),
  };
}

function compactMetric(metric) {
  return {
    name: cleanText(metric?.metric, 160),
    value: safeNumber(metric?.total),
  };
}

function compactChart(metric) {
  return {
    title: cleanText(metric?.metric, 160),
    type: "sparkline",
    points: (metric?.points || []).slice(0, 366).map((point) => ({
      date: cleanText(point?.date, 20),
      value: safeNumber(point?.value),
    })),
  };
}

export function buildDashboardReportPayload({
  data,
  metrics = [],
  location,
  locationId,
  startStr,
  endStr,
} = {}) {
  const normalizedLocationId = cleanText(location?.id || locationId, 200);
  const locationLabel = cleanText(location?.title || location?.name || normalizedLocationId, 200);
  const provider = cleanText(location?.provider || data?.provider || "google", 80) || "google";
  const dateRange = dateRangeFromDashboard(data, startStr, endStr);
  const byMetric = new Map((metrics || []).map((metric) => [metric.metric, metric]));
  const cards = KPI_DEFINITIONS.map((definition) => ({
    title: definition.label,
    value: safeNumber(byMetric.get(definition.metric)?.total),
    metric: definition.metric,
  }));
  const compactMetrics = (metrics || []).slice(0, 50).map(compactMetric);

  return {
    organization_id: cleanText(location?.organization_id, 200),
    client_id: cleanText(location?.client_id, 200),
    location_id: normalizedLocationId,
    report_name: `Google Business Profile dashboard ${dateRange.start} to ${dateRange.end}`,
    report_key: "gbp_dashboard_snapshot",
    requested_formats: [...DEFAULT_REPORT_FORMATS],
    date_range: dateRange,
    dashboard_snapshot: {
      title: "ParaMetrics Dashboard",
      provider,
      cards,
      metrics: compactMetrics,
      tables: [
        {
          title: "Raw totals",
          columns: ["Metric", "Total"],
          rows: compactMetrics.map((metric) => [metric.name, metric.value]),
        },
      ],
      charts: (metrics || []).slice(0, 20).map(compactChart),
      metadata: {
        location_label: locationLabel,
        range_label: `${dateRange.start} to ${dateRange.end}`,
      },
    },
  };
}

export function reportFileToBlob(file = {}) {
  const base64 = cleanText(file.base64, Number.MAX_SAFE_INTEGER);
  if (!base64) {
    throw new Error("Report file is missing base64 content");
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], {
    type: cleanText(file.content_type, 200) || "application/octet-stream",
  });
}

export function getReportDownload(file = {}, index = 0) {
  const format = cleanText(file.format, 20) || "bin";
  const filename =
    cleanText(file.filename, 240) || `dashboard-report-${index + 1}.${format}`;

  return {
    filename,
    blob: reportFileToBlob(file),
    format,
  };
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadReportFiles(files = []) {
  const downloads = files.map((file, index) => getReportDownload(file, index));
  for (const download of downloads) {
    downloadBlob(download.filename, download.blob);
  }
  return downloads.map(({ filename, format }) => ({ filename, format }));
}
