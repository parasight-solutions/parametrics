import { beforeEach, describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";

import { restoreAuthState } from "./authState";
import { saveSession, setActiveLocationId } from "../../session";

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

describe("restoreAuthState", () => {
  it("restores a complete unexpired session", () => {
    const user = { id: "user-1", email: "user@example.com" };
    const token = createToken({ exp: 2_000 });
    saveSession(user, token);

    expect(restoreAuthState(1_000_000)).toEqual({ user, token });
  });

  it("clears every session value when the token is expired", () => {
    saveSession(
      { id: "user-1", email: "user@example.com" },
      createToken({ exp: 1_000 }),
    );
    setActiveLocationId("location-1");

    expect(restoreAuthState(1_000_000)).toEqual({ user: null, token: null });
    expect(sessionStorage.getItem("pm_access_token")).toBeNull();
    expect(localStorage.getItem("pm_auth_identity")).toBeNull();
    expect(localStorage.getItem("pm_active_location_id")).toBeNull();
  });

  it("clears an incomplete session", () => {
    sessionStorage.setItem(
      "pm_access_token",
      createToken({ exp: 2_000 }),
    );
    localStorage.setItem("pm_auth_identity", "id:user-1");

    expect(restoreAuthState(1_000_000)).toEqual({ user: null, token: null });
    expect(sessionStorage.getItem("pm_access_token")).toBeNull();
    expect(localStorage.getItem("pm_auth_identity")).toBeNull();
  });
});
