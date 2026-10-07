import { describe, expect, it } from "vitest";
import {
  MEMBER_CANDIDATE_LIMIT_DEFAULT,
  MEMBER_CANDIDATE_LIMIT_MAX,
  MEMBER_CREATE_STATUSES,
  MEMBER_ROLES,
  MEMBER_STATUSES_ALL,
  ROLES_WITH_ASSIGNMENTS,
  buildCandidateQuery,
  buildCreateMemberPayload,
  buildDisableConfirmMessage,
  buildMemberAddedMessage,
  canSubmitMemberCreate,
  clampCandidateLimit,
  decodeJwtUserId,
  describeRole,
  isCurrentUserMember,
  memberScopeSummary,
  resolveCurrentUserId,
  clearSelectedCandidate,
  describeBackendError,
  editCandidateQuery,
  editManualUserId,
  initialAddSelection,
  memberConfirmName,
  memberDisplayLabel,
  resolveCreateTargetUserId,
  selectCandidateForAdd,
  toggleManualUserIdMode,
  formatAssignmentIds,
  formatDate,
  maskEmail,
  normalizeCandidateRow,
  normalizeMemberRow,
  parseAssignmentIdsInput,
  roleSupportsAssignments,
} from "./memberManagement";

const CANDIDATE = Object.freeze({
  user_id: "user_real_1",
  display_name: "Mahesh Real",
  email_masked: "m***@company.com",
  already_member: false,
  membership_role: "",
});

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

describe("clampCandidateLimit", () => {
  it("defaults and clamps to the supported range", () => {
    expect(clampCandidateLimit(undefined)).toBe(MEMBER_CANDIDATE_LIMIT_DEFAULT);
    expect(clampCandidateLimit("")).toBe(MEMBER_CANDIDATE_LIMIT_DEFAULT);
    expect(clampCandidateLimit(0)).toBe(MEMBER_CANDIDATE_LIMIT_DEFAULT);
    expect(clampCandidateLimit(-5)).toBe(MEMBER_CANDIDATE_LIMIT_DEFAULT);
    expect(clampCandidateLimit(5)).toBe(5);
    expect(clampCandidateLimit(999)).toBe(MEMBER_CANDIDATE_LIMIT_MAX);
  });
});

describe("buildCandidateQuery", () => {
  it("includes a trimmed search term and a clamped limit", () => {
    const qs = buildCandidateQuery("  jane  ", 5);
    const params = new URLSearchParams(qs);
    expect(params.get("search")).toBe("jane");
    expect(params.get("limit")).toBe("5");
  });

  it("omits the search param when empty and still clamps the limit", () => {
    const qs = buildCandidateQuery("", 999);
    const params = new URLSearchParams(qs);
    expect(params.get("search")).toBeNull();
    expect(params.get("limit")).toBe(String(MEMBER_CANDIDATE_LIMIT_MAX));
  });
});

describe("maskEmail (frontend fallback)", () => {
  it("masks the local part and never leaks the raw email", () => {
    const masked = maskEmail("john@company.com");
    expect(masked).toBe("j***@company.com");
    expect(masked).not.toContain("john");
  });

  it("returns an empty string for missing or malformed emails", () => {
    expect(maskEmail("")).toBe("");
    expect(maskEmail(null)).toBe("");
    expect(maskEmail("not-an-email")).toBe("");
    expect(maskEmail("@nolocal.com")).toBe("");
    expect(maskEmail("nodomain@")).toBe("");
  });
});

describe("normalizeCandidateRow", () => {
  it("normalizes a backend candidate row and keeps masked email only", () => {
    const row = normalizeCandidateRow({
      user_id: "user_123456789",
      display_name: "Jane Doe",
      email_masked: "j***@company.com",
      already_member: true,
      membership_role: "Manager",
    });
    expect(row).toEqual({
      user_id: "user_123456789",
      display_name: "Jane Doe",
      email_masked: "j***@company.com",
      already_member: true,
      membership_role: "manager",
    });
  });

  it("falls back to a short user id label when display_name is missing", () => {
    const row = normalizeCandidateRow({ user_id: "abcdefgh1234" });
    expect(row.display_name).toBe("User abcdefgh");
    expect(row.email_masked).toBe("");
    expect(row.already_member).toBe(false);
    expect(row.membership_role).toBe("");
  });

  it("never surfaces a raw email even if one is mistakenly present", () => {
    const row = normalizeCandidateRow({
      user_id: "u1",
      display_name: "Person",
      email: "raw@secret.com",
      email_masked: "r***@secret.com",
    });
    expect(JSON.stringify(row)).not.toContain("raw@secret.com");
    expect(Object.prototype.hasOwnProperty.call(row, "email")).toBe(false);
  });
});

describe("normalizeMemberRow", () => {
  it("preserves existing member fields and adds safe display fields from nested user", () => {
    const row = normalizeMemberRow({
      id: "member_1",
      user_id: "user_1",
      role: "manager",
      status: "active",
      assigned_client_ids: ["c1"],
      user: { display_name: "Jane Doe", email_masked: "j***@company.com" },
    });
    expect(row.id).toBe("member_1");
    expect(row.user_id).toBe("user_1");
    expect(row.role).toBe("manager");
    expect(row.assigned_client_ids).toEqual(["c1"]);
    expect(row.display_name).toBe("Jane Doe");
    expect(row.email_masked).toBe("j***@company.com");
  });

  it("works when the nested user object is absent", () => {
    const row = normalizeMemberRow({ id: "member_2", user_id: "user_2", role: "viewer" });
    expect(row.display_name).toBe("");
    expect(row.email_masked).toBe("");
    expect(row.user_id).toBe("user_2");
  });
});

describe("add-member selection (S2-31-fix)", () => {
  const ctx = { orgId: "org_1", busy: false };

  it("typed search text never becomes the target user_id", () => {
    const sel = editCandidateQuery(initialAddSelection, "mahesh");
    expect(resolveCreateTargetUserId(sel)).toBe("");
    expect(canSubmitMemberCreate(sel, ctx)).toBe(false);
    expect(buildCreateMemberPayload(sel, { role: "viewer", status: "active" })).toBeNull();
  });

  it("requires a selected candidate by default", () => {
    expect(canSubmitMemberCreate(initialAddSelection, ctx)).toBe(false);
    const sel = selectCandidateForAdd(editCandidateQuery(initialAddSelection, "mahesh"), CANDIDATE);
    expect(resolveCreateTargetUserId(sel)).toBe("user_real_1");
    expect(canSubmitMemberCreate(sel, ctx)).toBe(true);
  });

  it("editing the search box after selecting clears the selected candidate", () => {
    const selected = selectCandidateForAdd(initialAddSelection, CANDIDATE);
    const edited = editCandidateQuery(selected, "mahesh2");
    expect(edited.selectedCandidate).toBeNull();
    expect(edited.query).toBe("mahesh2");
    expect(canSubmitMemberCreate(edited, ctx)).toBe(false);
  });

  it("clearSelectedCandidate disables submit again", () => {
    const sel = clearSelectedCandidate(selectCandidateForAdd(initialAddSelection, CANDIDATE));
    expect(canSubmitMemberCreate(sel, ctx)).toBe(false);
  });

  it("does not allow adding a candidate that is already a member", () => {
    const sel = selectCandidateForAdd(initialAddSelection, { ...CANDIDATE, already_member: true });
    expect(canSubmitMemberCreate(sel, ctx)).toBe(false);
  });

  it("ignores candidates without a user_id", () => {
    expect(selectCandidateForAdd(initialAddSelection, { display_name: "x" })).toBe(initialAddSelection);
  });

  it("manual user_id requires explicit advanced mode and a non-empty value", () => {
    const manual = toggleManualUserIdMode(selectCandidateForAdd(initialAddSelection, CANDIDATE));
    expect(manual.manualMode).toBe(true);
    expect(manual.selectedCandidate).toBeNull();
    expect(canSubmitMemberCreate(manual, ctx)).toBe(false);
    expect(canSubmitMemberCreate(editManualUserId(manual, "   "), ctx)).toBe(false);
    const filled = editManualUserId(manual, "  exact_user_id ");
    expect(resolveCreateTargetUserId(filled)).toBe("exact_user_id");
    expect(canSubmitMemberCreate(filled, ctx)).toBe(true);
    const off = toggleManualUserIdMode(filled);
    expect(off.manualMode).toBe(false);
    expect(off.manualUserId).toBe("");
    expect(canSubmitMemberCreate(off, ctx)).toBe(false);
  });

  it("blocks submit without an org or while busy", () => {
    const sel = selectCandidateForAdd(initialAddSelection, CANDIDATE);
    expect(canSubmitMemberCreate(sel, { orgId: "", busy: false })).toBe(false);
    expect(canSubmitMemberCreate(sel, { orgId: "org_1", busy: true })).toBe(false);
    expect(canSubmitMemberCreate(null, ctx)).toBe(false);
  });
});

describe("buildCreateMemberPayload", () => {
  const sel = selectCandidateForAdd(initialAddSelection, CANDIDATE);
  const form = {
    status: "active",
    assigned_client_ids_csv: "c1, c2",
    assigned_location_ids_csv: "l1",
  };

  it("sends assignments only for manager/viewer", () => {
    for (const role of ["manager", "viewer"]) {
      expect(buildCreateMemberPayload(sel, { ...form, role })).toEqual({
        user_id: "user_real_1",
        role,
        status: "active",
        assigned_client_ids: ["c1", "c2"],
        assigned_location_ids: ["l1"],
      });
    }
    for (const role of ["owner", "admin", "member"]) {
      const body = buildCreateMemberPayload(sel, { ...form, role });
      expect(body).toEqual({ user_id: "user_real_1", role, status: "active" });
      expect(roleSupportsAssignments(role)).toBe(false);
    }
  });

  it("never includes display fields or emails in the payload", () => {
    const body = buildCreateMemberPayload(sel, { ...form, role: "viewer" });
    expect(JSON.stringify(body)).not.toContain("company.com");
    expect(JSON.stringify(body)).not.toContain("Mahesh Real");
  });
});

describe("member display + disable confirmation", () => {
  it("uses display_name as the primary label and never the raw user id", () => {
    expect(memberDisplayLabel({ display_name: "Jane Doe", user_id: "u1" })).toBe("Jane Doe");
    expect(memberDisplayLabel({ user_id: "u1" })).toBe("Unnamed user");
    expect(memberDisplayLabel(null)).toBe("Unnamed user");
  });

  it("disable confirmation uses the exact required wording", () => {
    expect(buildDisableConfirmMessage({ display_name: "Jane Doe", user_id: "user_9" })).toBe(
      "Disable membership for Jane Doe? This does not delete the user.",
    );
  });

  it("disable confirmation falls back to the user id when there is no display name", () => {
    expect(buildDisableConfirmMessage({ user_id: "user_9" })).toBe(
      "Disable membership for user_9? This does not delete the user.",
    );
    expect(memberConfirmName({})).toBe("this member");
  });

  it("member added message names the member and role", () => {
    expect(buildMemberAddedMessage({ name: "Jane Doe", role: "manager" })).toBe(
      "Jane Doe was added as manager.",
    );
    expect(buildMemberAddedMessage({})).toBe("Member was added.");
  });

  it("disable confirmation does not leak a raw email", () => {
    const row = normalizeMemberRow({
      id: "m1",
      user_id: "u1",
      user: { display_name: "Jane", email_masked: "j***@company.com" },
    });
    const msg = buildDisableConfirmMessage(row);
    expect(msg).not.toContain("@");
  });
});

describe("role descriptions (S2-31.2)", () => {
  it("describes every role and nothing else", () => {
    for (const role of MEMBER_ROLES) expect(describeRole(role).length).toBeGreaterThan(10);
    expect(describeRole("Manager")).toBe(describeRole("manager"));
    expect(describeRole("superuser")).toBe("");
    expect(describeRole(undefined)).toBe("");
  });

  it("mentions optional scope only for manager and viewer", () => {
    for (const role of MEMBER_ROLES) {
      expect(describeRole(role).includes("clients or locations")).toBe(roleSupportsAssignments(role));
    }
  });
});

describe("memberScopeSummary", () => {
  it("is empty for roles without assignments", () => {
    for (const role of ["owner", "admin", "member"]) {
      expect(memberScopeSummary({ role, assigned_client_ids: ["c1"] })).toBe("");
    }
  });

  it("summarizes manager/viewer scope without listing raw ids", () => {
    expect(memberScopeSummary({ role: "viewer" })).toBe("No client/location limits set");
    expect(memberScopeSummary({ role: "manager", assigned_client_ids: ["c1"], assigned_location_ids: ["l1", "l2"] }))
      .toBe("Limited to 1 client and 2 locations");
    expect(memberScopeSummary({ role: "viewer", assigned_location_ids: ["l1"] })).toBe("Limited to 1 location");
    expect(memberScopeSummary({ role: "manager", assigned_client_ids: ["secret_c1"] })).not.toContain("secret_c1");
  });
});

describe("current user resolution (UI hint only)", () => {
  const encode = (obj) => btoa(JSON.stringify(obj)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const token = `${encode({ alg: "HS256" })}.${encode({ user_id: "u_owner", role: "individual" })}.sig`;

  it("reads user_id from a JWT payload without verifying it", () => {
    expect(decodeJwtUserId(token)).toBe("u_owner");
    expect(decodeJwtUserId("not-a-jwt")).toBe("");
    expect(decodeJwtUserId("")).toBe("");
    expect(decodeJwtUserId("a.%%%.c")).toBe("");
  });

  it("prefers the stored login user id, then the token", () => {
    expect(resolveCurrentUserId({ storedUser: { id: "u_stored" }, token })).toBe("u_stored");
    expect(resolveCurrentUserId({ storedUser: null, token })).toBe("u_owner");
    expect(resolveCurrentUserId({})).toBe("");
  });

  it("matches a member row to the current user", () => {
    expect(isCurrentUserMember({ user_id: "u_owner" }, "u_owner")).toBe(true);
    expect(isCurrentUserMember({ user_id: "u_other" }, "u_owner")).toBe(false);
    expect(isCurrentUserMember({ user_id: "" }, "")).toBe(false);
  });
});
