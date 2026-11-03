import api from "./api.service";

export const authEndpoints = {
  login: (body) => api.post("/auth/login", body),
};
