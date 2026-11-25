import { describe, expect, it } from "vitest";

import { isApplicationAuthFailure } from "./authFailure";

describe("isApplicationAuthFailure", () => {
  it("recognizes an unauthorized application response", () => {
    expect(
      isApplicationAuthFailure({
        response: { status: 401, data: { errors: [{ code: "unauthorized" }] } },
        config: { url: "/clients" },
      }),
    ).toBe(true);
  });

  it("does not expire the current session for a failed login", () => {
    expect(
      isApplicationAuthFailure({
        response: { status: 401, data: { errors: [{ code: "invalid" }] } },
        config: { url: "/auth/login", headers: {} },
      }),
    ).toBe(false);
  });

  it("does not treat Google reauthorization as application logout", () => {
    expect(
      isApplicationAuthFailure({
        response: {
          status: 401,
          data: {
            errors: [
              {
                code: "reauth_required",
                details: { provider: "google", reason: "access_revoked" },
              },
            ],
          },
        },
        config: { url: "/integrations/google/accounts" },
      }),
    ).toBe(false);
  });

  it("gives canonical Google reconnect details precedence across all errors", () => {
    expect(
      isApplicationAuthFailure({
        response: {
          status: 401,
          data: {
            errors: [
              { code: "unauthorized", message: "Unauthorized" },
              {
                code: "reauth_required",
                message: "Reconnect Google",
                details: { provider: "google", reason: "invalid_grant" },
              },
            ],
          },
        },
        config: { url: "/integrations/google/accounts" },
      }),
    ).toBe(false);
  });

  it.each([
    {
      response: { status: 403, data: { errors: [{ code: "unauthorized" }] } },
      config: { url: "/clients" },
    },
    {
      response: { status: 401, data: { errors: [] } },
      config: { url: "/clients" },
    },
    {
      response: { status: 200, data: { errors: [{ code: "unauthorized" }] } },
      config: { url: "/clients" },
    },
    {
      response: { status: 401, data: { message: "Unauthorized" } },
      config: { url: "/clients" },
    },
    {
      response: { status: 401, data: { errors: [{ code: "invalid" }] } },
      config: { url: "/auth/session" },
    },
  ])("rejects non-qualifying auth failures", (error) => {
    expect(isApplicationAuthFailure(error)).toBe(false);
  });
});
