import { beforeEach, describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";

import {
  clearSession,
  getActiveLocationId,
  getGoogleReauth,
  getStoredUser,
  getToken,
  isTokenExpired,
  saveSession,
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

function createToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

beforeEach(() => {
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();
});

describe("client session persistence", () => {
  it("stores the access token and user only for the browser session", () => {
    const user = { id: "user-1", email: "user@example.com", role: "user" };

    saveSession(user, "access-token");

    expect(sessionStorage.getItem("pm_access_token")).toBe("access-token");
    expect(getToken()).toBe("access-token");
    expect(getStoredUser()).toEqual(user);
    expect(localStorage.getItem("pm_access_token")).toBeNull();
    expect(localStorage.getItem("pm_auth_identity")).toBe("id:user-1");
  });

  it("clears an active location when a different identity logs in", () => {
    saveSession({ id: "user-1", email: "one@example.com" }, "token-one");
    setActiveLocationId("location-1");

    saveSession({ id: "user-2", email: "two@example.com" }, "token-two");

    expect(getActiveLocationId()).toBe("");
    expect(localStorage.getItem("pm_auth_identity")).toBe("id:user-2");
  });

  it("preserves an active location when the same identity logs in again", () => {
    saveSession({ id: "user-1", email: "one@example.com" }, "token-one");
    setActiveLocationId("location-1");

    saveSession({ id: "user-1", email: "one@example.com" }, "token-two");

    expect(getActiveLocationId()).toBe("location-1");
  });

  it("uses normalized email when the user has no id", () => {
    saveSession({ email: "  User@Example.COM " }, "token");

    expect(localStorage.getItem("pm_auth_identity")).toBe(
      "email:user@example.com",
    );
  });

  it("clears all approved auth and location values on logout", () => {
    saveSession({ id: "user-1", email: "one@example.com" }, "token");
    setActiveLocationId("location-1");
    setGoogleReauth({ provider: "google", message: "Reconnect" });

    clearSession();

    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(getGoogleReauth()).toBeNull();
    expect(localStorage.getItem("pm_auth_identity")).toBeNull();
    expect(getActiveLocationId()).toBe("");
  });

  it("returns null when the stored user or Google reauth value is malformed", () => {
    sessionStorage.setItem("pm_auth_user", "not-json");
    sessionStorage.setItem("pm_google_reauth", "not-json");

    expect(getStoredUser()).toBeNull();
    expect(getGoogleReauth()).toBeNull();
  });
});

describe("token expiration", () => {
  it("accepts a token whose expiration is in the future", () => {
    const token = createToken({ exp: 2_000 });

    expect(isTokenExpired(token, 1_000_000)).toBe(false);
  });

  it("rejects expired and malformed tokens", () => {
    const expired = createToken({ exp: 1_000 });

    expect(isTokenExpired(expired, 1_000_000)).toBe(true);
    expect(isTokenExpired("not-a-jwt", 1_000_000)).toBe(true);
  });
});
