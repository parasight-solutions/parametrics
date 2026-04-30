import { beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";

function createStorage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    clear: vi.fn(() => data.clear()),
    getItem: vi.fn((key) => data.get(String(key)) ?? null),
    key: vi.fn((index) => Array.from(data.keys())[index] ?? null),
    removeItem: vi.fn((key) => data.delete(String(key))),
    setItem: vi.fn((key, value) => data.set(String(key), String(value))),
  };
}

function encodeJwtPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `header.${encoded}.signature`;
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
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    dispatchEvent: vi.fn(),
    localStorage,
    sessionStorage,
  };
});

describe("session persistence reset behavior", () => {
  it("clears app-owned UI/cache keys when auth identity changes and preserves the new session", async () => {
    const { setAuthSession } = await loadSession();
    const oldToken = encodeJwtPayload({ sub: "user-a", email: "a@example.com" });
    const newToken = encodeJwtPayload({ sub: "user-b", email: "b@example.com" });

    setAuthSession(oldToken, { id: "user-a", email: "a@example.com" });
    localStorage.setItem("active_location_id", "loc-a");
    localStorage.setItem("gbp.accounts.cache", '{"stale":true}');
    localStorage.setItem("unrelated_key", "keep-me");
    sessionStorage.setItem("cache:v1:GET:/stale", '{"data":"old"}');
    sessionStorage.setItem("dashRange:v1:loc-a", '{"start":"2026-01-01"}');
    sessionStorage.setItem("reauth_required", '{"provider":"google"}');

    setAuthSession(newToken, { id: "user-b", email: "b@example.com" });

    expect(localStorage.getItem("token")).toBe(newToken);
    expect(localStorage.getItem("pm_auth_identity")).toBe("id:user-b");
    expect(localStorage.getItem("pm_auth_user")).toContain("b@example.com");
    expect(localStorage.getItem("active_location_id")).toBeNull();
    expect(localStorage.getItem("gbp.accounts.cache")).toBeNull();
    expect(localStorage.getItem("unrelated_key")).toBe("keep-me");
    expect(sessionStorage.getItem("cache:v1:GET:/stale")).toBeNull();
    expect(sessionStorage.getItem("dashRange:v1:loc-a")).toBeNull();
    expect(sessionStorage.getItem("reauth_required")).toBeNull();
  });

  it("does not clear valid app state for the same auth identity", async () => {
    const { setAuthSession } = await loadSession();
    const tokenA = encodeJwtPayload({ sub: "user-a", email: "first@example.com" });
    const tokenB = encodeJwtPayload({ sub: "user-a", email: "first@example.com" });

    setAuthSession(tokenA, { id: "user-a", email: "first@example.com" });
    localStorage.setItem("active_location_id", "loc-a");
    sessionStorage.setItem("dashRange:v1:loc-a", '{"start":"2026-01-01"}');

    setAuthSession(tokenB, { id: "user-a", email: "first@example.com" });

    expect(localStorage.getItem("token")).toBe(tokenB);
    expect(localStorage.getItem("active_location_id")).toBe("loc-a");
    expect(sessionStorage.getItem("dashRange:v1:loc-a")).toBe('{"start":"2026-01-01"}');
  });

  it("clears token/auth metadata and app-owned UI/cache keys on clearAuthSession", async () => {
    const { clearAuthSession, setAuthSession } = await loadSession();
    const token = encodeJwtPayload({ sub: "user-a", email: "a@example.com" });

    setAuthSession(token, { id: "user-a", email: "a@example.com" });
    localStorage.setItem("active_location_id", "loc-a");
    localStorage.setItem("gbp.accounts.cache", '{"stale":true}');
    localStorage.setItem("unrelated_key", "keep-me");
    sessionStorage.setItem("cache:v1:GET:/stale", '{"data":"old"}');
    sessionStorage.setItem("auth_expired_alerted", "1");

    clearAuthSession();

    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("pm_auth_identity")).toBeNull();
    expect(localStorage.getItem("pm_auth_user")).toBeNull();
    expect(localStorage.getItem("active_location_id")).toBeNull();
    expect(localStorage.getItem("gbp.accounts.cache")).toBeNull();
    expect(localStorage.getItem("unrelated_key")).toBe("keep-me");
    expect(sessionStorage.getItem("cache:v1:GET:/stale")).toBeNull();
    expect(sessionStorage.getItem("auth_expired_alerted")).toBeNull();
  });

  it("uses normalized email as identity when no user id is available", async () => {
    const { setAuthSession } = await loadSession();
    const first = encodeJwtPayload({ email: "User@Example.COM" });
    const second = encodeJwtPayload({ email: "other@example.com" });

    setAuthSession(first);
    localStorage.setItem("active_location_id", "loc-a");

    setAuthSession(second);

    expect(localStorage.getItem("pm_auth_identity")).toBe("email:other@example.com");
    expect(localStorage.getItem("active_location_id")).toBeNull();
  });
});
