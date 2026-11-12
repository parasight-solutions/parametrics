import api from "./api.service";

export const postsEndpoints = {
  getPosts: (params) => api.get("/posts", { params }),
};
