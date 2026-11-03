import { describe, expect, it, vi } from "vitest";
import { restoreAuthenticatedUser } from "./authState";

describe("restoreAuthenticatedUser", () => {
  it("returns the user from the session endpoint", async () => {
    const user = { id: "user-1" };
    await expect(restoreAuthenticatedUser(vi.fn().mockResolvedValue({ data: { user } }))).resolves.toEqual(user);
  });

  it("treats an unauthorized response as a signed-out session", async () => {
    const error = { response: { status: 401 } };
    await expect(restoreAuthenticatedUser(vi.fn().mockRejectedValue(error))).resolves.toBeNull();
  });

  it("preserves non-authentication failures", async () => {
    const error = { response: { status: 500 } };
    await expect(restoreAuthenticatedUser(vi.fn().mockRejectedValue(error))).rejects.toBe(error);
  });
});
