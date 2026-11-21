import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "./api.service";
import { postSyncSettingsEndpoints } from "./postSyncSettings.service";

vi.mock("./api.service", () => ({
  default: { get: vi.fn(), patch: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

describe("postSyncSettingsEndpoints", () => {
  it("loads organizations and scoped auto-sync settings", () => {
    postSyncSettingsEndpoints.getOrganizations();
    expect(api.get).toHaveBeenCalledWith("/orgs");
    postSyncSettingsEndpoints.getSettings({ organizationId: "org-1", integrationId: "int-1" });
    expect(api.get).toHaveBeenCalledWith("/post-sync-settings", {
      params: { organizationId: "org-1", integrationId: "int-1" },
    });
  });

  it("updates only enabled for an individual location", () => {
    postSyncSettingsEndpoints.updateLocation("loc-1", true);
    expect(api.patch).toHaveBeenCalledWith("/post-sync-settings/locations/loc-1", { enabled: true });
  });

  it("bulk update sends scope selectors without location ids or master flag", () => {
    postSyncSettingsEndpoints.updateScope({ organizationId: "org-1", integrationId: "int-1", enabled: false });
    expect(api.patch).toHaveBeenCalledWith("/post-sync-settings", {
      organizationId: "org-1",
      integrationId: "int-1",
      enabled: false,
    });
  });
});
