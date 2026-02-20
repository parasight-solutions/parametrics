// apps/web/src/apiClient.js
const API_BASE = "/api/v1";
const TOKEN_KEY = "token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function redirectToLogin() {
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

function triggerGoogleReauth(err) {
  // Avoid infinite loops (especially if integrations page calls APIs that also fail)
  const onIntegrations = window.location.pathname.startsWith("/integrations");

  const message =
    err?.message ||
    "Google connection expired/revoked. Please reconnect Google.";

  // Persist context so Integrations page can show a banner/CTA (optional UI enhancement later)
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
  } catch {}

  // Alert only once per browser session (consistent with your 401 flow)
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

  return false;
}

export async function api(path, { method = "GET", body, auth = true, signal } = {}) {
  const headers = { "Content-Type": "application/json" };

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
    signal, // ✅ allows aborts (race-free refresh/location switch)
  });

  if (res.status === 401) {
    clearToken();
    if (!sessionStorage.getItem("auth_expired_alerted")) {
      sessionStorage.setItem("auth_expired_alerted", "1");
      window.alert("Session expired. Please log in again.");
    }
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const parsed = await res.json().catch(() => ({}));
    const err = parsed?.error || parsed || { code: "http_error", status: res.status };

    if (isGoogleReauthError(err)) {
      triggerGoogleReauth(err);
      throw err;
    }

    throw err;
  }

  return res.json().catch(() => ({}));
}

// Back-compat for your Dashboard.jsx usage
export const apiFetch = api;
