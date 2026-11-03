import { describe, expect, it } from "vitest";

import { getLoginErrorMessage, getPostLoginPath } from "./loginHelpers";

describe("getPostLoginPath", () => {
  it("returns the internal route requested by the private-route guard", () => {
    expect(
      getPostLoginPath({ pathname: "/reports", search: "?page=2" }),
    ).toBe("/reports?page=2");
  });

  it("falls back to the dashboard for missing or external destinations", () => {
    expect(getPostLoginPath(null)).toBe("/");
    expect(getPostLoginPath({ pathname: "https://example.com" })).toBe("/");
    expect(getPostLoginPath({ pathname: "//example.com" })).toBe("/");
  });
});

describe("getLoginErrorMessage", () => {
  it("uses a backend message when one is provided", () => {
    expect(
      getLoginErrorMessage({
        response: { data: { error: { message: "Account is disabled" } } },
      }),
    ).toBe("Account is disabled");
  });

  it("uses a clear credentials message for the backend invalid code", () => {
    expect(
      getLoginErrorMessage({
        response: { data: { error: { code: "invalid" } } },
      }),
    ).toBe("Invalid email or password.");
  });

  it("falls back when no safe backend message exists", () => {
    expect(getLoginErrorMessage(new Error("Network Error"))).toBe(
      "Unable to sign in. Please try again.",
    );
  });
});
