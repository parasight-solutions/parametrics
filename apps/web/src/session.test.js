import { beforeEach, describe, expect, it, vi } from "vitest";

function createStorage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    getItem: vi.fn((key) => data.get(String(key)) ?? null),
    key: vi.fn((index) => Array.from(data.keys())[index] ?? null),
    removeItem: vi.fn((key) => data.delete(String(key))),
    setItem: vi.fn((key, value) => data.set(String(key), String(value))),
  };
}

async function loadSession() {
  vi.resetModules();
  return import("./session.js");
}

beforeEach(() => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.window = {
    dispatchEvent: vi.fn(),
    localStorage,
    sessionStorage,
  };
});

describe("cookie-session browser cleanup", () => {
  it("removes obsolete browser authentication values without clearing location", async () => {
    const { clearLegacyAuthStorage } = await loadSession();
    localStorage.setItem("token", "legacy-token");
    localStorage.setItem("jwt", "legacy-jwt");
    localStorage.setItem("pm_auth_user", "legacy-user");
    localStorage.setItem("pm_auth_identity", "id:user-1");
    localStorage.setItem("active_location_id", "location-1");

    clearLegacyAuthStorage();

    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("jwt")).toBeNull();
    expect(localStorage.getItem("pm_auth_user")).toBeNull();
    expect(localStorage.getItem("pm_auth_identity")).toBeNull();
    expect(localStorage.getItem("active_location_id")).toBe("location-1");
  });

  it("clears user-scoped UI state and active location on logout", async () => {
    const { clearAuthSession } = await loadSession();
    localStorage.setItem("active_location_id", "location-1");
    localStorage.setItem("gbp.accounts.cache", "cached");
    sessionStorage.setItem("cache:v1:GET:/stale", "cached");
    sessionStorage.setItem("reauth_required", "google");

    clearAuthSession();

    expect(localStorage.getItem("active_location_id")).toBeNull();
    expect(localStorage.getItem("gbp.accounts.cache")).toBeNull();
    expect(sessionStorage.getItem("cache:v1:GET:/stale")).toBeNull();
    expect(sessionStorage.getItem("reauth_required")).toBeNull();
  });
});
