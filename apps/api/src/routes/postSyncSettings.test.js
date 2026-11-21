import test from "node:test";
import assert from "node:assert/strict";
import router from "./postSyncSettings.js";

function route(method, path) {
  return router.stack.find((layer) =>
    layer.route?.path === path && layer.route?.methods?.[method],
  )?.route;
}

test("post auto-sync settings routes are authenticated and expose only read and update operations", () => {
  const read = route("get", "/");
  const individual = route("patch", "/locations/:locationId");
  const bulk = route("patch", "/");
  assert.ok(read);
  assert.ok(individual);
  assert.ok(bulk);
  assert.equal(read.stack[0].name, "authenticate");
  assert.equal(individual.stack[0].name, "authenticate");
  assert.equal(bulk.stack[0].name, "authenticate");
  assert.equal(router.stack.some((layer) => layer.route?.methods?.post), false);
});
