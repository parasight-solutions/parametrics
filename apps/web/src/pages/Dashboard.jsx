import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../components/AppShell";
import ActiveLocationPicker from "../components/ActiveLocationPicker";
import { useCachedApi } from "../hooks/useCachedApi";
import RecurrenceLab from "../components/RecurrenceLab";
import { api, getToken } from "../apiClient";
import { getActiveLocationId } from "../session";
import {
  buildDashboardReportPayload,
  downloadBlob,
  downloadReportFiles,
} from "../reportDownloads";

function prettyWhenMs(ms) {
  if (!ms) return "-";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function ymdLocal(d) {
  // returns YYYY-MM-DD in local time (for <input type="date">)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseYmd(s) {
  const m = String(s || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]),
    mo = Number(m[2]),
    d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d)
    return null;
  return dt;
}

function diffDaysInclusive(a, b) {
  // local-midnight normalized
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.floor((B - A) / 86400000) + 1;
}

function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

async function svgTextToCanvas(
  svgText,
  { scale = 2, background = "#ffffff" } = {},
) {
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    // width/height come from the SVG attributes
    const w = Math.max(1, Math.floor(img.width * scale));
    const h = Math.max(1, Math.floor(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");

    // paint background
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);

    // scale + draw
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0);

    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function buildDashboardSvg({ metrics, locationId, startStr, endStr }) {
  // You can tweak styling here without touching PNG/PDF logic.
  const width = 980;

  // KPI tiles
  const kpiH = 92;
  const kpiGap = 14;
  const kpiCols = 3;

  // Metric rows
  const headerH = 70;
  const rowH = 72;
  const rowGap = 12;

  const leftPad = 18;
  const nameW = 360;
  const totalW = 110;
  const chartX = leftPad + nameW;
  const chartW = width - leftPad * 2 - nameW - totalW;
  const chartPadY = 14;
  const chartH = rowH - chartPadY * 2;

  const items = (metrics || []).slice(0, 24);

  const kpis = [
    { label: "Website Clicks", key: "WEBSITE_CLICKS" },
    { label: "Call Clicks", key: "CALL_CLICKS" },
    { label: "Direction Requests", key: "DIRECTIONS_REQUESTS" },
    { label: "Search Impressions", key: "BUSINESS_IMPRESSIONS_SEARCH" },
    { label: "Maps Impressions", key: "BUSINESS_IMPRESSIONS_MAPS" },
  ];

  const byKey = new Map(items.map((m) => [m.metric, m]));

  const kpiRows = Math.ceil(kpis.length / kpiCols);
  const kpiBlockH = kpiRows * kpiH + (kpiRows - 1) * kpiGap;

  const listTop = headerH + kpiBlockH + 18;
  const height = listTop + items.length * (rowH + rowGap) + 18;

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const sparkPoints = (pts, baseY) => {
    const vals = (pts || []).map((p) => Number(p.value || 0));
    if (!vals.length) return "";

    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const step = chartW / Math.max(1, vals.length - 1);

    return vals
      .map((v, i) => {
        const x = chartX + i * step;
        const y = baseY + chartPadY + chartH * (1 - (v - min) / range);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  };

  let body = "";
  body += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  body += `<text x="${leftPad}" y="28" font-size="20" font-family="Arial" fill="#111">ParaMetrics Dashboard</text>`;
  body += `<text x="${leftPad}" y="52" font-size="12" font-family="Arial" fill="#666">Location: ${esc(
    locationId,
  )} · ${esc(startStr)} to ${esc(endStr)}</text>`;

  // KPI tiles
  const kpiTileW = Math.floor(
    (width - leftPad * 2 - (kpiCols - 1) * kpiGap) / kpiCols,
  );

  kpis.forEach((k, idx) => {
    const col = idx % kpiCols;
    const row = Math.floor(idx / kpiCols);
    const x = leftPad + col * (kpiTileW + kpiGap);
    const y = headerH + row * (kpiH + kpiGap);

    const total = byKey.get(k.key)?.total ?? 0;

    body += `<rect x="${x}" y="${y}" width="${kpiTileW}" height="${kpiH}" rx="12" ry="12" fill="#fff" stroke="#e5e7eb"/>`;
    body += `<text x="${x + 14}" y="${y + 30}" font-size="12" font-family="Arial" fill="#666">${esc(k.label)}</text>`;
    body += `<text x="${x + 14}" y="${y + 66}" font-size="26" font-family="Arial" font-weight="700" fill="#111">${esc(
      total,
    )}</text>`;
  });

  // Metric rows
  let y = listTop;
  for (const m of items) {
    const rowTop = y;
    const rowMid = rowTop + 28;

    body += `<rect x="${leftPad}" y="${rowTop}" width="${width - leftPad * 2}" height="${rowH}" rx="10" ry="10" fill="#fff" stroke="#e5e7eb"/>`;

    body += `<text x="${leftPad + 14}" y="${rowMid}" font-size="13" font-family="Arial" fill="#111">${esc(
      m.metric,
    )}</text>`;
    body += `<text x="${width - leftPad - 14}" y="${rowMid}" font-size="13" font-family="Arial" fill="#111" text-anchor="end">${esc(
      m.total ?? 0,
    )}</text>`;

    const baseLineY = rowTop + chartPadY + chartH;
    body += `<line x1="${chartX}" y1="${baseLineY}" x2="${chartX + chartW}" y2="${baseLineY}" stroke="#f3f4f6" stroke-width="1"/>`;

    const poly = sparkPoints(m.points || [], rowTop);
    if (poly) {
      body += `<polyline fill="none" stroke="#111" stroke-width="2" points="${poly}" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      body += `<text x="${chartX}" y="${rowTop + 44}" font-size="11" font-family="Arial" fill="#9ca3af">No data</text>`;
    }

    y += rowH + rowGap;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${body}
</svg>`;
}

export default function Dashboard({ onLogout }) {
  const [locationId, setLocationId] = useState(getActiveLocationId());
  const [activeLocation, setActiveLocation] = useState(null);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportStatus, setReportStatus] = useState("");
  const [reportError, setReportError] = useState("");
  const exportRef = useRef(null);

  const handleLocationChange = useCallback((nextLocationId, location = null) => {
    setLocationId(nextLocationId || "");
    setActiveLocation(
      location && String(location.id) === String(nextLocationId) ? location : null,
    );
    setReportStatus("");
    setReportError("");
  }, []);

  useEffect(() => {
    function handleActiveLocationCleared(event) {
      const clearedId = event?.detail?.locationId || "";
      setActiveLocation(null);
      setLocationId((current) => {
        if (!clearedId || !current || String(current) === String(clearedId)) return "";
        return current;
      });
    }

    window.addEventListener("pm:active-location-cleared", handleActiveLocationCleared);
    return () => {
      window.removeEventListener("pm:active-location-cleared", handleActiveLocationCleared);
    };
  }, []);

  // ---- range state (per location) ----
  const rangeKey = useMemo(
    () => (locationId ? `dashRange:v1:${locationId}` : null),
    [locationId],
  );

  const [startStr, setStartStr] = useState("");
  const [endStr, setEndStr] = useState("");

  // load saved range per location (or default last 30 days)
  useEffect(() => {
    if (!locationId) {
      setStartStr("");
      setEndStr("");
      return;
    }

    const today = new Date();
    const defEnd = ymdLocal(today);
    const defStart = ymdLocal(new Date(today.getTime() - (30 - 1) * 86400000));

    let s = defStart;
    let e = defEnd;

    try {
      const raw = sessionStorage.getItem(rangeKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.start && parsed?.end) {
          s = parsed.start;
          e = parsed.end;
        }
      }
    } catch {
      // Ignore corrupt or unavailable saved ranges and fall back to defaults.
    }

    setStartStr(s);
    setEndStr(e);
  }, [locationId, rangeKey]);

  // persist range per location
  useEffect(() => {
    if (!rangeKey) return;
    if (!startStr || !endStr) return;
    try {
      sessionStorage.setItem(
        rangeKey,
        JSON.stringify({ start: startStr, end: endStr }),
      );
    } catch {
      // Dashboard still works without persisted date ranges.
    }
  }, [rangeKey, startStr, endStr]);

  const startDate = useMemo(() => parseYmd(startStr), [startStr]);
  const endDate = useMemo(() => parseYmd(endStr), [endStr]);

  const rangeError = useMemo(() => {
    if (!locationId) return null;
    if (!startDate || !endDate) return "Pick valid start and end dates.";
    if (endDate.getTime() < startDate.getTime())
      return "End date must be after start date.";
    const days = diffDaysInclusive(startDate, endDate);
    if (days < 1) return "Invalid date range.";
    if (days > 366) return "Range too large (max 366 days).";
    return null;
  }, [locationId, startDate, endDate]);

  const daysLabel = useMemo(() => {
    if (!startDate || !endDate) return "";
    return `${diffDaysInclusive(startDate, endDate)} days`;
  }, [startDate, endDate]);

  const path = useMemo(() => {
    if (!locationId) return null;
    if (rangeError) return null;
    // start/end are YYYY-MM-DD
    return `/integrations/google/performance-series?locationId=${encodeURIComponent(locationId)}&start=${encodeURIComponent(
      startStr,
    )}&end=${encodeURIComponent(endStr)}`;
  }, [locationId, startStr, endStr, rangeError]);

  const { data, loading, refreshing, error, lastUpdatedAt, refresh } =
    useCachedApi(path, {
      enabled: !!locationId && !rangeError,
      ttlMs: 5 * 60 * 1000,
      refreshIntervalMs: 60 * 1000,
      storage: "session",
    });

  const metrics = useMemo(() => data?.metrics || [], [data?.metrics]);
  const byName = useMemo(() => {
    const m = new Map();
    for (const x of metrics) m.set(x.metric, x);
    return m;
  }, [metrics]);

  const getTotal = (name) => byName.get(name)?.total ?? 0;
  const getPoints = (name) => byName.get(name)?.points ?? [];

  const reportDisabledReason = useMemo(() => {
    if (!getToken()) return "Log in to generate backend report files.";
    if (!locationId) return "Pick a location before generating a report.";
    if (!data) return "Load dashboard data before generating a report.";
    if (!activeLocation?.organization_id || !activeLocation?.client_id) {
      return "This location needs organization and client bindings before backend reports can run.";
    }
    if (rangeError) return rangeError;
    return "";
  }, [activeLocation, data, locationId, rangeError]);

  const canGenerateBackendReport = !reportGenerating && !reportDisabledReason;

  function applyPreset(days) {
    const today = new Date();
    const end = ymdLocal(today);
    const start = ymdLocal(new Date(today.getTime() - (days - 1) * 86400000));
    setStartStr(start);
    setEndStr(end);
  }

  async function exportCsv() {
    if (!data) return;

    // Build a date -> metric -> value map for points
    const metricKeys = metrics.map((m) => m.metric);
    const dateSet = new Set();
    for (const m of metrics)
      for (const p of m.points || []) dateSet.add(p.date);

    const dates = Array.from(dateSet.values()).sort((a, b) =>
      a.localeCompare(b),
    );

    const rows = [];
    rows.push([`ParaMetrics Dashboard Export`]);
    rows.push([`Location ID`, locationId]);
    rows.push([
      `Range Start`,
      data?.range?.start || startStr,
      `Range End`,
      data?.range?.end || endStr,
      `Days`,
      data?.range?.days || daysLabel,
    ]);
    rows.push([]);
    rows.push([`Totals`]);
    rows.push([`Metric`, `Total`]);
    for (const m of metrics) rows.push([m.metric, m.total ?? 0]);

    rows.push([]);
    rows.push([`Daily Points`]);
    rows.push([`Date`, ...metricKeys]);

    for (const d of dates) {
      const row = [d];
      for (const key of metricKeys) {
        const pts = byName.get(key)?.points || [];
        const hit = pts.find((x) => x.date === d);
        row.push(hit?.value ?? 0);
      }
      rows.push(row);
    }

    const csv = toCsv(rows);
    downloadBlob(
      `dashboard_${locationId}_${startStr}_to_${endStr}.csv`,
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
  }

  async function exportPng() {
    if (!data) return;

    try {
      const svg = buildDashboardSvg({ metrics, locationId, startStr, endStr });
      const canvas = await svgTextToCanvas(svg, {
        scale: 2,
        background: "#ffffff",
      });

      const blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );

      if (!blob)
        throw new Error("PNG export failed (canvas.toBlob returned null)");
      downloadBlob(
        `dashboard_${locationId}_${startStr}_to_${endStr}.png`,
        blob,
      );
    } catch (e) {
      console.error("[exportPng] failed", e);
      window.alert(e?.message || "PNG export failed. Check console.");
    }
  }

  async function exportPdf() {
    if (!data) return;

    try {
      const svg = buildDashboardSvg({ metrics, locationId, startStr, endStr });
      const canvas = await svgTextToCanvas(svg, {
        scale: 2,
        background: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");

      const jspdfMod = await import("jspdf");
      const { jsPDF } = jspdfMod;

      const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      const margin = 24;
      const usableW = pageW - margin * 2;
      const usableH = pageH - margin * 2;

      const imgW = canvas.width;
      const imgH = canvas.height;

      const ratio = usableW / imgW;
      const renderW = usableW;
      const renderH = imgH * ratio;

      // Header
      pdf.setFontSize(12);
      pdf.text("ParaMetrics Dashboard", margin, 16);
      pdf.setFontSize(10);
      pdf.text(`${locationId} · ${startStr} to ${endStr}`, margin, 30);

      if (renderH <= usableH) {
        pdf.addImage(imgData, "PNG", margin, margin + 16, renderW, renderH);
      } else {
        // Multi-page: same image, shifted up each page
        let yOffset = 0;
        let page = 0;

        while (yOffset < renderH) {
          if (page > 0) pdf.addPage();
          const y = margin + 16 - yOffset;
          pdf.addImage(imgData, "PNG", margin, y, renderW, renderH);
          yOffset += usableH;
          page++;
        }
      }

      pdf.save(`dashboard_${locationId}_${startStr}_to_${endStr}.pdf`);
    } catch (e) {
      console.error("[exportPdf] failed", e);
      window.alert(e?.message || "PDF export failed. Check console.");
    }
  }

  function exportSvg() {
    if (!data) return;

    const svg = buildDashboardSvg({ metrics, locationId, startStr, endStr });

    downloadBlob(
      `dashboard_${locationId}_${startStr}_to_${endStr}.svg`,
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
  }

  async function generateBackendReport() {
    if (!canGenerateBackendReport) return;

    setReportGenerating(true);
    setReportStatus("");
    setReportError("");

    try {
      const body = buildDashboardReportPayload({
        data,
        metrics,
        location: activeLocation,
        locationId,
        startStr,
        endStr,
      });

      const result = await api("/reports/dashboard-snapshot", {
        method: "POST",
        body,
      });

      const downloaded = downloadReportFiles(result.files || []);
      setReportStatus(
        downloaded.length
          ? `Generated ${downloaded.length} backend report file${downloaded.length === 1 ? "" : "s"}.`
          : "Report generated, but no files were returned.",
      );
    } catch (e) {
      console.error("[generateBackendReport] failed", e);
      setReportError(e?.message || e?.code || "Report generation failed.");
    } finally {
      setReportGenerating(false);
    }
  }

  return (
    <AppShell
      title="Dashboard"
      subtitle="Google Business Profile performance"
      onLogout={onLogout}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => refresh().catch(() => {})}
            disabled={!locationId || loading || refreshing || !!rangeError}
            className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
            title="Force refresh"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>

          <button
            type="button"
            onClick={() => generateBackendReport().catch(() => {})}
            disabled={!canGenerateBackendReport}
            className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
            title={
              reportGenerating
                ? "Generating backend PDF/XLSX report files"
                : reportDisabledReason || "Generate backend PDF/XLSX report files"
            }
          >
            {reportGenerating ? "Generating…" : "Report PDF/XLSX"}
          </button>

          <div className="inline-flex rounded-lg border overflow-hidden">
            <button
              onClick={() => exportCsv().catch?.(() => {})}
              disabled={!data}
              className="px-3 py-2 bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
              title="Export CSV"
            >
              CSV
            </button>
            <button
              onClick={() => exportSvg()}
              disabled={!data}
              className="px-3 py-2 bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
              title="Export SVG (vector chart pack)"
            >
              SVG
            </button>
            <button
              onClick={() => exportPng().catch?.(() => {})}
              disabled={!data}
              className="px-3 py-2 bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
              title="Export PNG (snapshot)"
            >
              PNG
            </button>
            <button
              onClick={() => exportPdf().catch?.(() => {})}
              disabled={!data}
              className="px-3 py-2 bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
              title="Export PDF (snapshot)"
            >
              PDF
            </button>
          </div>

          <RecurrenceLab
            locationId={locationId}
            onLocationChange={(nextLocationId) => handleLocationChange(nextLocationId)}
          />
        </div>
      }
    >
      <div className="bg-white border rounded-xl p-5 space-y-4">
        <div>
          <div className="text-sm text-gray-600 mb-2">Active Location</div>
          <ActiveLocationPicker value={locationId} onChange={handleLocationChange} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-3">
            <div className="text-xs text-gray-600 mb-1">Start date</div>
            <input
              type="date"
              value={startStr}
              onChange={(e) => setStartStr(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm bg-white"
              max={endStr || undefined}
            />
          </div>

          <div className="md:col-span-3">
            <div className="text-xs text-gray-600 mb-1">End date</div>
            <input
              type="date"
              value={endStr}
              onChange={(e) => setEndStr(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm bg-white"
              min={startStr || undefined}
            />
          </div>

          <div className="md:col-span-3">
            <div className="text-xs text-gray-600 mb-1">Quick ranges</div>
            <div className="inline-flex rounded-lg border overflow-hidden w-full">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => applyPreset(d)}
                  className="flex-1 px-3 py-2 text-sm bg-white hover:bg-gray-100"
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-3 text-xs text-gray-500 flex items-center justify-between flex-wrap gap-2">
            <div>
              Range:{" "}
              <span className="font-medium text-gray-700">
                {daysLabel || "-"}
              </span>
            </div>
            <div>
              Last updated:{" "}
              <span className="font-medium text-gray-700">
                {prettyWhenMs(lastUpdatedAt)}
              </span>
              {refreshing ? (
                <span className="ml-2 text-gray-500">· refreshing…</span>
              ) : null}
            </div>
          </div>
        </div>

        {rangeError ? (
          <div className="text-sm text-red-700">{rangeError}</div>
        ) : null}

        {error ? (
          <div className="text-sm text-red-700">
            {error?.message || error?.code || "Failed to load"}
          </div>
        ) : null}

        <div className="text-sm" aria-live="polite">
          {reportGenerating ? (
            <span className="text-gray-600">Generating backend report files…</span>
          ) : reportError ? (
            <span className="text-red-700">{reportError}</span>
          ) : reportStatus ? (
            <span className="text-green-700">{reportStatus}</span>
          ) : (
            <span className="sr-only">
              {reportDisabledReason || "Backend report generation is available."}
            </span>
          )}
        </div>
      </div>

      {!locationId ? (
        <div className="text-gray-600">
          Pick a location to load performance metrics.
        </div>
      ) : null}

      {locationId && loading && !data ? (
        <div className="text-gray-600">Loading performance…</div>
      ) : null}

      {locationId && data ? (
        <div ref={exportRef} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Kpi
              title="Website Clicks"
              value={getTotal("WEBSITE_CLICKS")}
              points={getPoints("WEBSITE_CLICKS")}
            />
            <Kpi
              title="Call Clicks"
              value={getTotal("CALL_CLICKS")}
              points={getPoints("CALL_CLICKS")}
            />
            <Kpi
              title="Direction Requests"
              value={getTotal("DIRECTIONS_REQUESTS")}
              points={getPoints("DIRECTIONS_REQUESTS")}
            />
            <Kpi
              title="Search Impressions"
              value={getTotal("BUSINESS_IMPRESSIONS_SEARCH")}
              points={getPoints("BUSINESS_IMPRESSIONS_SEARCH")}
            />
            <Kpi
              title="Maps Impressions"
              value={getTotal("BUSINESS_IMPRESSIONS_MAPS")}
              points={getPoints("BUSINESS_IMPRESSIONS_MAPS")}
            />
          </div>

          <div className="bg-white border rounded-xl p-5 overflow-auto">
            <div className="font-semibold mb-3">Raw totals</div>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Metric</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.metric} className="border-b">
                    <td className="py-2 pr-4">{m.metric}</td>
                    <td className="py-2 pr-4">{m.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function Kpi({ title, value, points }) {
  return (
    <div className="bg-white border rounded-xl p-5 space-y-2">
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-2xl font-bold">{value}</div>
      {points?.length ? (
        <Sparkline points={points} />
      ) : (
        <div className="text-xs text-gray-400">No trend data</div>
      )}
    </div>
  );
}

function Sparkline({ points }) {
  const vals = points.map((p) => Number(p.value || 0));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const w = 100;
  const h = 30;
  const pad = 2;
  const step = (w - pad * 2) / Math.max(1, vals.length - 1);

  const pts = vals
    .map((v, i) => {
      const x = pad + i * step;
      const y = pad + (h - pad * 2) * (1 - (v - min) / range);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8 text-gray-700">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        points={pts}
      />
    </svg>
  );
}
