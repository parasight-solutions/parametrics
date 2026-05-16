import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboardSnapshotReportRun, markOutputSucceeded } from "./reportService.js";
import {
  REPORT_LIST_DEFAULT_LIMIT,
  REPORT_LIST_MAX_LIMIT,
  buildReportDefinitionDoc,
  buildReportRunDoc,
  buildReportRunListQuery,
  createReportDefinition,
  findReportRunOutput,
  getReportRunById,
  listReportRuns,
  markReportRunFailed,
  markReportRunRunning,
  markReportRunSucceeded,
  sanitizeReportRunRow,
  savePendingReportRun,
} from "./reportStore.js";

const fixedNow = new Date("2026-05-01T12:00:00.000Z");
const later = new Date("2026-05-01T12:30:00.000Z");

function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)) {
      const ops = Object.keys(value);
      return ops.every((op) => {
        const target = doc[key];
        const rhs = value[op];
        if (op === "$gte") return target instanceof Date && rhs instanceof Date && target.getTime() >= rhs.getTime();
        if (op === "$lte") return target instanceof Date && rhs instanceof Date && target.getTime() <= rhs.getTime();
        if (op === "$gt") return target instanceof Date && rhs instanceof Date && target.getTime() > rhs.getTime();
        if (op === "$lt") return target instanceof Date && rhs instanceof Date && target.getTime() < rhs.getTime();
        return false;
      });
    }
    return doc[key] === value;
  });
}

function applyProjection(doc, projection) {
  if (!projection) return doc;
  const out = structuredClone(doc);
  for (const [key, value] of Object.entries(projection)) {
    if (value === 0) delete out[key];
  }
  return out;
}

function applySort(docs, sort) {
  if (!sort) return docs;
  const entries = Object.entries(sort);
  return [...docs].sort((a, b) => {
    for (const [key, direction] of entries) {
      const av = a[key];
      const bv = b[key];
      const aTime = av instanceof Date ? av.getTime() : av;
      const bTime = bv instanceof Date ? bv.getTime() : bv;
      if (aTime > bTime) return direction === -1 ? -1 : 1;
      if (aTime < bTime) return direction === -1 ? 1 : -1;
    }
    return 0;
  });
}

class MemoryCollection {
  constructor() {
    this.docs = [];
  }

  async insertOne(doc) {
    this.docs.push(structuredClone(doc));
    return { acknowledged: true, insertedId: doc.id };
  }

  async findOne(filter) {
    const doc = this.docs.find((item) => matchesFilter(item, filter));
    return doc ? structuredClone(doc) : null;
  }

  async updateOne(filter, update) {
    const idx = this.docs.findIndex((item) => matchesFilter(item, filter));
    if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
    this.docs[idx] = { ...this.docs[idx], ...(update.$set || {}) };
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async findOneAndUpdate(filter, update) {
    await this.updateOne(filter, update);
    return { value: await this.findOne(filter) };
  }

  find(filter, options = {}) {
    const matched = this.docs.filter((item) => matchesFilter(item, filter));
    const sorted = applySort(matched, options.sort);
    const limited = options.limit ? sorted.slice(0, options.limit) : sorted;
    const projected = limited.map((doc) => applyProjection(doc, options.projection));
    return {
      toArray: async () => projected.map((doc) => structuredClone(doc)),
    };
  }
}

function collections() {
  return {
    reports: new MemoryCollection(),
    reportRuns: new MemoryCollection(),
  };
}

function sampleRun(overrides = {}) {
  return buildDashboardSnapshotReportRun(
    {
      report_id: "report_1",
      report_name: "April GBP Dashboard",
      report_key: "gbp_dashboard_april",
      organization_id: "org_1",
      client_id: "client_1",
      location_id: "loc_1",
      requested_by_user_id: "user_1",
      requested_formats: ["pdf", "xlsx"],
      date_range: { start: "2026-04-01", end: "2026-04-30" },
      dashboard_snapshot: {
        title: "April dashboard",
        provider: "google",
        cards: [{ title: "Website Clicks", value: 42 }],
        metadata: { access_token: "must not persist" },
      },
      ...overrides,
    },
    { now: fixedNow, idFactory: () => "run_1" }
  );
}

test("buildReportDefinitionDoc normalizes report definition scope", () => {
  const doc = buildReportDefinitionDoc(
    {
      report_key: "gbp_dashboard_monthly",
      name: "Monthly GBP dashboard",
      organization_id: "org_1",
      client_id: "client_1",
      default_formats: ["PDF", "xlsx", "pdf"],
      created_by_user_id: "user_1",
    },
    { now: fixedNow, idFactory: () => "report_1" }
  );

  assert.equal(doc.id, "report_1");
  assert.equal(doc.report_key, "gbp_dashboard_monthly");
  assert.equal(doc.name, "Monthly GBP dashboard");
  assert.equal(doc.type, "dashboard_snapshot");
  assert.deepEqual(doc.scope, {
    organization_id: "org_1",
    client_id: "client_1",
    location_id: null,
  });
  assert.deepEqual(doc.default_formats, ["pdf", "xlsx"]);
  assert.equal(doc.status, "active");
  assert.equal(doc.created_by_user_id, "user_1");
  assert.equal(doc.created_at, fixedNow);
});

test("createReportDefinition stores a report definition through injected collections", async () => {
  const store = collections();
  const doc = await createReportDefinition(
    {
      report_key: "gbp_dashboard_monthly",
      organization_id: "org_1",
    },
    { collections: store, now: fixedNow, idFactory: () => "report_1" }
  );

  assert.equal(doc.id, "report_1");
  assert.equal(store.reports.docs.length, 1);
  assert.equal(store.reports.docs[0].organization_id, "org_1");
});

test("buildReportRunDoc persists lifecycle metadata without raw snapshot or buffers", () => {
  const output = markOutputSucceeded(sampleRun().outputs[0], {
    path: "reports/run_1.pdf",
    size: 1234,
    completedAt: later,
  });
  const doc = buildReportRunDoc(
    {
      ...sampleRun(),
      outputs: [{ ...output, buffer: Buffer.from("not stored") }],
      input_snapshot: { huge: "not stored" },
    },
    { now: fixedNow }
  );

  assert.equal(doc.id, "run_1");
  assert.equal(doc.report_id, "report_1");
  assert.equal(doc.status, "pending");
  assert.deepEqual(doc.requested_formats, ["pdf", "xlsx"]);
  assert.equal(doc.organization_id, "org_1");
  assert.equal(doc.client_id, "client_1");
  assert.equal(doc.location_id, "loc_1");
  assert.equal(doc.input_snapshot_summary.title, "April dashboard");
  assert.equal(doc.input_snapshot, undefined);
  assert.equal(doc.outputs[0].buffer, undefined);
  assert.equal(doc.outputs[0].path, "reports/run_1.pdf");
});

test("report run status helpers transition persisted metadata", async () => {
  const store = collections();
  const pending = await savePendingReportRun(sampleRun(), {
    collections: store,
    now: fixedNow,
  });

  assert.equal(pending.status, "pending");
  assert.equal(store.reportRuns.docs.length, 1);

  const running = await markReportRunRunning("run_1", {
    collections: store,
    now: later,
  });

  assert.equal(running.status, "running");
  assert.equal(running.started_at.toISOString(), later.toISOString());

  const succeededOutput = markOutputSucceeded(sampleRun().outputs[1], {
    path: "reports/run_1.xlsx",
    size: 4321,
    completedAt: later,
  });
  const succeeded = await markReportRunSucceeded("run_1", {
    collections: store,
    outputs: [{ ...succeededOutput, buffer: Buffer.from("not stored") }],
    completedAt: later,
  });

  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.outputs[0].format, "xlsx");
  assert.equal(succeeded.outputs[0].size, 4321);
  assert.equal(succeeded.outputs[0].buffer, undefined);
  assert.equal(succeeded.error, null);

  const failed = await markReportRunFailed("run_1", {
    collections: store,
    error: { code: "xlsx_failed", message: "Renderer failed" },
    completedAt: later,
  });

  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.error, {
    code: "xlsx_failed",
    message: "Renderer failed",
  });
});

test("report persistence requires explicit organization scope", () => {
  assert.throws(
    () => buildReportDefinitionDoc({ report_key: "missing_scope" }),
    /organization_id is required/
  );

  assert.throws(
    () => buildReportRunDoc(sampleRun({ organization_id: "" })),
    /organization_id is required/
  );

  assert.throws(
    () => buildReportDefinitionDoc({ report_key: "loc_scope", organization_id: "org_1", location_id: "loc_1" }),
    /client_id is required/
  );
});

function dateAt(iso) {
  return new Date(iso);
}

async function seedReportRuns(collections, runs) {
  for (const run of runs) {
    const doc = buildReportRunDoc(
      {
        report_id: run.report_id || null,
        report_name: run.report_name || "Seeded run",
        report_key: run.report_key || "seeded_key",
        organization_id: run.organization_id || "org_seed",
        client_id: run.client_id || null,
        location_id: run.location_id || null,
        requested_by_user_id: run.requested_by_user_id || "user_seed",
        requested_formats: run.requested_formats || ["pdf"],
        date_range: run.date_range || { start: "2026-04-01", end: "2026-04-30" },
        dashboard_snapshot: run.dashboard_snapshot || {
          title: "seed",
          provider: "google",
          metadata: { access_token: "must not persist" },
        },
        status: run.status || "succeeded",
        outputs: run.outputs || [],
        ...run.extra,
      },
      { now: run.created_at || fixedNow, idFactory: () => run.id },
    );
    if (run.created_at) doc.created_at = run.created_at;
    if (run.updated_at) doc.updated_at = run.updated_at;
    if (run.started_at) doc.started_at = run.started_at;
    if (run.completed_at) doc.completed_at = run.completed_at;
    doc.status = run.status || "succeeded";
    if (run.error) doc.error = run.error;
    await collections.reportRuns.insertOne(doc);
  }
}

function pdfOutputForList(run_id, overrides = {}) {
  return {
    format: "pdf",
    status: "succeeded",
    size: 123,
    path: null,
    storage_provider: "local",
    storage_key: `report-outputs/org_seed/2026/05/${run_id}.pdf`,
    content_type: "application/pdf",
    filename: `seeded-${run_id}.pdf`,
    checksum: { algorithm: "sha256", value: "a".repeat(64) },
    generated_at: fixedNow,
    expires_at: null,
    created_at: fixedNow,
    updated_at: fixedNow,
    completed_at: fixedNow,
    error: null,
    ...overrides,
  };
}

test("listReportRuns requires organization_id", async () => {
  const store = collections();
  await assert.rejects(
    () => listReportRuns({}, { collections: store }),
    (err) => err.code === "missing_report_scope",
  );
});

test("listReportRuns rejects an unsupported status filter", async () => {
  const store = collections();
  await assert.rejects(
    () => listReportRuns({ organization_id: "org_seed", status: "bogus" }, { collections: store }),
    (err) => err.code === "invalid_report_run_status",
  );
});

test("listReportRuns rejects an inverted date range", async () => {
  const store = collections();
  await assert.rejects(
    () => listReportRuns(
      { organization_id: "org_seed", date_from: "2026-04-30", date_to: "2026-04-01" },
      { collections: store },
    ),
    (err) => err.code === "invalid_date_range",
  );
});

test("listReportRuns rejects a non-positive limit", async () => {
  const store = collections();
  await assert.rejects(
    () => listReportRuns({ organization_id: "org_seed", limit: 0 }, { collections: store }),
    (err) => err.code === "invalid_report_run_limit",
  );
});

test("listReportRuns scopes by organization_id and sorts newest first", async () => {
  const store = collections();
  await seedReportRuns(store, [
    { id: "run_old", organization_id: "org_seed", report_key: "k1", created_at: dateAt("2026-04-01T00:00:00.000Z") },
    { id: "run_new", organization_id: "org_seed", report_key: "k1", created_at: dateAt("2026-04-05T00:00:00.000Z") },
    { id: "run_other_org", organization_id: "org_other", report_key: "k1", created_at: dateAt("2026-04-04T00:00:00.000Z") },
  ]);

  const result = await listReportRuns({ organization_id: "org_seed" }, { collections: store });

  assert.equal(result.runs.length, 2);
  assert.deepEqual(result.runs.map((r) => r.id), ["run_new", "run_old"]);
  assert.equal(result.pagination.limit, REPORT_LIST_DEFAULT_LIMIT);
  assert.equal(result.pagination.has_more, false);
  assert.equal(result.pagination.next_cursor, null);
});

test("listReportRuns filters by status, report_type, report_key, client, location, and date range", async () => {
  const store = collections();
  await seedReportRuns(store, [
    { id: "r1", organization_id: "org_seed", report_key: "k1", client_id: "c1", location_id: "l1", status: "succeeded", created_at: dateAt("2026-04-01T00:00:00.000Z") },
    { id: "r2", organization_id: "org_seed", report_key: "k1", client_id: "c1", location_id: "l1", status: "failed", created_at: dateAt("2026-04-02T00:00:00.000Z") },
    { id: "r3", organization_id: "org_seed", report_key: "k1", client_id: "c2", location_id: "l2", status: "succeeded", created_at: dateAt("2026-04-10T00:00:00.000Z") },
    { id: "r4", organization_id: "org_seed", report_key: "k2", client_id: "c1", location_id: "l1", status: "succeeded", created_at: dateAt("2026-04-12T00:00:00.000Z") },
  ]);

  const byStatus = await listReportRuns(
    { organization_id: "org_seed", status: "succeeded" },
    { collections: store },
  );
  assert.deepEqual(byStatus.runs.map((r) => r.id), ["r4", "r3", "r1"]);

  const byClient = await listReportRuns(
    { organization_id: "org_seed", client_id: "c2" },
    { collections: store },
  );
  assert.deepEqual(byClient.runs.map((r) => r.id), ["r3"]);

  const byLocation = await listReportRuns(
    { organization_id: "org_seed", location_id: "l1" },
    { collections: store },
  );
  assert.deepEqual(byLocation.runs.map((r) => r.id), ["r4", "r2", "r1"]);

  const byKey = await listReportRuns(
    { organization_id: "org_seed", report_key: "k2" },
    { collections: store },
  );
  assert.deepEqual(byKey.runs.map((r) => r.id), ["r4"]);

  const byType = await listReportRuns(
    { organization_id: "org_seed", report_type: "dashboard_snapshot" },
    { collections: store },
  );
  assert.equal(byType.runs.length, 4);

  const byDate = await listReportRuns(
    { organization_id: "org_seed", date_from: "2026-04-02", date_to: "2026-04-10" },
    { collections: store },
  );
  assert.deepEqual(byDate.runs.map((r) => r.id), ["r3", "r2"]);
});

test("listReportRuns clamps limit at REPORT_LIST_MAX_LIMIT and returns has_more correctly", async () => {
  const store = collections();
  const seeds = Array.from({ length: 4 }, (_, idx) => ({
    id: `run_${idx + 1}`,
    organization_id: "org_seed",
    report_key: "k1",
    created_at: dateAt(`2026-04-0${idx + 1}T00:00:00.000Z`),
  }));
  await seedReportRuns(store, seeds);

  const limited = await listReportRuns(
    { organization_id: "org_seed", limit: 2 },
    { collections: store },
  );
  assert.equal(limited.runs.length, 2);
  assert.deepEqual(limited.runs.map((r) => r.id), ["run_4", "run_3"]);
  assert.equal(limited.pagination.limit, 2);
  assert.equal(limited.pagination.has_more, true);
  assert.equal(limited.pagination.next_cursor, null);

  const enormous = await listReportRuns(
    { organization_id: "org_seed", limit: 9999 },
    { collections: store },
  );
  assert.equal(enormous.pagination.limit, REPORT_LIST_MAX_LIMIT);
  assert.equal(enormous.pagination.has_more, false);
});

test("listReportRuns sanitizes rows: no _id, no input_snapshot, no buffer/base64, no absolute path", async () => {
  const store = collections();
  await seedReportRuns(store, [
    {
      id: "run_sanitized",
      organization_id: "org_seed",
      report_key: "k1",
      created_at: fixedNow,
      outputs: [
        pdfOutputForList("run_sanitized"),
      ],
      extra: {
        input_snapshot: { huge: "leaked snapshot" },
      },
    },
  ]);

  store.reportRuns.docs[0]._id = "should-not-leak";

  const result = await listReportRuns(
    { organization_id: "org_seed" },
    { collections: store },
  );

  const [row] = result.runs;
  assert.equal(row.id, "run_sanitized");
  assert.equal(row._id, undefined);
  assert.equal(row.input_snapshot, undefined);
  assert.equal(JSON.stringify(row).includes("leaked snapshot"), false);

  const [output] = row.outputs;
  assert.equal(output.format, "pdf");
  assert.equal(output.path, null);
  assert.equal(output.storage_provider, "local");
  assert.equal(output.checksum.algorithm, "sha256");
  assert.equal(output.buffer, undefined);
  assert.equal(output.base64, undefined);
  assert.equal(/^\/(var|tmp|etc)/.test(output.storage_key), false);
});

test("buildReportRunListQuery rejects an inverted date range and invalid limits", () => {
  assert.throws(
    () => buildReportRunListQuery({
      organization_id: "org_seed",
      date_from: "2026-04-30",
      date_to: "2026-04-01",
    }),
    (err) => err.code === "invalid_date_range",
  );

  assert.throws(
    () => buildReportRunListQuery({ organization_id: "" }),
    (err) => err.code === "missing_report_scope",
  );
});

test("getReportRunById returns null for empty/missing id and drops _id/input_snapshot from the loaded doc", async () => {
  const store = collections();
  await seedReportRuns(store, [
    {
      id: "run_lookup",
      organization_id: "org_seed",
      report_key: "k1",
      created_at: fixedNow,
      outputs: [pdfOutputForList("run_lookup")],
      extra: { input_snapshot: { huge: "leaked snapshot" } },
    },
  ]);
  store.reportRuns.docs[0]._id = "should-not-leak";

  assert.equal(await getReportRunById("", { collections: store }), null);
  assert.equal(await getReportRunById(null, { collections: store }), null);
  assert.equal(await getReportRunById("missing-run", { collections: store }), null);

  const doc = await getReportRunById("run_lookup", { collections: store });
  assert.ok(doc);
  assert.equal(doc.id, "run_lookup");
  assert.equal(doc._id, undefined);
  assert.equal(doc.input_snapshot, undefined);
  assert.equal(doc.outputs[0].format, "pdf");
});

test("findReportRunOutput returns the matching format output or null", () => {
  const run = {
    id: "run_find",
    outputs: [
      { format: "pdf", status: "succeeded" },
      { format: "XLSX", status: "succeeded" },
    ],
  };
  assert.equal(findReportRunOutput(run, "pdf").status, "succeeded");
  assert.equal(findReportRunOutput(run, "PDF").format, "pdf");
  assert.equal(findReportRunOutput(run, "xlsx").format, "XLSX");
  assert.equal(findReportRunOutput(run, ""), null);
  assert.equal(findReportRunOutput(null, "pdf"), null);
  assert.equal(findReportRunOutput({}, "pdf"), null);
  assert.equal(findReportRunOutput({ outputs: [] }, "pdf"), null);
});

test("sanitizeReportRunRow handles missing optional fields without leaking secrets", () => {
  const sanitized = sanitizeReportRunRow({
    id: "run_x",
    organization_id: "org_seed",
    report_key: "k1",
    report_type: "dashboard_snapshot",
    report_name: "n",
    status: "succeeded",
    requested_formats: ["pdf", "bogus"],
    outputs: [
      { format: "pdf", status: "succeeded" },
      { format: "csv", status: "succeeded" }, // ignored in filter; sanitizer still emits given outputs
    ],
    input_snapshot_summary: { card_count: 1 },
    filters: { date_range: { start: "2026-04-01", end: "2026-04-30", days: 30 } },
    _id: "should-not-leak",
    input_snapshot: { huge: "leaked snapshot" },
  });

  assert.equal(sanitized._id, undefined);
  assert.equal(sanitized.input_snapshot, undefined);
  assert.deepEqual(sanitized.requested_formats, ["pdf"]);
  assert.equal(sanitized.outputs[0].format, "pdf");
  assert.equal(JSON.stringify(sanitized).includes("leaked snapshot"), false);
});
