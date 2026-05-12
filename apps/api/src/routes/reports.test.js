import test from "node:test";
import assert from "node:assert/strict";

import {
  assertDashboardSnapshotLocationScope,
  generateDashboardSnapshotReport,
  listReportRunsForUser,
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

function memoryStorage(options = {}) {
  const writes = [];
  return {
    writes,
    provider: "local",
    root: "/memory",
    async writeOutput({ organization_id, run_id, format, content_type, filename, buffer, now }) {
      if (options.failOn && options.failOn(format)) {
        const err = new Error(options.errorMessage || "memory storage failed");
        err.code = options.errorCode || "report_storage_failed";
        throw err;
      }
      const meta = {
        storage_provider: "local",
        storage_key: `report-outputs/${organization_id}/2026/05/${run_id}.${format}`,
        content_type,
        filename,
        size: buffer.length,
        checksum: { algorithm: "sha256", value: `sha256:${run_id}:${format}` },
        generated_at: now || new Date(),
        expires_at: null,
      };
      writes.push({ run_id, format, organization_id, size: buffer.length });
      return meta;
    },
    async readOutput() {
      throw new Error("not implemented in memory storage");
    },
    async statOutput() {
      return { exists: true, size: 1 };
    },
    async deleteOutput() {
      return { deleted: true };
    },
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
  return async ({ organizationId, userId, allowedRoles, clientId = null, locationId = null }) => {
    assert.equal(organizationId, "org_1");
    assert.equal(userId, "user_1");
    assert.equal(allowedRoles.includes(role), true);
    return {
      organization_id: organizationId,
      client_id: clientId,
      location_id: locationId,
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
      deps: { requireOwnedLocation: async () => ownedLocation(), reportStorage: null },
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
      deps: { requireOrganizationRole: allowMembership("owner"), reportStorage: null },
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
  const storage = memoryStorage();
  const result = await generateDashboardSnapshotReport({
    body: sampleBody(),
    user: { user_id: "user_1" },
    deps: {
      requireOrganizationLocationAccess: allowMembership("owner"),
      requireOwnedLocation: async () => ownedLocation(),
      reportStorage: storage,
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

test("generateDashboardSnapshotReport persists durable storage metadata on each succeeded output", async () => {
  const collections = store();
  const storage = memoryStorage();
  const result = await generateDashboardSnapshotReport({
    body: sampleBody(),
    user: { user_id: "user_1" },
    deps: {
      requireOrganizationLocationAccess: allowMembership("owner"),
      requireOwnedLocation: async () => ownedLocation(),
      reportStorage: storage,
    },
    storeOptions: { collections },
    buildRunOptions: { idFactory: () => "run_storage_1" },
    now: fixedNow,
  });

  assert.equal(result.report_run.id, "run_storage_1");
  assert.equal(result.report_run.status, "succeeded");
  assert.equal(storage.writes.length, 2);
  assert.deepEqual(storage.writes.map((w) => w.format), ["pdf", "xlsx"]);
  assert.equal(storage.writes[0].organization_id, "org_1");
  assert.equal(storage.writes[0].run_id, "run_storage_1");

  const storedRun = collections.reportRuns.docs[0];
  for (const output of storedRun.outputs) {
    assert.equal(output.storage_provider, "local");
    assert.match(output.storage_key, /^report-outputs\/org_1\/2026\/05\/run_storage_1\.(pdf|xlsx)$/);
    assert.equal(output.path, null);
    assert.equal(typeof output.content_type, "string");
    assert.match(output.filename, /^[A-Za-z0-9._-]+$/);
    assert.equal(output.checksum.algorithm, "sha256");
    assert.equal(typeof output.checksum.value, "string");
    assert.ok(output.generated_at);
    assert.equal(output.expires_at, null);
    assert.equal(output.error, null);
  }

  const pdfOutput = storedRun.outputs.find((o) => o.format === "pdf");
  const xlsxOutput = storedRun.outputs.find((o) => o.format === "xlsx");
  assert.equal(pdfOutput.content_type, "application/pdf");
  assert.equal(
    xlsxOutput.content_type,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.equal(pdfOutput.storage_key.endsWith(".pdf"), true);
  assert.equal(xlsxOutput.storage_key.endsWith(".xlsx"), true);

  assert.deepEqual(result.files.map((file) => file.format), ["pdf", "xlsx"]);
  for (const file of result.files) {
    assert.equal(typeof file.base64, "string");
    assert.ok(file.base64.length > 0);
    assert.equal(typeof file.size, "number");
  }
});

test("generateDashboardSnapshotReport marks run failed when storage write fails", async () => {
  const collections = store();
  const storage = memoryStorage({
    failOn: (format) => format === "xlsx",
    errorCode: "report_storage_failed",
    errorMessage: "xlsx storage failed",
  });

  await assert.rejects(
    () => generateDashboardSnapshotReport({
      body: sampleBody(),
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationLocationAccess: allowMembership("owner"),
        requireOwnedLocation: async () => ownedLocation(),
        reportStorage: storage,
      },
      storeOptions: { collections },
      buildRunOptions: { idFactory: () => "run_storage_fail_1" },
      now: fixedNow,
    }),
    (err) => err.status === 500 && err.code === "report_generation_failed"
  );

  const storedRun = collections.reportRuns.docs[0];
  assert.equal(storedRun.status, "failed");
  const pdfOutput = storedRun.outputs.find((o) => o.format === "pdf");
  const xlsxOutput = storedRun.outputs.find((o) => o.format === "xlsx");
  assert.equal(pdfOutput.status, "succeeded");
  assert.equal(pdfOutput.storage_provider, "local");
  assert.equal(pdfOutput.storage_key.startsWith("report-outputs/org_1/"), true);
  assert.equal(xlsxOutput.status, "failed");
  assert.equal(xlsxOutput.error.code, "report_storage_failed");
});

test("generateDashboardSnapshotReport denies missing organization membership before persistence", async () => {
  const collections = store();

  await assert.rejects(
    () => generateDashboardSnapshotReport({
      body: sampleBody(),
      user: { user_id: "user_1" },
      deps: {
        requireOwnedLocation: async () => ownedLocation(),
        requireOrganizationLocationAccess: denyMembership(),
        reportStorage: null,
      },
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
        deps: {
          requireOwnedLocation: async () => ownedLocation(),
          requireOrganizationLocationAccess: denyMembership("organization_role_required"),
          reportStorage: null,
        },
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
        requireOrganizationLocationAccess: allowMembership(role),
        requireOwnedLocation: async () => ownedLocation(),
        reportStorage: memoryStorage(),
      },
      storeOptions: { collections },
      buildRunOptions: { idFactory: () => `run_${role}` },
      now: fixedNow,
    });

    assert.equal(result.report_run.status, "succeeded");
    assert.deepEqual(result.files.map((file) => file.format), ["pdf"]);
    assert.equal(collections.reportRuns.docs[0].status, "succeeded");
    assert.equal(collections.reportRuns.docs[0].outputs[0].storage_provider, "local");
  }
});

test("generateDashboardSnapshotReport still rejects canonical location scope mismatch", async () => {
  await assert.rejects(
    () => generateDashboardSnapshotReport({
      body: sampleBody({ organization_id: "org_other" }),
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationLocationAccess: async ({ organizationId, clientId, locationId, allowedRoles }) => {
          assert.equal(organizationId, "org_1");
          assert.equal(clientId, "client_1");
          assert.equal(locationId, "loc_1");
          assert.equal(allowedRoles.includes("owner"), true);
          return { role: "owner", status: "active" };
        },
        requireOwnedLocation: async () => ownedLocation(),
        reportStorage: null,
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
        requireOrganizationLocationAccess: allowMembership("owner"),
        requireOwnedLocation: async () => ownedLocation(),
        reportStorage: memoryStorage(),
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

test("generateDashboardSnapshotReport denies manager for non-location org-level report", async () => {
  await assert.rejects(
    () => generateDashboardSnapshotReport({
      body: sampleBody({ location_id: "", client_id: "", requested_formats: ["pdf"] }),
      user: { user_id: "user_1" },
      deps: {
        reportStorage: null,
        requireOrganizationRole: async ({ organizationId, userId, allowedRoles }) => {
          assert.equal(organizationId, "org_1");
          assert.equal(userId, "user_1");
          assert.deepEqual(allowedRoles, ["owner", "admin"]);
          const err = new Error("required organization role is missing");
          err.status = 403;
          err.statusCode = 403;
          err.code = "organization_role_required";
          throw err;
        },
      },
      storeOptions: { collections: store() },
      now: fixedNow,
    }),
    (err) => err.status === 403 && err.code === "organization_role_required",
  );
});

function listMembership(role, { assigned_client_ids = [], assigned_location_ids = [], status = "active", organization_id = "org_1", user_id = "user_1" } = {}) {
  return {
    organization_id,
    user_id,
    role,
    status,
    assigned_client_ids,
    assigned_location_ids,
  };
}

function denyMembershipForList(code = "organization_membership_required") {
  return async () => {
    const err = new Error(
      code === "organization_role_required"
        ? "required organization role is missing"
        : "active organization membership is required",
    );
    err.status = 403;
    err.statusCode = 403;
    err.code = code;
    throw err;
  };
}

function sampleListResult(rows = []) {
  return {
    runs: rows,
    pagination: { limit: 25, has_more: false, next_cursor: null },
  };
}

function sampleSanitizedRun(overrides = {}) {
  return {
    id: "run_seed_1",
    report_id: null,
    report_key: "gbp_dashboard_april",
    report_type: "dashboard_snapshot",
    report_name: "April GBP Dashboard",
    status: "succeeded",
    requested_formats: ["pdf"],
    outputs: [
      {
        format: "pdf",
        status: "succeeded",
        size: 123,
        path: null,
        storage_provider: "local",
        storage_key: "report-outputs/org_1/2026/05/run_seed_1.pdf",
        content_type: "application/pdf",
        filename: "seed-run_seed_1.pdf",
        checksum: { algorithm: "sha256", value: "a".repeat(64) },
        generated_at: fixedNow,
        expires_at: null,
        error: null,
        created_at: fixedNow,
        updated_at: fixedNow,
        completed_at: fixedNow,
      },
    ],
    input_snapshot_summary: { card_count: 0 },
    filters: {},
    organization_id: "org_1",
    client_id: null,
    location_id: null,
    requested_by_user_id: "user_1",
    created_at: fixedNow,
    updated_at: fixedNow,
    started_at: fixedNow,
    completed_at: fixedNow,
    error: null,
    ...overrides,
  };
}

test("listReportRunsForUser rejects missing organization_id", async () => {
  await assert.rejects(
    () => listReportRunsForUser({
      query: { organization_id: "" },
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationMembership: async () => listMembership("owner"),
        listReportRuns: async () => sampleListResult([]),
      },
    }),
    (err) => err.status === 400 && err.code === "bad_request",
  );
});

test("listReportRunsForUser denies missing membership", async () => {
  let calledList = false;
  await assert.rejects(
    () => listReportRunsForUser({
      query: { organization_id: "org_1" },
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationMembership: denyMembershipForList("organization_membership_required"),
        listReportRuns: async () => { calledList = true; return sampleListResult([]); },
      },
    }),
    (err) => err.status === 403 && err.code === "organization_membership_required",
  );
  assert.equal(calledList, false);
});

test("listReportRunsForUser denies member/invited/disabled and unknown roles", async () => {
  for (const role of ["member", "invited", "disabled"]) {
    await assert.rejects(
      () => listReportRunsForUser({
        query: { organization_id: "org_1" },
        user: { user_id: "user_1" },
        deps: {
          requireOrganizationMembership: async () => listMembership(role, { status: role === "member" ? "active" : role }),
          listReportRuns: async () => sampleListResult([]),
        },
      }),
      (err) => err.status === 403 && err.code === "organization_role_required",
      `role ${role} should be denied`,
    );
  }
});

test("listReportRunsForUser allows owner and admin without scope filter", async () => {
  for (const role of ["owner", "admin"]) {
    const result = await listReportRunsForUser({
      query: { organization_id: "org_1", limit: "10" },
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationMembership: async () => listMembership(role),
        listReportRuns: async (filter) => {
          assert.equal(filter.organization_id, "org_1");
          assert.equal(filter.limit, 10);
          return sampleListResult([sampleSanitizedRun({ id: `run_${role}` })]);
        },
      },
    });
    assert.equal(result.report_runs.length, 1);
    assert.equal(result.report_runs[0].id, `run_${role}`);
    assert.equal(result.pagination.limit, 25);
    assert.equal(result.pagination.has_more, false);
    assert.equal(result.pagination.next_cursor, null);
  }
});

test("listReportRunsForUser allows manager with assigned client/location scope", async () => {
  const result = await listReportRunsForUser({
    query: {
      organization_id: "org_1",
      client_id: "client_1",
      location_id: "loc_1",
    },
    user: { user_id: "user_1" },
    deps: {
      requireOrganizationMembership: async () => listMembership("manager", {
        assigned_client_ids: ["client_1"],
        assigned_location_ids: ["loc_1"],
      }),
      listReportRuns: async (filter) => {
        assert.equal(filter.client_id, "client_1");
        assert.equal(filter.location_id, "loc_1");
        return sampleListResult([sampleSanitizedRun({ client_id: "client_1", location_id: "loc_1" })]);
      },
    },
  });
  assert.equal(result.report_runs.length, 1);
});

test("listReportRunsForUser allows viewer with assigned client/location scope", async () => {
  const result = await listReportRunsForUser({
    query: { organization_id: "org_1", location_id: "loc_1" },
    user: { user_id: "user_1" },
    deps: {
      requireOrganizationMembership: async () => listMembership("viewer", {
        assigned_client_ids: [],
        assigned_location_ids: ["loc_1"],
      }),
      listReportRuns: async (filter) => {
        assert.equal(filter.location_id, "loc_1");
        return sampleListResult([sampleSanitizedRun({ location_id: "loc_1" })]);
      },
    },
  });
  assert.equal(result.report_runs.length, 1);
});

test("listReportRunsForUser denies manager without any scope filter", async () => {
  await assert.rejects(
    () => listReportRunsForUser({
      query: { organization_id: "org_1" },
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationMembership: async () => listMembership("manager", {
          assigned_client_ids: ["client_1"],
          assigned_location_ids: ["loc_1"],
        }),
        listReportRuns: async () => sampleListResult([]),
      },
    }),
    (err) => err.status === 403 && err.code === "organization_scope_required",
  );
});

test("listReportRunsForUser denies manager when supplied scope is outside assignments", async () => {
  await assert.rejects(
    () => listReportRunsForUser({
      query: { organization_id: "org_1", client_id: "client_other" },
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationMembership: async () => listMembership("manager", {
          assigned_client_ids: ["client_1"],
          assigned_location_ids: ["loc_1"],
        }),
        listReportRuns: async () => sampleListResult([]),
      },
    }),
    (err) => err.status === 403 && err.code === "organization_scope_required",
  );
});

test("listReportRunsForUser passes through filter values without mutating role checks", async () => {
  let observed = null;
  await listReportRunsForUser({
    query: {
      organization_id: "org_1",
      status: "succeeded",
      report_type: "dashboard_snapshot",
      report_key: "gbp_dashboard_april",
      date_from: "2026-04-01",
      date_to: "2026-04-30",
      limit: "50",
    },
    user: { user_id: "user_1" },
    deps: {
      requireOrganizationMembership: async () => listMembership("owner"),
      listReportRuns: async (filter) => {
        observed = filter;
        return sampleListResult([]);
      },
    },
  });
  assert.equal(observed.organization_id, "org_1");
  assert.equal(observed.status, "succeeded");
  assert.equal(observed.report_type, "dashboard_snapshot");
  assert.equal(observed.report_key, "gbp_dashboard_april");
  assert.equal(observed.date_from, "2026-04-01");
  assert.equal(observed.date_to, "2026-04-30");
  assert.equal(observed.limit, 50);
});

test("listReportRunsForUser rejects a non-positive limit query value", async () => {
  await assert.rejects(
    () => listReportRunsForUser({
      query: { organization_id: "org_1", limit: "0" },
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationMembership: async () => listMembership("owner"),
        listReportRuns: async () => sampleListResult([]),
      },
    }),
    (err) => err.status === 400 && err.code === "bad_request",
  );
});

test("listReportRunsForUser surfaces invalid filter codes from the store as 400", async () => {
  await assert.rejects(
    () => listReportRunsForUser({
      query: {
        organization_id: "org_1",
        status: "succeeded",
        date_from: "2026-04-30",
        date_to: "2026-04-01",
      },
      user: { user_id: "user_1" },
      deps: {
        requireOrganizationMembership: async () => listMembership("owner"),
        listReportRuns: async () => {
          const err = new Error("date_from must be on or before date_to");
          err.code = "invalid_date_range";
          throw err;
        },
      },
    }),
    (err) => err.status === 400 && err.code === "invalid_date_range",
  );
});

test("listReportRunsForUser response shape matches the documented contract", async () => {
  const result = await listReportRunsForUser({
    query: { organization_id: "org_1" },
    user: { user_id: "user_1" },
    deps: {
      requireOrganizationMembership: async () => listMembership("owner"),
      listReportRuns: async () => sampleListResult([sampleSanitizedRun()]),
    },
  });

  assert.ok(Array.isArray(result.report_runs));
  assert.equal(Object.prototype.hasOwnProperty.call(result, "pagination"), true);
  assert.deepEqual(Object.keys(result.pagination).sort(), ["has_more", "limit", "next_cursor"]);
  const [row] = result.report_runs;
  assert.equal(row._id, undefined);
  assert.equal(row.input_snapshot, undefined);
  assert.equal(row.outputs[0].buffer, undefined);
  assert.equal(row.outputs[0].base64, undefined);
});
