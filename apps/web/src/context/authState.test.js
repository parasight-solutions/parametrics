import { describe, expect, it } from "vitest";

import { restoreAuthenticatedUser } from "./authState";

describe("restoreAuthenticatedUser", () => {
  it("returns the API user for a valid cookie session", async () => {
    const user = { id: "user-1", email: "user@example.com", role: "user" };
    await expect(
      restoreAuthenticatedUser(async () => ({
        success: true,
        statusCode: 200,
        message: "Session restored",
        data: { user },
      })),
    ).resolves.toEqual(user);
  });

  it("returns null for an unauthorized session and rethrows infrastructure errors", async () => {
    await expect(
      restoreAuthenticatedUser(async () => {
        throw {
          success: false,
          statusCode: 401,
          message: "Unauthorized",
          errors: [{ code: "unauthorized", message: "Unauthorized" }],
        };
      }),
    ).resolves.toBeNull();

    const failure = {
      success: false,
      statusCode: 500,
      message: "Server error",
      errors: [{ code: "server_error", message: "Server error" }],
    };
    await expect(
      restoreAuthenticatedUser(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
