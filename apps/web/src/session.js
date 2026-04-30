const TOKEN_KEY = "token";
const AUTH_USER_KEY = "pm_auth_user";
const AUTH_IDENTITY_KEY = "pm_auth_identity";
export const ACTIVE_LOCATION_KEY = "active_location_id";

const LOCAL_EXACT_UI_KEYS = [
  ACTIVE_LOCATION_KEY,
  "gbp.accounts.cache",
];

const SESSION_EXACT_UI_KEYS = [
  "reauth_required",
  "reauth_required_alerted",
  "reauth_required_dismissed",
  "auth_expired_alerted",
];

const LOCAL_UI_PREFIXES = [];

const SESSION_UI_PREFIXES = [
  "cache:v1:",
  "dashRange:v1:",
];

function safeStorage(storage) {
  try {
    const testKey = "__pm_storage_test__";
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return storage;
  } catch {
    return null;
  }
}

function removeMatching(storage, exactKeys, prefixes) {
  const s = safeStorage(storage);
  if (!s) return;

  for (const key of exactKeys) {
    try {
      s.removeItem(key);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }

  const toRemove = [];
  try {
    for (let i = 0; i < s.length; i += 1) {
      const key = s.key(i);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
        toRemove.push(key);
      }
    }
  } catch {
    // Ignore storage enumeration failures; reset is best-effort.
  }

  for (const key of toRemove) {
    try {
      s.removeItem(key);
    } catch {
      // Ignore individual key failures so the rest of the reset can proceed.
    }
  }
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;

  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getStoredAuthUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || "null");
  } catch {
    return null;
  }
}

export function getAuthIdentity(token, user) {
  const payload = decodeJwtPayload(token) || {};
  const id =
    user?.id ||
    user?._id ||
    user?.userId ||
    payload.id ||
    payload._id ||
    payload.userId ||
    payload.sub;

  if (id) return `id:${String(id)}`;

  const email = normalizeEmail(user?.email || payload.email);
  if (email) return `email:${email}`;

  return "";
}

export function clearAppPersistedUiState() {
  if (typeof window === "undefined") return;
  removeMatching(window.localStorage, LOCAL_EXACT_UI_KEYS, LOCAL_UI_PREFIXES);
  removeMatching(window.sessionStorage, SESSION_EXACT_UI_KEYS, SESSION_UI_PREFIXES);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function setAuthSession(token, user = null) {
  const nextIdentity = getAuthIdentity(token, user);
  const previousToken = getToken();
  const previousIdentity =
    localStorage.getItem(AUTH_IDENTITY_KEY) ||
    getAuthIdentity(previousToken, getStoredAuthUser());

  if (previousIdentity && nextIdentity && previousIdentity !== nextIdentity) {
    clearAppPersistedUiState();
  } else if (!previousIdentity && previousToken && token && previousToken !== token) {
    clearAppPersistedUiState();
  }

  setToken(token);

  if (nextIdentity) {
    localStorage.setItem(AUTH_IDENTITY_KEY, nextIdentity);
  }

  if (user && Object.keys(user).length) {
    try {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    } catch {
      // Auth identity is enough for reset behavior if user JSON cannot be stored.
    }
  } else {
    localStorage.removeItem(AUTH_USER_KEY);
  }
}

export function clearAuthSession() {
  clearAppPersistedUiState();
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_IDENTITY_KEY);
  clearToken();
}

export function getActiveLocationId() {
  return localStorage.getItem(ACTIVE_LOCATION_KEY) || "";
}

export function setActiveLocationId(locationId) {
  const value = String(locationId || "");
  if (value) localStorage.setItem(ACTIVE_LOCATION_KEY, value);
  else localStorage.removeItem(ACTIVE_LOCATION_KEY);
}

export function clearActiveLocationId(locationId = "") {
  const current = getActiveLocationId();
  if (!locationId || current === String(locationId)) {
    localStorage.removeItem(ACTIVE_LOCATION_KEY);
    window.dispatchEvent(
      new CustomEvent("pm:active-location-cleared", {
        detail: { locationId: current || locationId || "" },
      }),
    );
  }
}
