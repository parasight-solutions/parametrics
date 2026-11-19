import api from "./api.service";

export const reviewsEndpoints = {
  syncReviews: (body) => api.post(`reviews/sync`, body),

  getReviews: (params) => api.get(`reviews/sync`, { params }),
};
