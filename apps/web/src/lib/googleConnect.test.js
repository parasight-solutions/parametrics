import { describe, expect, it, vi } from "vitest";
import { isSafeConnectUrl, startGoogleConnect } from "./googleConnect";

const GO = "http://localhost:5050/api/v1/integrations/google/connect/go?h=abc";

describe("isSafeConnectUrl", () => {
  it("accepts the API connect/go hop with a handoff", () => {
    expect(isSafeConnectUrl(GO)).toBe(true);
    expect(isSafeConnectUrl("https://api.example.com/api/v1/integrations/google/connect/go?h=x")).toBe(true);
  });

  it("rejects other schemes, paths, credentials and missing handoffs", () => {
    expect(isSafeConnectUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeConnectUrl("https://evil.example.com/phish")).toBe(false);
    expect(isSafeConnectUrl("https://u:p@api.example.com/api/v1/integrations/google/connect/go?h=x")).toBe(false);
    expect(isSafeConnectUrl("https://api.example.com/api/v1/integrations/google/connect/go")).toBe(false);
    expect(isSafeConnectUrl("")).toBe(false);
  });
});

describe("startGoogleConnect", () => {
  it("POSTs with the api client (Bearer auth) and navigates without a JWT in the URL", async () => {
    const api = vi.fn().mockResolvedValue({ url: GO });
    const assign = vi.fn();
    await startGoogleConnect({ api, assign });
    expect(api).toHaveBeenCalledWith("/integrations/google/connect/start", { method: "POST" });
    expect(assign).toHaveBeenCalledWith(GO);
    expect(assign.mock.calls[0][0]).not.toMatch(/[?&]t=/);
  });

  it("does not navigate when the server returns an unexpected URL", async () => {
    const api = vi.fn().mockResolvedValue({ url: "https://evil.example.com/" });
    const assign = vi.fn();
    await expect(startGoogleConnect({ api, assign })).rejects.toMatchObject({ code: "connect_start_invalid" });
    expect(assign).not.toHaveBeenCalled();
  });
});
