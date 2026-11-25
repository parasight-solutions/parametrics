import { Buffer } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    clear: vi.fn(() => data.clear()),
    getItem: vi.fn((key) => data.get(String(key)) ?? null),
    key: vi.fn((index) => Array.from(data.keys())[index] ?? null),
    removeItem: vi.fn((key) => data.delete(String(key))),
    setItem: vi.fn((key, value) => data.set(String(key), String(value))),
  };
}

function response(status, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body ? JSON.stringify(body) : ""),
  };
}

const success = (data = {}) => ({
  success: true,
  statusCode: 200,
  message: "Request completed successfully",
  data,
});

const failure = ({
  statusCode = 400,
  code = "bad_request",
  message = "Bad request",
  details,
} = {}) => ({
  success: false,
  statusCode,
  message,
  errors: [{ code, message, ...(details === undefined ? {} : { details }) }],
});

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
  globalThis.dispatchEvent = vi.fn();
});

describe("api response contract", () => {
  it("returns the complete success envelope", async () => {
    const envelope = success({ locations: [{ id: "location-1" }] });
    fetch.mockResolvedValueOnce(response(200, envelope));
    const { api } = await loadApiClient();

    await expect(api("/locations")).resolves.toEqual(envelope);
  });

  it("throws the complete failure envelope", async () => {
    const envelope = failure({ statusCode: 422, code: "validation_failed" });
    fetch.mockResolvedValueOnce(response(422, envelope));
    const { api } = await loadApiClient();

    await expect(api("/posts")).rejects.toEqual(envelope);
  });

  it("returns null for an empty 204 response", async () => {
    fetch.mockResolvedValueOnce(response(204));
    const { api } = await loadApiClient();

    await expect(api("/auth/logout", { method: "POST" })).resolves.toBeNull();
  });

  it("normalizes a non-contract HTTP response", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () => Promise.resolve("upstream unavailable"),
    });
    const { api } = await loadApiClient();

    await expect(api("/health")).rejects.toEqual({
      success: false,
      statusCode: 502,
      message: "HTTP 502",
      errors: [{ code: "http_error", message: "HTTP 502" }],
    });
  });

  it("normalizes network failures with statusCode zero", async () => {
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { api } = await loadApiClient();

    await expect(api("/locations")).rejects.toEqual({
      success: false,
      statusCode: 0,
      message: "Unable to reach the server",
      errors: [{ code: "network_error", message: "Unable to reach the server" }],
    });
  });

  it("preserves native AbortError rejections", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    fetch.mockRejectedValueOnce(abortError);
    const { api } = await loadApiClient();

    await expect(api("/locations")).rejects.toBe(abortError);
  });
});

describe("api authentication decisions", () => {
  it.each([
    ["unauthorized", 401],
    ["invalid", 401],
  ])("dispatches expiry for HTTP %s/%s", async (code, statusCode) => {
    fetch.mockResolvedValueOnce(response(401, failure({ statusCode, code })));
    const { api, AUTH_EXPIRED_EVENT } = await loadApiClient();

    await expect(api("/posts")).rejects.toMatchObject({ statusCode: 401 });
    expect(globalThis.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: AUTH_EXPIRED_EVENT }),
    );
  });

  it.each([
    [403, "unauthorized", "/posts", true],
    [401, "forbidden", "/posts", true],
    [401, "unauthorized", "/auth/login", true],
    [401, "unauthorized", "/auth/session", true],
    [401, "unauthorized", "/posts", false],
  ])(
    "does not dispatch expiry for status=%s code=%s path=%s auth=%s",
    async (statusCode, code, path, auth) => {
      fetch.mockResolvedValueOnce(
        response(statusCode, failure({ statusCode, code })),
      );
      const { api } = await loadApiClient();

      await expect(api(path, { auth })).rejects.toMatchObject({ statusCode });
      expect(globalThis.dispatchEvent).not.toHaveBeenCalled();
    },
  );

  it("keeps Google reconnect metadata and does not log out", async () => {
    const envelope = failure({
      statusCode: 409,
      code: "reauth_required",
      message: "Reconnect Google",
      details: { provider: "google", error: "invalid_grant" },
    });
    fetch.mockResolvedValueOnce(response(409, envelope));
    const { api } = await loadApiClient();

    await expect(api("/integrations/google/accounts")).rejects.toEqual(envelope);
    expect(globalThis.dispatchEvent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("reauth_required")).toContain("google");
    expect(window.location.href).toBe("/integrations?reauth=google");
  });

  it("gives canonical Google reconnect details precedence across all errors", async () => {
    const envelope = {
      success: false,
      statusCode: 401,
      message: "Reconnect Google",
      errors: [
        { code: "unauthorized", message: "Unauthorized" },
        {
          code: "reauth_required",
          message: "Reconnect Google",
          details: { provider: "google", reason: "invalid_grant" },
        },
      ],
    };
    fetch.mockResolvedValueOnce(response(401, envelope));
    const { api } = await loadApiClient();

    await expect(api("/integrations/google/accounts")).rejects.toEqual(envelope);
    expect(globalThis.dispatchEvent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("reauth_required")).toContain("google");
  });
});

describe("api location-bound errors", () => {
  it("clears a matching stale location on 404 without logging out", async () => {
    const envelope = failure({
      statusCode: 404,
      code: "not_found",
      message: "Location not found",
    });
    fetch.mockResolvedValueOnce(response(404, envelope));
    const { api } = await loadApiClient();
    localStorage.setItem("active_location_id", "stale-location");

    await expect(
      api("/integrations/google/performance-series?locationId=stale-location"),
    ).rejects.toEqual(envelope);

    expect(localStorage.getItem("active_location_id")).toBeNull();
    expect(globalThis.dispatchEvent).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1].credentials).toBe("include");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});
