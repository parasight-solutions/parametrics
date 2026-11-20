import test from "node:test";
import assert from "node:assert/strict";
import { serializeLocationForList } from "./locations.js";

test("location list exposes completed sync metadata but hides active lease fields", () => {
  const location = serializeLocationForList({
    id: "loc-1",
    post_sync: {
      operation_id: "secret-operation",
      operation_expires_at: new Date(),
      last_success_at: new Date("2026-11-19T12:00:00Z"),
      last_inserted_count: 2,
      internal_future_field: "must-not-leak",
    },
  });
  assert.equal(location.post_sync.last_inserted_count, 2);
  assert.equal(location.post_sync.operation_id, undefined);
  assert.equal(location.post_sync.operation_expires_at, undefined);
  assert.equal(location.post_sync.internal_future_field, undefined);
});
