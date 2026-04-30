import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboardSnapshotReportRun, markOutputSucceeded } from "./reportService.js";
import {
  buildReportDefinitionDoc,
  buildReportRunDoc,
  createReportDefinition,
  markReportRunFailed,
  markReportRunRunning,
  markReportRunSucceeded,
  savePendingReportRun,
} from "./reportStore.js";

const fixedNow = new Date("2026-05-01T12:00:00.000Z");
const later = new Date("2026-05-01T12:30:00.000Z");

class MemoryCollection {
  constructor() {
    this.docs = [];
  }

  async insertOne(doc) {
    this.docs.push(structuredClone(doc));
    return { acknowledged: true, insertedId: doc.id };
  }

  async findOne(filter) {
    const doc = this.docs.find((item) => Object.entries(filter).every(([key, value]) => item[key] === value));
    return doc ? structuredClone(doc) : null;
  }

  async updateOne(filter, update) {
    const idx = this.docs.findIndex((item) => Object.entries(filter).every(([key, value]) => item[key] === value));
    if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
    this.docs[idx] = { ...this.docs[idx], ...(update.$set || {}) };
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async findOneAndUpdate(filter, update) {
    await this.updateOne(filter, update);
    return { value: await this.findOne(filter) };
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
