const ACCESS_TOKEN_KEY = "pm_access_token";
const AUTH_USER_KEY = "pm_auth_user";
const GOOGLE_REAUTH_KEY = "pm_google_reauth";
const AUTH_IDENTITY_KEY = "pm_auth_identity";
const ACTIVE_LOCATION_KEY = "pm_active_location_id";

function readJson(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function getAuthIdentity(user) {
  const id = user?.id ?? user?._id ?? user?.userId;
  if (id) return `id:${String(id)}`;

  const email = String(user?.email ?? "")
    .trim()
    .toLowerCase();
  return email ? `email:${email}` : "";
}

export function getToken() {
  return sessionStorage?.getItem(ACCESS_TOKEN_KEY) ?? null;
}

export function getStoredUser() {
  return readJson(sessionStorage, AUTH_USER_KEY);
}

export function saveSession(user, token) {
  const nextIdentity = getAuthIdentity(user);
  const previousIdentity = localStorage?.getItem(AUTH_IDENTITY_KEY) ?? "";

  if (previousIdentity && nextIdentity && previousIdentity !== nextIdentity) {
    localStorage?.removeItem(ACTIVE_LOCATION_KEY);
  }

  sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));

  if (nextIdentity) {
    localStorage.setItem(AUTH_IDENTITY_KEY, nextIdentity);
  }
}

export function clearSession() {
  sessionStorage?.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage?.removeItem(AUTH_USER_KEY);
  sessionStorage?.removeItem(GOOGLE_REAUTH_KEY);
  localStorage?.removeItem(AUTH_IDENTITY_KEY);
  localStorage?.removeItem(ACTIVE_LOCATION_KEY);
}

export function getGoogleReauth() {
  return readJson(sessionStorage, GOOGLE_REAUTH_KEY);
}

export function setGoogleReauth(value) {
  if (value) {
    sessionStorage.setItem(GOOGLE_REAUTH_KEY, JSON.stringify(value));
  } else {
    sessionStorage?.removeItem(GOOGLE_REAUTH_KEY);
  }
}

export function getActiveLocationId() {
  return localStorage?.getItem(ACTIVE_LOCATION_KEY) ?? "";
}

export function setActiveLocationId(locationId) {
  const value = String(locationId ?? "");

  if (value) {
    localStorage.setItem(ACTIVE_LOCATION_KEY, value);
  } else {
    localStorage?.removeItem(ACTIVE_LOCATION_KEY);
  }
}

// Reads exp without checking the signature (the backend does that), only so that an expired token
// is not restored as a logged-in session.
export function isTokenExpired(token, now = Date.now()) {
  try {
    const encoded = token.split(".")[1];
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const { exp } = JSON.parse(atob(padded));
    return typeof exp !== "number" || exp * 1000 <= now;
  } catch {
    return true;
  }
}
