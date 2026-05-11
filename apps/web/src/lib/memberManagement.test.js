import { describe, expect, it } from "vitest";
import {
  MEMBER_CREATE_STATUSES,
  MEMBER_ROLES,
  MEMBER_STATUSES_ALL,
  ROLES_WITH_ASSIGNMENTS,
  describeBackendError,
  formatAssignmentIds,
  formatDate,
  parseAssignmentIdsInput,
  roleSupportsAssignments,
} from "./memberManagement";

describe("memberManagement constants", () => {
  it("exposes canonical role and status options", () => {
    expect(MEMBER_ROLES).toEqual(["owner", "admin", "manager", "member", "viewer"]);
    expect(MEMBER_STATUSES_ALL).toEqual(["active", "invited", "disabled"]);
    expect(MEMBER_CREATE_STATUSES).toEqual(["active", "disabled"]);
    expect(ROLES_WITH_ASSIGNMENTS).toEqual(["manager", "viewer"]);
  });
});

describe("parseAssignmentIdsInput", () => {
  it("returns an empty array for empty input", () => {
    expect(parseAssignmentIdsInput("")).toEqual([]);
    expect(parseAssignmentIdsInput(null)).toEqual([]);
    expect(parseAssignmentIdsInput(undefined)).toEqual([]);
  });

  it("trims, filters empty entries, and deduplicates comma-separated ids", () => {
    expect(parseAssignmentIdsInput("  loc_a, , loc_b ,loc_a")).toEqual(["loc_a", "loc_b"]);
  });

  it("accepts an existing array and normalizes it", () => {
    expect(parseAssignmentIdsInput([" client_a ", "client_a", "", "client_b"])).toEqual([
      "client_a",
      "client_b",
    ]);
  });
});

describe("formatAssignmentIds", () => {
  it("joins ids with ', ' and ignores non-arrays", () => {
    expect(formatAssignmentIds(["a", "b"])).toBe("a, b");
    expect(formatAssignmentIds([])).toBe("");
    expect(formatAssignmentIds(null)).toBe("");
  });
});

describe("roleSupportsAssignments", () => {
  it("returns true for manager and viewer only", () => {
    expect(roleSupportsAssignments("manager")).toBe(true);
    expect(roleSupportsAssignments("viewer")).toBe(true);
    expect(roleSupportsAssignments("owner")).toBe(false);
    expect(roleSupportsAssignments("admin")).toBe(false);
    expect(roleSupportsAssignments("member")).toBe(false);
    expect(roleSupportsAssignments(undefined)).toBe(false);
  });
});

describe("describeBackendError", () => {
  it("formats a sanitized backend error with code and message", () => {
    expect(describeBackendError({ code: "organization_role_required", message: "nope" }))
      .toBe("organization_role_required: nope");
  });

  it("falls back to message when code is missing", () => {
    expect(describeBackendError({ message: "Something broke" })).toBe("Something broke");
  });

  it("falls back to code when message is missing", () => {
    expect(describeBackendError({ code: "bad_request" })).toBe("bad_request");
  });

  it("handles nested error envelopes from the API client", () => {
    expect(describeBackendError({ error: { code: "last_owner_required", message: "x" } }))
      .toBe("last_owner_required: x");
  });

  it("returns a safe default for empty input", () => {
    expect(describeBackendError(null)).toBe("Unknown error.");
    expect(describeBackendError(undefined)).toBe("Unknown error.");
  });
});

describe("formatDate", () => {
  it("returns '-' for empty or invalid input", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate("")).toBe("-");
    expect(formatDate("not-a-date")).toBe("-");
  });

  it("returns a non-empty locale string for a valid ISO date", () => {
    const out = formatDate("2026-05-11T12:00:00Z");
    expect(typeof out).toBe("string");
    expect(out).not.toBe("-");
    expect(out.length).toBeGreaterThan(0);
  });
});
