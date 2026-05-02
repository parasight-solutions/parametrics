import test from "node:test";
import assert from "node:assert/strict";

import {
  assertDashboardSnapshotLocationScope,
  generateDashboardSnapshotReport,
} from "./reports.js";

const fixedNow = new Date("2026-05-01T12:00:00.000Z");

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

function store() {
  return {
    reports: new MemoryCollection(),
    reportRuns: new MemoryCollection(),
  };
}

function sampleBody(overrides = {}) {
  return {
    organization_id: "org_1",
    client_id: "client_1",
    location_id: "loc_1",
    report_name: "April GBP Dashboard",
    report_key: "gbp_dashboard_april",
    requested_formats: ["pdf", "xlsx"],
    date_range: { start: "2026-04-01", end: "2026-04-30" },
    dashboard_snapshot: {
      title: "April dashboard",
      provider: "google",
      cards: [
        { title: "Website Clicks", value: 42 },
        { title: "Secret Card", access_token: "must not leak" },
      ],
      metrics: [{ metric: "BUSINESS_IMPRESSIONS_SEARCH", total: 1234 }],
      tables: [{ title: "Totals", rows: [{ metric: "CALL_CLICKS", total: 7 }] }],
      charts: [{ title: "Trend", points: [{ date: "2026-04-01", value: 3 }] }],
    },
    ...overrides,
  };
}

function ownedLocation(overrides = {}) {
  return {
    id: "loc_1",
    user_id: "user_1",
    organization_id: "org_1",
    client_id: "client_1",
    provider: "google",
    ...overrides,
  };
}

function allowMembership(role = "owner") {
  return async ({ organizationId, userId, allowedRoles }) => {
    assert.equal(organizationId, "org_1");
    assert.equal(userId, "user_1");
    assert.equal(allowedRoles.includes(role), true);
    return {
      organization_id: organizationId,
      user_id: userId,
      role,
      status: "active",
    };
  };
}

function denyMembership(code = "organization_membership_required") {
  return async () => {
    const err = new Error(code === "organization_role_required"
      ? "required organization role is missing"
      : "active organization membership is required");
    err.status = 403;
    err.statusCode = 403;
    err.code = code;
    throw err;
  };
}

test("generateDashboardSnapshotReport rejects missing organization_id", async () => {
  await assert.rejects(
    () => generateDashboardSnapshotReport({
      body: sampleBody({ organization_id: "" }),
      user: { user_id: "user_1" },
      deps: { requireOwnedLocation: async () => ownedLocation() },
      storeOptions: { collections: store() },
      now: fixedNow,
    }),
    (err) => err.status === 400 && err.code === "bad_request"
  );
});

test("generateDashboardSnapshotReport rejects unsupported formats through report metadata service", async () => {
  await assert.rejects(
    () => generateDashboardSnapshotReport({
      body: sampleBody({ location_id: "", client_id: "", requested_formats: ["csv"] }),
      user: { user_id: "user_1" },
      deps: { requireOrganizationRole: allowMembership("owner") },
      storeOptions: { collections: store() },
      now: fixedNow,
    }),
    (err) => err.status === 400 && err.code === "invalid_report_formats"
  );
});

test("assertDashboardSnapshotLocationScope rejects canonical scope mismatch", () => {
  assert.throws(
    () => assertDashboardSnapshotLocationScope(
      sampleBody({ organization_id: "org_other" }),
      ownedLocation()
    ),
    (err) => err.status === 409 && err.code === "scope_mismatch"
  );
});

test("generateDashboardSnapshotReport succeeds with PDF/XLSX files and persists metadata only", async () => {
  const collections = store();
  const result = await generateDashboardSnapshotReport({
    body: sampleBody(),
    user: { user_id: "user_1" },
    deps: {
      requireOrganizationRole: allowMembership("owner"),
      requireOwnedLocation: async () => ownedLocation(),
    },
    storeOptions: { collections },
    buildRunOptions: { idFactory: () => "run_route_1" },
    now: fixedNow,
  });

  assert.equal(result.report_run.id, "run_route_1");
  assert.equal(result.report_run.status, "succeeded");
  assert.equal(result.outputs.length, 2);
  assert.deepEqual(result.outputs.map((output) => output.status), ["succeeded", "succeeded"]);
  assert.deepEqual(result.files.map((file) => file.format), ["pdf", "xlsx"]);
  assert.equal(result.files[0].content_type, "application/pdf");
  assert.equal(result.files[0].base64.startsWith("JVBER"), true);
  assert.equal(result.files[1].base64.startsWith("UEs"), true);

  const storedRun = collections.reportRuns.docs[0];
  assert.equal(storedRun.status, "succeeded");
  assert.equal(storedRun.input_snapshot, undefined);
  assert.equal(storedRun.outputs[0].buffer, undefined);
  assert.equal(JSON.stringify(storedRun).includes("must not leak"), false);
});

test("generateDashboardSnapshotReport denies missing organization membership before persistence", async () => {
  const collections = store();

  await assert.rejects(
    () => generateDashboardSnapshotReport({
      body: sampleBody(),
      user: { user_id: "user_1" },
      deps: { requireOrganizationRole: denyMembership() },
      storeOptions: { collections },
      now: fixedNow,
    }),
    (err) => err.status === 403 && err.code === "organization_membership_required"
  );

  assert.equal(collections.reportRuns.docs.length, 0);
});

test("generateDashboardSnapshotReport denies viewer and member roles", async () => {
  for (const role of ["viewer", "member"]) {
    const collections = store();

    await assert.rejects(
      () => generateDashboardSnapshotReport({
        body: sampleBody(),
        user: { user_id: "user_1" },
        deps: { requireOrganizationRole: denyMembership("organization_role_required") },
        storeOptions: { collections },
        now: fixedNow,
      }),
      (err) => err.status === 403 && err.code === "organization_role_required"
    );

    assert.equal(collections.reportRuns.docs.length, 0, role);
  }
});

test("generateDashboardSnapshotReport allows owner admin and manager roles", async () => {
  for (const role of ["owner", "admin", "manager"]) {
    const collections = store();
    const result = await generateDashboardSnapshotReport({
      body: sampleBody({ requested_formats: ["pdf"] }),
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationRole: allowMembership(role),
        requireOwnedLocation: async () => ownedLocation(),
      },
      storeOptions: { collections },
      buildRunOptions: { idFactory: () => `run_${role}` },
      now: fixedNow,
    });

    assert.equal(result.report_run.status, "succeeded");
    assert.deepEqual(result.files.map((file) => file.format), ["pdf"]);
    assert.equal(collections.reportRuns.docs[0].status, "succeeded");
  }
});

test("generateDashboardSnapshotReport still rejects canonical location scope mismatch", async () => {
  await assert.rejects(
    () => generateDashboardSnapshotReport({
      body: sampleBody({ organization_id: "org_other" }),
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationRole: async ({ organizationId, allowedRoles }) => {
          assert.equal(organizationId, "org_other");
          assert.equal(allowedRoles.includes("owner"), true);
          return { role: "owner", status: "active" };
        },
        requireOwnedLocation: async () => ownedLocation(),
      },
      storeOptions: { collections: store() },
      now: fixedNow,
    }),
    (err) => err.status === 409 && err.code === "scope_mismatch"
  );
});

test("generateDashboardSnapshotReport marks run failed when an output fails", async () => {
  const collections = store();

  await assert.rejects(
    () => generateDashboardSnapshotReport({
      body: sampleBody({ requested_formats: ["pdf"] }),
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationRole: allowMembership("owner"),
        requireOwnedLocation: async () => ownedLocation(),
        buildPdfOutputResult: () => ({
          buffer: null,
          output: {
            format: "pdf",
            status: "failed",
            path: null,
            size: null,
            error: { code: "pdf_failed", message: "PDF failed" },
            created_at: fixedNow,
            updated_at: fixedNow,
            completed_at: fixedNow,
          },
        }),
      },
      storeOptions: { collections },
      buildRunOptions: { idFactory: () => "run_failed_1" },
      now: fixedNow,
    }),
    (err) => err.status === 500 && err.code === "report_generation_failed"
  );

  const storedRun = collections.reportRuns.docs[0];
  assert.equal(storedRun.id, "run_failed_1");
  assert.equal(storedRun.status, "failed");
  assert.equal(storedRun.outputs[0].status, "failed");
  assert.deepEqual(storedRun.error, {
    code: "report_generation_failed",
    message: "one or more report outputs failed",
  });
});
