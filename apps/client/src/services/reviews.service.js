import api from "./api.service";

export const reviewsEndpoints = {
  syncReviews: (body) => api.post(`reviews/sync`, body),

  getReviews: (params) => api.get(`reviews`, { params }),

  replyToReview: (reviewId, body) => api.put(`reviews/${reviewId}/reply`, body),
};
