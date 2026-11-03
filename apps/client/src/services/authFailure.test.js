import { describe, expect, it } from "vitest";

import { isApplicationAuthFailure } from "./authFailure";

describe("isApplicationAuthFailure", () => {
  it("recognizes an unauthorized response to a bearer-authenticated request", () => {
    expect(
      isApplicationAuthFailure({
        response: { status: 401, data: { error: { code: "unauthorized" } } },
        config: { headers: { Authorization: "Bearer token" } },
      }),
    ).toBe(true);
  });

  it("does not expire the current session for a failed login", () => {
    expect(
      isApplicationAuthFailure({
        response: { status: 401, data: { error: { code: "invalid" } } },
        config: { url: "/auth/login", headers: {} },
      }),
    ).toBe(false);
  });

  it("does not treat Google reauthorization as application logout", () => {
    expect(
      isApplicationAuthFailure({
        response: {
          status: 401,
          data: { error: { code: "reauth_required" } },
        },
        config: { headers: { Authorization: "Bearer token" } },
      }),
    ).toBe(false);
  });
});
