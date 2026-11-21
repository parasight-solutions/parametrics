import test from "node:test";
import assert from "node:assert/strict";
import { withMongoTransaction } from "./mongo.js";

test("withMongoTransaction commits work through one session and always ends it", async () => {
  const events = [];
  const session = {
    async withTransaction(work, options) {
      events.push(["transaction", options]);
      await work();
      return undefined;
    },
    async endSession() {
      events.push(["end"]);
    },
  };
  const client = { startSession: () => session };
  const result = await withMongoTransaction(async (activeSession) => {
    assert.equal(activeSession, session);
    events.push(["work"]);
    return "done";
  }, { client });
  assert.equal(result, "done");
  assert.deepEqual(events.map(([name]) => name), ["transaction", "work", "end"]);
});

test("withMongoTransaction ends the session when work fails", async () => {
  let ended = false;
  const session = {
    withTransaction: (work) => work(),
    endSession: async () => { ended = true; },
  };
  await assert.rejects(
    withMongoTransaction(async () => { throw new Error("failed"); }, { client: { startSession: () => session } }),
    /failed/,
  );
  assert.equal(ended, true);
});
