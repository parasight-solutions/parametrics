// apps/web/src/apiClient.js
import { clearActiveLocationId } from "./session";

export const AUTH_EXPIRED_EVENT = "pm:auth-expired";

const API_BASE = `${(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "")}/api/v1`;

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
      }),
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
  return (payload?.errors || []).some((providerError) => {
    const code = providerError?.code;
    const details = providerError?.details;
    if (code === "reauth_required") return true;
    if (details?.provider === "google" && details?.reason) return true;
    return false;
  });
}

function isRealAppAuthFailure(status, payload) {
  if (status !== 401) return false;

  const code = String(payload?.errors?.[0]?.code || "").toLowerCase();

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
  const text = await res.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isApiEnvelope(payload) {
  return (
    payload &&
    typeof payload === "object" &&
    typeof payload.success === "boolean" &&
    Number.isInteger(payload.statusCode) &&
    typeof payload.message === "string" &&
    (payload.success
      ? Object.hasOwn(payload, "data")
      : Array.isArray(payload.errors))
  );
}

function createClientError(statusCode, code, message) {
  return {
    success: false,
    statusCode,
    message,
    errors: [{ code, message }],
  };
}

function skipsAuthExpiry(path) {
  const pathname = String(path || "").split("?")[0];
  return pathname === "/auth/login" || pathname === "/auth/session";
}

export async function api(
  path,
  { method = "GET", body, auth = true, signal } = {},
) {
  const headers = {};

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw createClientError(
      0,
      "network_error",
      "Unable to reach the server",
    );
  }

  let parsed;
  try {
    parsed = await parseResponseBody(res);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw createClientError(
      0,
      "network_error",
      "Unable to read the server response",
    );
  }

  if (!res.ok) {
    const err = isApiEnvelope(parsed)
      ? parsed
      : createClientError(
          res.status,
          "http_error",
          "HTTP " + res.status,
        );

    if (isGoogleReauthError(err)) {
      triggerGoogleReauth(err);
      throw err;
    }

    if (res.status === 404) {
      const locationId = getLocationIdFromPath(path);
      if (locationId) clearActiveLocationId(locationId);
    }

    if (
      auth &&
      !skipsAuthExpiry(path) &&
      isRealAppAuthFailure(res.status, err)
    ) {
      if (!sessionStorage.getItem("auth_expired_alerted")) {
        sessionStorage.setItem("auth_expired_alerted", "1");
        window.alert("Session expired. Please log in again.");
      }
      globalThis.dispatchEvent?.(new Event(AUTH_EXPIRED_EVENT));
      throw err;
    }

    throw err;
  }

  if (res.status === 204) return null;
  if (!isApiEnvelope(parsed)) {
    throw createClientError(
      502,
      "invalid_response",
      "The server returned an invalid response",
    );
  }
  return parsed || {};
}

// Back-compat for older imports
export const apiFetch = api;
