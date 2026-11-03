import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSession,
  getActiveLocationId,
  getGoogleReauth,
  setActiveLocationId,
  setGoogleReauth,
} from "./session";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    removeItem: (key) => values.delete(String(key)),
    setItem: (key, value) => values.set(String(key), String(value)),
  };
}

beforeEach(() => {
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();
});

describe("client browser storage", () => {
  it("removes obsolete auth data without clearing UI preferences", () => {
    sessionStorage.setItem("pm_access_token", "legacy");
    sessionStorage.setItem("pm_auth_user", "{}");
    localStorage.setItem("pm_auth_identity", "id:user-1");
    setActiveLocationId("location-1");
    setGoogleReauth({ provider: "google" });

    expect(sessionStorage.getItem("pm_access_token")).toBeNull();
    expect(sessionStorage.getItem("pm_auth_user")).toBeNull();
    expect(localStorage.getItem("pm_auth_identity")).toBeNull();
    expect(getActiveLocationId()).toBe("location-1");
    expect(getGoogleReauth()).toEqual({ provider: "google" });
  });

  it("clears UI-scoped auth state on logout", () => {
    setActiveLocationId("location-1");
    setGoogleReauth({ provider: "google" });
    clearSession();
    expect(getActiveLocationId()).toBe("");
    expect(getGoogleReauth()).toBeNull();
  });
});
