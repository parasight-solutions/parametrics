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

async function loadApiClient() {
  vi.resetModules();
  return import("./apiClient.js");
}

beforeEach(() => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();

  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.window = {
    alert: vi.fn(),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    dispatchEvent: vi.fn(),
    location: {
      href: "/",
      origin: "http://localhost",
      pathname: "/",
      search: "",
    },
    localStorage,
    sessionStorage,
  };
  globalThis.fetch = vi.fn();
});

describe("apiClient location-bound errors", () => {
  it("clears stale active_location_id on a location-bound 404 without logging out", async () => {
    const { api } = await loadApiClient();
    localStorage.setItem("token", "fresh-app-token");
    localStorage.setItem("active_location_id", "stale-location");

    fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: {
              code: "not_found",
              message: "Location not found",
            },
          }),
        ),
    });

    await expect(
      api("/integrations/google/performance-series?locationId=stale-location"),
    ).rejects.toMatchObject({ status: 404 });

    expect(localStorage.getItem("token")).toBe("fresh-app-token");
    expect(localStorage.getItem("active_location_id")).toBeNull();
    expect(window.dispatchEvent).toHaveBeenCalledOnce();
    expect(window.location.href).toBe("/");
  });

  it("does not clear active location for provider reauth errors", async () => {
    const { api } = await loadApiClient();
    localStorage.setItem("token", "fresh-app-token");
    localStorage.setItem("active_location_id", "valid-location");

    fetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: {
              code: "reauth_required",
              message: "Reconnect Google",
            },
          }),
        ),
    });

    await expect(api("/integrations/google/accounts")).rejects.toMatchObject({
      code: "reauth_required",
    });

    expect(localStorage.getItem("token")).toBe("fresh-app-token");
    expect(localStorage.getItem("active_location_id")).toBe("valid-location");
    expect(sessionStorage.getItem("reauth_required")).toContain("google");
    expect(window.location.href).toBe("/integrations?reauth=google");
  });
});

describe("apiClient FormData uploads (S2-33)", () => {
  it("sends FormData unchanged with Bearer auth and no JSON content type", async () => {
    const { api } = await loadApiClient();
    localStorage.setItem("token", "fresh-app-token");

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ url: "http://localhost:5050/uploads/a.png", filename: "a.png" })),
    });

    const fd = new FormData();
    fd.append("file", new Blob(["x"]), "x.png");
    const out = await api("/uploads?locationId=loc_1", { method: "POST", body: fd });

    expect(out.filename).toBe("a.png");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/v1/uploads?locationId=loc_1");
    expect(init.body).toBe(fd);
    expect(init.headers.Authorization).toBe("Bearer fresh-app-token");
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("still JSON-encodes plain object bodies", async () => {
    const { api } = await loadApiClient();
    localStorage.setItem("token", "fresh-app-token");
    fetch.mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve("{}") });

    await api("/posts", { method: "POST", body: { a: 1 } });

    const [, init] = fetch.mock.calls[0];
    expect(init.body).toBe('{"a":1}');
    expect(init.headers["Content-Type"]).toBe("application/json");
  });
});
