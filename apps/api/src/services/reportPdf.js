import {
  createPendingOutput,
  markOutputFailed,
  markOutputSucceeded,
} from "./reportService.js";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 48;
const TOP_Y = 744;
const LINE_HEIGHT = 14;
const LINES_PER_PAGE = 48;
const MAX_TEXT_LENGTH = 140;
const MAX_CARDS = 12;
const MAX_METRICS = 12;
const MAX_TABLES = 4;
const MAX_TABLE_ROWS = 6;
const MAX_CHARTS = 8;

const SECRET_KEY_RE = /(?:password|passcode|secret|token|jwt|authorization|auth_code|code|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secrets_json)/i;

function cleanStr(value, max = MAX_TEXT_LENGTH) {
  const v = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!v) return "";
  return v.length > max ? `${v.slice(0, Math.max(0, max - 3))}...` : v;
}

function pdfText(value) {
  return cleanStr(value)
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function makeError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function valueForKeys(item, keys) {
  for (const key of keys) {
    if (item?.[key] !== null && item?.[key] !== undefined && item?.[key] !== "") {
      return item[key];
    }
  }
  return "";
}

function summarizePairs(item, maxPairs = 4) {
  if (!isPlainObject(item)) return cleanStr(item);

  return Object.entries(item)
    .filter(([key]) => !SECRET_KEY_RE.test(key))
    .slice(0, maxPairs)
    .map(([key, value]) => `${cleanStr(key, 40)}=${cleanStr(Array.isArray(value) ? `[${value.length}]` : value, 80)}`)
    .filter(Boolean)
    .join("; ");
}

function itemTitle(item, fallback) {
  if (!isPlainObject(item)) return cleanStr(item) || fallback;
  return cleanStr(valueForKeys(item, ["title", "label", "metric", "name", "key"]), 100) || fallback;
}

function itemValue(item) {
  if (!isPlainObject(item)) return "";
  return cleanStr(valueForKeys(item, ["value", "total", "count", "amount"]), 80);
}

function appendItemLines(lines, heading, items, limit, formatter) {
  const list = Array.isArray(items) ? items.slice(0, limit) : [];
  lines.push("");
  lines.push(`${heading} (${Array.isArray(items) ? items.length : 0})`);
  if (!list.length) {
    lines.push("  None");
    return;
  }
  list.forEach((item, idx) => {
    lines.push(`  ${idx + 1}. ${formatter(item, idx)}`);
  });
  if (Array.isArray(items) && items.length > limit) {
    lines.push(`  ... ${items.length - limit} more omitted`);
  }
}

export function buildDashboardSnapshotPdfLines(reportRun, options = {}) {
  if (!isPlainObject(reportRun)) {
    throw makeError("invalid_report_run", "reportRun must be an object");
  }

  const now = options.now || new Date();
  const snapshot = isPlainObject(reportRun.input_snapshot) ? reportRun.input_snapshot : {};
  const summary = isPlainObject(reportRun.input_snapshot_summary)
    ? reportRun.input_snapshot_summary
    : {};
  const range = reportRun.filters?.date_range || {};
  const lines = [];

  lines.push(cleanStr(reportRun.report_name || "Dashboard snapshot report", 120));
  lines.push(`Generated at: ${now.toISOString()}`);
  lines.push(`Report key: ${cleanStr(reportRun.report_key || "-", 120)}`);
  lines.push(`Report type: ${cleanStr(reportRun.report_type || "-", 120)}`);
  lines.push(`Date range: ${cleanStr(range.start || "-")} to ${cleanStr(range.end || "-")} (${cleanStr(range.days || "-")} days)`);
  lines.push(`Organization: ${cleanStr(reportRun.organization_id || "-")}`);
  lines.push(`Client: ${cleanStr(reportRun.client_id || "-")}`);
  lines.push(`Location: ${cleanStr(reportRun.location_id || "-")}`);
  lines.push(`Requested by: ${cleanStr(reportRun.requested_by_user_id || "-")}`);
  lines.push("");
  lines.push("Dashboard snapshot summary");
  lines.push(`  Title: ${cleanStr(summary.title || snapshot.title || "Dashboard snapshot", 120)}`);
  lines.push(`  Provider: ${cleanStr(summary.provider || snapshot.provider || "google", 80)}`);
  lines.push(`  Sections: ${Number(summary.section_count || 0)}`);
  lines.push(`  Cards: ${Number(summary.card_count || 0)}`);
  lines.push(`  Tables: ${Number(summary.table_count || 0)}`);
  lines.push(`  Charts: ${Number(summary.chart_count || 0)}`);
  lines.push(`  Metrics: ${Number(summary.metric_count || 0)}`);

  appendItemLines(lines, "Cards", snapshot.cards, MAX_CARDS, (item) => {
    const value = itemValue(item);
    return value ? `${itemTitle(item, "Card")}: ${value}` : `${itemTitle(item, "Card")} ${summarizePairs(item)}`;
  });

  appendItemLines(lines, "Metrics", snapshot.metrics, MAX_METRICS, (item) => {
    const value = itemValue(item);
    return value ? `${itemTitle(item, "Metric")}: ${value}` : `${itemTitle(item, "Metric")} ${summarizePairs(item)}`;
  });

  appendItemLines(lines, "Tables", snapshot.tables, MAX_TABLES, (table) => {
    const rows = Array.isArray(table?.rows) ? table.rows : [];
    return `${itemTitle(table, "Table")} rows=${rows.length}`;
  });

  for (const table of (Array.isArray(snapshot.tables) ? snapshot.tables.slice(0, MAX_TABLES) : [])) {
    const rows = Array.isArray(table?.rows) ? table.rows.slice(0, MAX_TABLE_ROWS) : [];
    for (const [idx, row] of rows.entries()) {
      lines.push(`    row ${idx + 1}: ${summarizePairs(row, 5) || "-"}`);
    }
    if (Array.isArray(table?.rows) && table.rows.length > MAX_TABLE_ROWS) {
      lines.push(`    ... ${table.rows.length - MAX_TABLE_ROWS} more rows omitted`);
    }
  }

  appendItemLines(lines, "Charts", snapshot.charts, MAX_CHARTS, (chart) => {
    const points = Array.isArray(chart?.points) ? chart.points.length : 0;
    return `${itemTitle(chart, "Chart")} points=${points}`;
  });

  return lines.map((line) => cleanStr(line, MAX_TEXT_LENGTH));
}

function paginate(lines) {
  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  return pages.length ? pages : [["Dashboard snapshot report"]];
}

function contentStreamForPage(lines) {
  return lines
    .map((line, idx) => {
      const y = TOP_Y - idx * LINE_HEIGHT;
      const fontSize = idx === 0 ? 16 : 10;
      return `BT /F1 ${fontSize} Tf ${MARGIN_X} ${y} Td (${pdfText(line)}) Tj ET`;
    })
    .join("\n");
}

function buildPdf(objects) {
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];

  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, "binary");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "binary");
}

export function renderDashboardSnapshotPdf(reportRun, options = {}) {
  const lines = buildDashboardSnapshotPdfLines(reportRun, options);
  const pages = paginate(lines);
  const fontId = 3 + pages.length * 2;
  const objects = [];
  const kids = pages.map((_page, idx) => `${3 + idx * 2} 0 R`).join(" ");

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [ ${kids} ] /Count ${pages.length} >>`;

  pages.forEach((pageLines, idx) => {
    const pageId = 3 + idx * 2;
    const contentId = pageId + 1;
    const stream = contentStreamForPage(pageLines);

    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`;
  });

  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  return buildPdf(objects);
}

export function buildPdfOutputResult(reportRun, options = {}) {
  const completedAt = options.now || new Date();
  const pending =
    reportRun?.outputs?.find((output) => output?.format === "pdf") ||
    createPendingOutput("pdf", completedAt);

  try {
    if (!Array.isArray(reportRun?.requested_formats) || !reportRun.requested_formats.includes("pdf")) {
      throw makeError("pdf_not_requested", "report run did not request pdf output");
    }

    const buffer = renderDashboardSnapshotPdf(reportRun, { now: completedAt });
    const output = markOutputSucceeded(pending, {
      path: options.path || null,
      size: buffer.length,
      completedAt,
    });

    return { buffer, output };
  } catch (error) {
    return {
      buffer: null,
      output: markOutputFailed(pending, {
        error,
        completedAt,
      }),
    };
  }
}
