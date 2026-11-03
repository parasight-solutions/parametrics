import test from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_TTL_MS,
  createAuthSessionStore,
  getSessionCookieOptions,
  hashSessionToken,
} from "./authSessions.js";

function createCollection() {
  const documents = [];

  return {
    documents,
    async insertOne(document) {
      documents.push(structuredClone(document));
    },
    async findOne(query) {
      return documents.find((document) => {
        if (document.token_hash !== query.token_hash) return false;
        if (query.revoked_at === null && document.revoked_at !== null) return false;
        if (query.expires_at?.$gt && !(document.expires_at > query.expires_at.$gt)) {
          return false;
        }
        return true;
      }) ?? null;
    },
    async updateOne(query, update) {
      const document = documents.find(
        (item) => item.token_hash === query.token_hash,
      );
      if (document) Object.assign(document, structuredClone(update.$set));
      return { matchedCount: document ? 1 : 0 };
    },
  };
}

test("createSession persists only a hash of a high-entropy raw token", async () => {
  const collection = createCollection();
  const now = new Date("2026-11-03T00:00:00.000Z");
  const store = createAuthSessionStore({
    getCollection: async () => collection,
    now: () => now,
    randomBytes: () => Buffer.alloc(32, 7),
  });

  const rawToken = await store.createSession("user-1");

  assert.equal(rawToken, Buffer.alloc(32, 7).toString("base64url"));
  assert.equal(collection.documents.length, 1);
  assert.equal(collection.documents[0].user_id, "user-1");
  assert.equal(collection.documents[0].token_hash, hashSessionToken(rawToken));
  assert.equal(JSON.stringify(collection.documents[0]).includes(rawToken), false);
  assert.equal(
    collection.documents[0].expires_at.getTime(),
    now.getTime() + SESSION_TTL_MS,
  );
});

test("resolveSession accepts active sessions and rejects expired or revoked sessions", async () => {
  const collection = createCollection();
  const now = new Date("2026-11-03T00:00:00.000Z");
  const store = createAuthSessionStore({
    getCollection: async () => collection,
    now: () => now,
    randomBytes: () => Buffer.alloc(32, 3),
  });
  const token = await store.createSession("user-1");

  assert.equal((await store.resolveSession(token)).user_id, "user-1");

  collection.documents[0].revoked_at = now;
  assert.equal(await store.resolveSession(token), null);

  collection.documents[0].revoked_at = null;
  collection.documents[0].expires_at = new Date(now.getTime() - 1);
  assert.equal(await store.resolveSession(token), null);
});

test("revokeSession is idempotent for missing and existing tokens", async () => {
  const collection = createCollection();
  const now = new Date("2026-11-03T00:00:00.000Z");
  const store = createAuthSessionStore({
    getCollection: async () => collection,
    now: () => now,
    randomBytes: () => Buffer.alloc(32, 5),
  });
  const token = await store.createSession("user-1");

  assert.equal(await store.revokeSession(token), true);
  assert.equal(collection.documents[0].revoked_at.getTime(), now.getTime());
  assert.equal(await store.revokeSession("missing"), false);
  assert.equal(await store.revokeSession(""), false);
});

test("cookie options are host-only, HttpOnly, Lax, and environment secure", () => {
  assert.deepEqual(getSessionCookieOptions({ NODE_ENV: "development" }), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: SESSION_TTL_MS,
  });

  assert.deepEqual(getSessionCookieOptions({ NODE_ENV: "production" }), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
});
