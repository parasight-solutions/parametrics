import api from "./api.service";

export const commonEndpoints = {
  getLocations: () => api.get("/locations"),
};
