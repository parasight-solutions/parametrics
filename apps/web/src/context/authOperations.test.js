import { describe, expect, it } from "vitest";

import { createAuthOperationTracker } from "./authOperations";

describe("createAuthOperationTracker", () => {
  it("keeps only the newest operation current", () => {
    const operations = createAuthOperationTracker();

    const first = operations.begin();
    const second = operations.begin();

    expect(second).toBeGreaterThan(first);
    expect(operations.isCurrent(first)).toBe(false);
    expect(operations.isCurrent(second)).toBe(true);
  });

  it("invalidates every operation captured before it", () => {
    const operations = createAuthOperationTracker();
    const captured = operations.begin();

    const invalidatedGeneration = operations.invalidate();

    expect(invalidatedGeneration).toBeGreaterThan(captured);
    expect(operations.isCurrent(captured)).toBe(false);
    expect(operations.isCurrent(invalidatedGeneration)).toBe(true);
  });
});
