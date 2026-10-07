import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOGIN_INITIAL_FORM } from "./Login.jsx";

const source = readFileSync(fileURLToPath(new URL("./Login.jsx", import.meta.url)), "utf8");

describe("Login form defaults (S2-31.3)", () => {
  it("starts with empty email and password", () => {
    expect(LOGIN_INITIAL_FORM).toEqual({ email: "", password: "" });
    expect(Object.isFrozen(LOGIN_INITIAL_FORM)).toBe(true);
  });

  it("does not ship hard-coded default credentials", () => {
    expect(source).not.toContain("Admin@123456");
    expect(source).not.toMatch(/useState\(\s*"[^"]*@[^"]*"\s*\)/);
  });

  it("marks the fields for browser password managers", () => {
    expect(source).toContain('autoComplete="username"');
    expect(source).toContain('autoComplete="current-password"');
  });
});
