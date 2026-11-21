import api from "./api.service";

export const postSyncSettingsEndpoints = {
  getOrganizations: () => api.get("/orgs"),
  getSettings: ({ organizationId, integrationId }) =>
    api.get("/post-sync-settings", {
      params: {
        organizationId,
        ...(integrationId ? { integrationId } : {}),
      },
    }),
  updateLocation: (locationId, enabled) =>
    api.patch(`/post-sync-settings/locations/${locationId}`, { enabled }),
  updateScope: ({ organizationId, integrationId, enabled }) =>
    api.patch("/post-sync-settings", {
      organizationId,
      integrationId: integrationId || null,
      enabled,
    }),
};
