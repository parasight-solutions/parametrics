import axios from "axios";

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

const NETWORK_ERROR = Object.freeze({
  statusCode: 0,
  success: false,
  message: "Unable to reach the server",
  errors: [{ code: "network_error", message: "Unable to reach the server" }],
});

const isBinaryRequest = (response) =>
  response?.config?.responseType === "blob" ||
  response?.config?.responseType === "arraybuffer";

const isCancellation = (error) =>
  axios.isCancel(error) ||
  error?.name === "CanceledError" ||
  error?.code === "ERR_CANCELED";

const dispatchAuthExpired = () =>
  globalThis.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));

const handleResponse = (response) =>
  isBinaryRequest(response) ? response : response.data;

const parseBinaryErrorEnvelope = async (error) => {
  if (!isBinaryRequest({ config: error?.config })) return error;

  const contentType = String(
    error.response?.headers?.["content-type"] ??
      error.response?.headers?.get?.("content-type") ??
      "",
  );

  if (!contentType.includes("json")) return error;

  try {
    const source = error.response.data;
    const text =
      source instanceof Blob
        ? await source.text()
        : new TextDecoder().decode(source);

    return {
      ...error,
      response: { ...error.response, data: JSON.parse(text) },
    };
  } catch {
    return error;
  }
};

const handleResponseError = async (
  originalError,
  dispatch = dispatchAuthExpired,
) => {
  if (isCancellation(originalError)) throw originalError;

  const error = await parseBinaryErrorEnvelope(originalError);
  if (isApplicationAuthFailure(error)) dispatch();
  if (error?.response) throw error.response.data;

  throw NETWORK_ERROR;
};

api.interceptors.response.use(handleResponse, handleResponseError);

export { handleResponse, handleResponseError };
export default api;
