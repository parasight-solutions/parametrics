import { describe, expect, it } from "vitest";

import { restoreAuthenticatedUser } from "./authState";

describe("restoreAuthenticatedUser", () => {
  it("returns the API user for a valid cookie session", async () => {
    const user = { id: "user-1", email: "user@example.com", role: "user" };
    await expect(
      restoreAuthenticatedUser(async () => ({ user })),
    ).resolves.toEqual(user);
  });

  it("returns null for an unauthorized session and rethrows infrastructure errors", async () => {
    await expect(
      restoreAuthenticatedUser(async () => {
        throw { status: 401, code: "unauthorized" };
      }),
    ).resolves.toBeNull();

    const failure = { status: 500, code: "server_error" };
    await expect(
      restoreAuthenticatedUser(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
