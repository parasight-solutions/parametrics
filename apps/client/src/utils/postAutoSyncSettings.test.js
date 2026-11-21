import { describe, expect, it } from "vitest";
import {
  deriveBulkAutoSyncState,
  getPostAutoSyncErrorMessage,
  isCurrentSettingsScope,
  isCurrentSettingsRequest,
} from "./postAutoSyncSettings";

describe("deriveBulkAutoSyncState", () => {
  it("derives checked, mixed, and read-only states from manageable locations", () => {
    expect(deriveBulkAutoSyncState([
      { canManage: true, autoEnabled: true },
      { canManage: true, autoEnabled: true },
    ])).toEqual({ checked: true, indeterminate: false, disabled: false });
    expect(deriveBulkAutoSyncState([
      { canManage: true, autoEnabled: true },
      { canManage: true, autoEnabled: false },
    ])).toEqual({ checked: false, indeterminate: true, disabled: false });
    expect(deriveBulkAutoSyncState([
      { canManage: false, autoEnabled: true },
    ])).toEqual({ checked: false, indeterminate: false, disabled: true });
  });
});

describe("settings response guards", () => {
  it("accepts only the current organization and account scope", () => {
    expect(isCurrentSettingsScope(
      { organizationId: "org-1", integrationId: "int-1" },
      { organizationId: "org-1", integrationId: "int-1" },
    )).toBe(true);
    expect(isCurrentSettingsScope(
      { organizationId: "org-1", integrationId: "int-1" },
      { organizationId: "org-2", integrationId: "int-1" },
    )).toBe(false);
  });

  it("rejects an older request generation even when the scope cycles back", () => {
    expect(isCurrentSettingsRequest(
      { organizationId: "org-1", integrationId: "", generation: 1 },
      { organizationId: "org-1", integrationId: "", generation: 3 },
    )).toBe(false);
  });

  it("prefers meaningful backend errors and has a safe fallback", () => {
    expect(getPostAutoSyncErrorMessage({ response: { data: { error: { message: "Permission denied" } } } })).toBe("Permission denied");
    expect(getPostAutoSyncErrorMessage({})).toBe("Unable to update post auto-sync settings.");
  });
});
