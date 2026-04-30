import {
  createPendingOutput,
  markOutputFailed,
  markOutputSucceeded,
} from "./reportService.js";

const MAX_TEXT_LENGTH = 160;
const MAX_CARDS = 100;
const MAX_METRICS = 100;
const MAX_TABLES = 20;
const MAX_TABLE_ROWS = 200;
const MAX_CHARTS = 100;
const MAX_CHART_POINTS = 50;

const SECRET_KEY_RE = /(?:password|passcode|secret|token|jwt|authorization|auth_code|code|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secrets_json)/i;

const WORKSHEETS = Object.freeze([
  { name: "Summary", path: "xl/worksheets/sheet1.xml", relationshipId: "rId1" },
  { name: "Cards", path: "xl/worksheets/sheet2.xml", relationshipId: "rId2" },
  { name: "Metrics", path: "xl/worksheets/sheet3.xml", relationshipId: "rId3" },
  { name: "Tables", path: "xl/worksheets/sheet4.xml", relationshipId: "rId4" },
  { name: "Charts", path: "xl/worksheets/sheet5.xml", relationshipId: "rId5" },
]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function cleanStr(value, max = MAX_TEXT_LENGTH) {
  const v = String(value ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!v) return "";
  return v.length > max ? `${v.slice(0, Math.max(0, max - 3))}...` : v;
}

function makeError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function escapeXml(value) {
  return cleanStr(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function valueForKeys(item, keys) {
  for (const key of keys) {
    if (item?.[key] !== null && item?.[key] !== undefined && item?.[key] !== "") {
      return item[key];
    }
  }
  return "";
}

function itemTitle(item, fallback) {
  if (!isPlainObject(item)) return cleanStr(item) || fallback;
  return cleanStr(valueForKeys(item, ["title", "label", "metric", "name", "key"]), 100) || fallback;
}

function itemValue(item) {
  if (!isPlainObject(item)) return "";
  return cleanStr(valueForKeys(item, ["value", "total", "count", "amount"]), 100);
}

function summarizeCellValue(value) {
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (isPlainObject(value)) return summarizePairs(value, 4);
  return cleanStr(value, 120);
}

function summarizePairs(item, maxPairs = 6) {
  if (!isPlainObject(item)) return cleanStr(item);

  return Object.entries(item)
    .filter(([key]) => !SECRET_KEY_RE.test(key))
    .slice(0, maxPairs)
    .map(([key, value]) => `${cleanStr(key, 40)}=${summarizeCellValue(value)}`)
    .filter(Boolean)
    .join("; ");
}

function safeRows(items, limit) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

function addOmittedRow(rows, label, omittedCount) {
  if (omittedCount > 0) rows.push([label, "", "", `${omittedCount} more omitted`]);
}

function summaryRows(reportRun, snapshot, summary, now) {
  const range = reportRun.filters?.date_range || {};

  return [
    ["Field", "Value"],
    ["Report name", cleanStr(reportRun.report_name || "Dashboard snapshot report", 120)],
    ["Report key", cleanStr(reportRun.report_key || "-", 120)],
    ["Report type", cleanStr(reportRun.report_type || "-", 120)],
    ["Generated at", now.toISOString()],
    ["Date range start", cleanStr(range.start || "-")],
    ["Date range end", cleanStr(range.end || "-")],
    ["Date range days", cleanStr(range.days || "-")],
    ["Organization ID", cleanStr(reportRun.organization_id || "-")],
    ["Client ID", cleanStr(reportRun.client_id || "-")],
    ["Location ID", cleanStr(reportRun.location_id || "-")],
    ["Requested by user ID", cleanStr(reportRun.requested_by_user_id || "-")],
    ["Snapshot title", cleanStr(summary.title || snapshot.title || "Dashboard snapshot", 120)],
    ["Provider", cleanStr(summary.provider || snapshot.provider || "google", 80)],
    ["Section count", Number(summary.section_count || 0)],
    ["Card count", Number(summary.card_count || 0)],
    ["Table count", Number(summary.table_count || 0)],
    ["Chart count", Number(summary.chart_count || 0)],
    ["Metric count", Number(summary.metric_count || 0)],
  ];
}

function cardRows(snapshot) {
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
  const rows = [["Index", "Title", "Value", "Details"]];

  safeRows(cards, MAX_CARDS).forEach((card, idx) => {
    rows.push([idx + 1, itemTitle(card, "Card"), itemValue(card), summarizePairs(card)]);
  });
  addOmittedRow(rows, "Omitted cards", cards.length - MAX_CARDS);

  return rows;
}

function metricRows(snapshot) {
  const metrics = Array.isArray(snapshot.metrics) ? snapshot.metrics : [];
  const rows = [["Index", "Metric", "Value", "Details"]];

  safeRows(metrics, MAX_METRICS).forEach((metric, idx) => {
    rows.push([idx + 1, itemTitle(metric, "Metric"), itemValue(metric), summarizePairs(metric)]);
  });
  addOmittedRow(rows, "Omitted metrics", metrics.length - MAX_METRICS);

  return rows;
}

function tableRows(snapshot) {
  const tables = Array.isArray(snapshot.tables) ? snapshot.tables : [];
  const rows = [["Table", "Row", "Data", "Notes"]];

  safeRows(tables, MAX_TABLES).forEach((table) => {
    const title = itemTitle(table, "Table");
    const dataRows = Array.isArray(table?.rows) ? table.rows : [];

    if (!dataRows.length) {
      rows.push([title, "", "", "No rows"]);
      return;
    }

    safeRows(dataRows, MAX_TABLE_ROWS).forEach((row, idx) => {
      rows.push([title, idx + 1, summarizePairs(row, 10), ""]);
    });

    if (dataRows.length > MAX_TABLE_ROWS) {
      rows.push([title, "", "", `${dataRows.length - MAX_TABLE_ROWS} rows omitted`]);
    }
  });
  addOmittedRow(rows, "Omitted tables", tables.length - MAX_TABLES);

  return rows;
}

function chartRows(snapshot) {
  const charts = Array.isArray(snapshot.charts) ? snapshot.charts : [];
  const rows = [["Index", "Chart", "Point count", "Details"]];

  safeRows(charts, MAX_CHARTS).forEach((chart, idx) => {
    const points = Array.isArray(chart?.points) ? chart.points : [];
    const pointSummary = safeRows(points, MAX_CHART_POINTS).map((point) => summarizePairs(point, 4)).filter(Boolean);
    const omitted = points.length > MAX_CHART_POINTS ? `; ${points.length - MAX_CHART_POINTS} points omitted` : "";
    rows.push([
      idx + 1,
      itemTitle(chart, "Chart"),
      points.length,
      `${summarizePairs(chart, 4)}${pointSummary.length ? `; points=${pointSummary.join(" | ")}` : ""}${omitted}`,
    ]);
  });
  addOmittedRow(rows, "Omitted charts", charts.length - MAX_CHARTS);

  return rows;
}

export function buildDashboardSnapshotXlsxSheets(reportRun, options = {}) {
  if (!isPlainObject(reportRun)) {
    throw makeError("invalid_report_run", "reportRun must be an object");
  }

  const now = options.now || new Date();
  const snapshot = isPlainObject(reportRun.input_snapshot) ? reportRun.input_snapshot : {};
  const summary = isPlainObject(reportRun.input_snapshot_summary)
    ? reportRun.input_snapshot_summary
    : {};

  return [
    { name: "Summary", rows: summaryRows(reportRun, snapshot, summary, now) },
    { name: "Cards", rows: cardRows(snapshot) },
    { name: "Metrics", rows: metricRows(snapshot) },
    { name: "Tables", rows: tableRows(snapshot) },
    { name: "Charts", rows: chartRows(snapshot) },
  ];
}

function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function worksheetXml(rows) {
  const body = rows
    .map((row, rowIdx) => {
      const cells = row
        .map((cell, colIdx) => {
          const ref = `${columnName(colIdx)}${rowIdx + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIdx + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function workbookXml() {
  const sheets = WORKSHEETS
    .map((sheet, idx) => `<sheet name="${sheet.name}" sheetId="${idx + 1}" r:id="${sheet.relationshipId}"/>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelationshipsXml() {
  const relationships = WORKSHEETS
    .map((sheet) => `<Relationship Id="${sheet.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheet.path.split("/").pop()}"/>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`;
}

function rootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function contentTypesXml() {
  const overrides = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ...WORKSHEETS.map((sheet) => `<Override PartName="/${sheet.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${overrides}</Types>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localFileHeader(nameBuffer, dataBuffer, crc) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(dataBuffer.length, 18);
  header.writeUInt32LE(dataBuffer.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralDirectoryHeader(nameBuffer, dataBuffer, crc, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(dataBuffer.length, 20);
  header.writeUInt32LE(dataBuffer.length, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function endOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralDirectorySize, 12);
  record.writeUInt32LE(centralDirectoryOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function zipStored(files) {
  let offset = 0;
  const localParts = [];
  const centralParts = [];

  for (const file of files) {
    const nameBuffer = Buffer.from(file.path, "utf8");
    const dataBuffer = Buffer.from(file.content, "utf8");
    const crc = crc32(dataBuffer);
    const localHeader = localFileHeader(nameBuffer, dataBuffer, crc);

    localParts.push(localHeader, nameBuffer, dataBuffer);
    centralParts.push(centralDirectoryHeader(nameBuffer, dataBuffer, crc, offset), nameBuffer);
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = endOfCentralDirectory(files.length, centralDirectorySize, centralDirectoryOffset);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

export function renderDashboardSnapshotXlsx(reportRun, options = {}) {
  const sheets = buildDashboardSnapshotXlsxSheets(reportRun, options);
  const sheetMap = new Map(sheets.map((sheet) => [sheet.name, sheet.rows]));

  const files = [
    { path: "[Content_Types].xml", content: contentTypesXml() },
    { path: "_rels/.rels", content: rootRelationshipsXml() },
    { path: "xl/workbook.xml", content: workbookXml() },
    { path: "xl/_rels/workbook.xml.rels", content: workbookRelationshipsXml() },
    ...WORKSHEETS.map((sheet) => ({
      path: sheet.path,
      content: worksheetXml(sheetMap.get(sheet.name) || [["No data"]]),
    })),
  ];

  return zipStored(files);
}

export function buildXlsxOutputResult(reportRun, options = {}) {
  const completedAt = options.now || new Date();
  const pending =
    reportRun?.outputs?.find((output) => output?.format === "xlsx") ||
    createPendingOutput("xlsx", completedAt);

  try {
    if (!Array.isArray(reportRun?.requested_formats) || !reportRun.requested_formats.includes("xlsx")) {
      throw makeError("xlsx_not_requested", "report run did not request xlsx output");
    }

    const buffer = renderDashboardSnapshotXlsx(reportRun, { now: completedAt });
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
