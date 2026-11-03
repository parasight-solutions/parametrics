import api from "./api.service";

export const authEndpoints = {
  login: (body) => api.post("/auth/login", body),

  session: () => api.get("/auth/session"),

  logout: () => api.post("/auth/logout"),
};
