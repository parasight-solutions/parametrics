import api from "./api.service";

export const postsEndpoints = {
  getPosts: (params) => api.get("/posts", { params }),

  getPost: (postId) => api.get(`/posts/${postId}`),

  addPost: (body) => api.post(`/posts`, body),

  retryPost: (postId) => api.post(`/posts/${postId}/retry`),

  updatePost: (postId, body) => api.patch(`/posts/${postId}`, body),

  deletePost: (postId) => api.delete(`/posts/${postId}`),
};
