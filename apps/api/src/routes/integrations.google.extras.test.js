import test from "node:test";
import assert from "node:assert/strict";

import { readPerformanceDateParams } from "./integrations.google.extras.js";

test("performance series reads only startDate and endDate query parameters", () => {
  assert.deepEqual(
    readPerformanceDateParams({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      start: "legacy-start",
      end: "legacy-end",
    }),
    {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    },
  );
});
