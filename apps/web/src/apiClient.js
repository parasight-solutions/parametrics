// apps/web/src/apiClient.js
import {
  clearActiveLocationId,
  clearAuthSession,
  clearToken as clearStoredToken,
  getToken as getStoredToken,
  setToken as setStoredToken,
} from "./session";

export function getToken() {
  return getStoredToken();
}

export function setToken(token) {
  setStoredToken(token);
}

export function clearToken() {
  clearStoredToken();
}

const API_BASE = `${(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "")}/api/v1`;

function redirectToLogin() {
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

function triggerGoogleReauth(err) {
  const onIntegrations = window.location.pathname.startsWith("/integrations");

  const message =
    err?.message ||
    "Google connection expired/revoked. Please reconnect Google.";

  try {
    sessionStorage.setItem(
      "reauth_required",
      JSON.stringify({
        provider: "google",
        message,
        at: Date.now(),
        from: window.location.pathname + window.location.search,
      })
    );
  } catch {
    // Reauth banners are helpful but should not block request handling.
  }

  if (!sessionStorage.getItem("reauth_required_alerted")) {
    sessionStorage.setItem("reauth_required_alerted", "1");
    window.alert(message);
  }

  if (!onIntegrations) {
    window.location.href = "/integrations?reauth=google";
  }
}

function isGoogleReauthError(payload) {
  const code = payload?.code || payload?.error?.code;
  const details = payload?.details || payload?.error?.details;

  if (code === "reauth_required") return true;
  if (details?.error === "missing_refresh_token") return true;
  if (details?.error === "invalid_grant") return true;

  return false;
}

function isRealAppAuthFailure(status, payload) {
  if (status !== 401) return false;

  const code = String(payload?.code || payload?.error?.code || "").toLowerCase();

  return code === "unauthorized" || code === "invalid";
}

function getLocationIdFromPath(path) {
  try {
    const url = new URL(path, window.location.origin);
    return url.searchParams.get("locationId") || "";
  } catch {
    return "";
  }
}

async function parseResponseBody(res) {
  const text = await res.text().catch(() => "");
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function api(path, { method = "GET", body, auth = true, signal } = {}) {
  const headers = {};

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    const t = getToken();
    if (!t) {
      redirectToLogin();
      throw { code: "unauthorized", message: "JWT missing" };
    }
    headers["Authorization"] = `Bearer ${t}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  const parsed = await parseResponseBody(res);

  if (!res.ok) {
    const err = parsed?.error || parsed || {
      code: "http_error",
      status: res.status,
      message: `HTTP ${res.status}`,
    };

    if (typeof err.status !== "number") {
      err.status = res.status;
    }

    if (isGoogleReauthError(err)) {
      triggerGoogleReauth(err);
      throw err;
    }

    if (res.status === 404) {
      const locationId = getLocationIdFromPath(path);
      if (locationId) clearActiveLocationId(locationId);
    }

    if (auth && isRealAppAuthFailure(res.status, err)) {
      clearAuthSession();

      if (!sessionStorage.getItem("auth_expired_alerted")) {
        sessionStorage.setItem("auth_expired_alerted", "1");
        window.alert("Session expired. Please log in again.");
      }

      redirectToLogin();
      throw err;
    }

    throw err;
  }

  return parsed || {};
}

// Back-compat for older imports
export const apiFetch = api;
