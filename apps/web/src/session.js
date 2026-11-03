export const ACTIVE_LOCATION_KEY = "active_location_id";

const LEGACY_AUTH_KEYS = ["token", "jwt", "pm_auth_user", "pm_auth_identity"];
const LOCAL_UI_KEYS = [ACTIVE_LOCATION_KEY, "gbp.accounts.cache"];
const SESSION_UI_KEYS = [
  "reauth_required",
  "reauth_required_alerted",
  "reauth_required_dismissed",
  "auth_expired_alerted",
];
const SESSION_UI_PREFIXES = ["cache:v1:", "dashRange:v1:"];

function removeKeys(storage, exactKeys, prefixes = []) {
  if (!storage) return;

  for (const key of exactKeys) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage cleanup is best-effort in restricted browser contexts.
    }
  }

  const matching = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
        matching.push(key);
      }
    }
  } catch {
    return;
  }
  for (const key of matching) {
    try {
      storage.removeItem(key);
    } catch {
      // Continue clearing other keys if one removal is blocked.
    }
  }
}

export function clearLegacyAuthStorage() {
  removeKeys(globalThis.localStorage, LEGACY_AUTH_KEYS);
  removeKeys(globalThis.sessionStorage, LEGACY_AUTH_KEYS);
}

export function clearAppPersistedUiState() {
  removeKeys(globalThis.localStorage, LOCAL_UI_KEYS);
  removeKeys(globalThis.sessionStorage, SESSION_UI_KEYS, SESSION_UI_PREFIXES);
}

export function clearAuthSession() {
  clearLegacyAuthStorage();
  clearAppPersistedUiState();
}

export function getActiveLocationId() {
  return globalThis.localStorage?.getItem(ACTIVE_LOCATION_KEY) || "";
}

export function setActiveLocationId(locationId) {
  const value = String(locationId || "");
  if (value) globalThis.localStorage?.setItem(ACTIVE_LOCATION_KEY, value);
  else globalThis.localStorage?.removeItem(ACTIVE_LOCATION_KEY);
}

export function clearActiveLocationId(locationId = "") {
  const current = getActiveLocationId();
  if (!locationId || current === String(locationId)) {
    globalThis.localStorage?.removeItem(ACTIVE_LOCATION_KEY);
    globalThis.window?.dispatchEvent?.(
      new CustomEvent("pm:active-location-cleared", {
        detail: { locationId: current || locationId || "" },
      }),
    );
  }
}
