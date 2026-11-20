import api from "./api.service";

export function buildCreatePostFormData(body) {
  const form = new FormData();
  const file = body?.imageFile;

  for (const [key, value] of Object.entries(body || {})) {
    if (key === "imageFile" || key === "imageUrl" || value == null) continue;
    form.append(key, String(value));
  }

  if (file) {
    form.append("imageFile", file);
  } else if (body?.imageUrl) {
    form.append("imageUrl", String(body.imageUrl));
  }

  return form;
}

export const postsEndpoints = {
  getPosts: (params) => api.get("/posts", { params }),

  getPost: (postId) => api.get(`/posts/${postId}`),

  syncPosts: ({ locationId }) => api.post("/posts/sync", { locationId }),

  addPost: (body) =>
    api.post(`/posts`, buildCreatePostFormData(body), {
      headers: { "Content-Type": undefined },
    }),

  retryPost: (postId) => api.post(`/posts/${postId}/retry`),

  updatePost: (postId, body) => api.patch(`/posts/${postId}`, body),

  deletePost: (postId) => api.delete(`/posts/${postId}`),
};
