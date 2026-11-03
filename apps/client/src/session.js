const GOOGLE_REAUTH_KEY = "pm_google_reauth";
const ACTIVE_LOCATION_KEY = "pm_active_location_id";

function readJson(storage, key) {
  try {
    return JSON.parse(storage?.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

export function clearSession() {
  sessionStorage?.removeItem(GOOGLE_REAUTH_KEY);
  localStorage?.removeItem(ACTIVE_LOCATION_KEY);
}

export function getGoogleReauth() {
  return readJson(sessionStorage, GOOGLE_REAUTH_KEY);
}

export function setGoogleReauth(value) {
  if (value) sessionStorage.setItem(GOOGLE_REAUTH_KEY, JSON.stringify(value));
  else sessionStorage?.removeItem(GOOGLE_REAUTH_KEY);
}

export function getActiveLocationId() {
  return localStorage?.getItem(ACTIVE_LOCATION_KEY) ?? "";
}

export function setActiveLocationId(locationId) {
  const value = String(locationId ?? "");
  if (value) localStorage.setItem(ACTIVE_LOCATION_KEY, value);
  else localStorage?.removeItem(ACTIVE_LOCATION_KEY);
}
