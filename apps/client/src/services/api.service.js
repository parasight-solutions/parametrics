import axios from "axios";

import { getToken } from "../session";
import { AUTH_EXPIRED_EVENT, isApplicationAuthFailure } from "./authFailure";

const BASE_URL = import.meta.env.VITE_APP_BASE_URL;

const api = axios.create({
  baseURL: BASE_URL,
  // timeout: 10000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

api.interceptors.request.use(
  (config) => {
    const token = getToken();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (isApplicationAuthFailure(error)) {
      globalThis.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }

    return Promise.reject(error);
  },
);

export default api;
