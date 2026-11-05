import api from "./api.service";

export const integrationsEndpoints = {
  getConnectionStatus: () => api.get("/integrations/google/status"),

  getConnections: () => api.get("/integrations/google/connections"),

  getPerformanceSeries: (params) =>
    api.get("/integrations/google/performance-series", { params }),

  activateConnection: (connectionId) =>
    api.post(`/integrations/google/connections/${connectionId}/activate`),

  reconcileLocations: () =>
    api.post(`/integrations/google/locations/reconcile`),
};
