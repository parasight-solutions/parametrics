import test from "node:test";
import assert from "node:assert/strict";
import {
  CONNECT_NONCE_COOKIE,
  HANDOFF_TTL_MS,
  STATE_TTL_MS,
  issueConnectHandoff,
  redeemConnectHandoff,
  consumeConnectState,
  connectGoUrl,
  buildNonceCookie,
  clearNonceCookie,
  readNonceCookie,
  hashConnectToken,
} from "./googleConnectState.js";

// Minimal in-memory collection for the operators this service uses.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === "object" && !(cond instanceof Date) && "$gt" in cond) {
      return doc[key] instanceof Date && doc[key] > cond.$gt;
    }
    return doc[key] === cond;
  });
}

function memoryCollection() {
  const docs = [];
  return {
    docs,
    async insertOne(doc) {
      docs.push({ ...doc });
      return { acknowledged: true };
    },
    async findOne(filter) {
      const doc = docs.find((d) => matches(d, filter));
      return doc ? { ...doc } : null;
    },
    async findOneAndUpdate(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { value: null };
      Object.assign(doc, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete doc[key];
      return { value: { ...doc } };
    },
    async findOneAndDelete(filter) {
      const idx = docs.findIndex((d) => matches(d, filter));
      if (idx < 0) return { value: null };
      const [doc] = docs.splice(idx, 1);
      return { value: doc };
    },
  };
}

const RU = "http://localhost:5050/api/v1/integrations/google/callback";
const T0 = new Date("2026-10-22T10:00:00.000Z");
const at = (ms) => new Date(T0.getTime() + ms);

async function startAndRedeem(collection, userId = "user_a") {
  const { handoff } = await issueConnectHandoff({ collection, userId, redirectUri: RU, now: T0 });
  const redeemed = await redeemConnectHandoff({ collection, handoff, now: at(1000) });
  return { handoff, redeemed };
}

test("happy path binds the callback to the user who started it", async () => {
  const collection = memoryCollection();
  const { redeemed } = await startAndRedeem(collection, "user_a");
  assert.equal(redeemed.userId, "user_a");
  assert.equal(redeemed.redirectUri, RU);

  const out = await consumeConnectState({ collection, state: redeemed.state, nonce: redeemed.nonce, now: at(5000) });
  assert.deepEqual(out, { ok: true, userId: "user_a", redirectUri: RU });
  assert.equal(collection.docs.length, 0, "record is consumed");
});

test("only hashes are stored; no raw handoff, state or nonce", async () => {
  const collection = memoryCollection();
  const { handoff, redeemed } = await startAndRedeem(collection);
  const stored = JSON.stringify(collection.docs);
  for (const raw of [handoff, redeemed.state, redeemed.nonce]) assert.ok(!stored.includes(raw));
  assert.equal(collection.docs[0].state_hash, hashConnectToken(redeemed.state));
  assert.equal(collection.docs[0].handoff_hash, undefined, "handoff hash is removed once redeemed");
});

test("handoff is single-use and expires after HANDOFF_TTL_MS", async () => {
  const collection = memoryCollection();
  const { handoff } = await issueConnectHandoff({ collection, userId: "user_a", redirectUri: RU, now: T0 });
  assert.ok(await redeemConnectHandoff({ collection, handoff, now: at(1) }));
  assert.equal(await redeemConnectHandoff({ collection, handoff, now: at(2) }), null, "replayed handoff");

  const late = await issueConnectHandoff({ collection, userId: "user_a", redirectUri: RU, now: T0 });
  assert.equal(await redeemConnectHandoff({ collection, handoff: late.handoff, now: at(HANDOFF_TTL_MS) }), null);
});

test("concurrent handoff redemption succeeds at most once", async () => {
  const collection = memoryCollection();
  const { handoff } = await issueConnectHandoff({ collection, userId: "user_a", redirectUri: RU, now: T0 });
  const results = await Promise.all(
    Array.from({ length: 5 }, () => redeemConnectHandoff({ collection, handoff, now: at(1) }))
  );
  assert.equal(results.filter(Boolean).length, 1);
});

test("state replay is rejected", async () => {
  const collection = memoryCollection();
  const { redeemed } = await startAndRedeem(collection);
  const first = await consumeConnectState({ collection, state: redeemed.state, nonce: redeemed.nonce, now: at(2000) });
  const second = await consumeConnectState({ collection, state: redeemed.state, nonce: redeemed.nonce, now: at(3000) });
  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: false, reason: "state_unknown_or_used" });
});

test("expired state is rejected even before the TTL monitor deletes it", async () => {
  const collection = memoryCollection();
  const { redeemed } = await startAndRedeem(collection);
  const out = await consumeConnectState({
    collection,
    state: redeemed.state,
    nonce: redeemed.nonce,
    now: at(STATE_TTL_MS + 1),
  });
  assert.deepEqual(out, { ok: false, reason: "state_expired" });
});

test("cross-user / cross-browser: another browser cannot complete a state it did not start", async () => {
  const collection = memoryCollection();
  const attacker = await startAndRedeem(collection, "user_attacker");
  const victim = await startAndRedeem(collection, "user_victim");

  // Victim's browser carries its own nonce, not the attacker's.
  const forged = await consumeConnectState({
    collection,
    state: attacker.redeemed.state,
    nonce: victim.redeemed.nonce,
    now: at(4000),
  });
  assert.deepEqual(forged, { ok: false, reason: "browser_mismatch" });

  const noCookie = await consumeConnectState({ collection, state: attacker.redeemed.state, nonce: "", now: at(4000) });
  assert.deepEqual(noCookie, { ok: false, reason: "browser_mismatch" });

  // The mismatches did not consume or rebind anything.
  const legit = await consumeConnectState({
    collection,
    state: victim.redeemed.state,
    nonce: victim.redeemed.nonce,
    now: at(5000),
  });
  assert.deepEqual(legit, { ok: true, userId: "user_victim", redirectUri: RU });
});

test("malformed state, nonce and handoff values are rejected without lookups", async () => {
  const collection = memoryCollection();
  assert.deepEqual(await consumeConnectState({ collection, state: "eyJhbGciOi.legacy.jwt", nonce: "x" }), {
    ok: false,
    reason: "state_invalid",
  });
  assert.equal(await redeemConnectHandoff({ collection, handoff: { $ne: null } }), null);
  assert.equal(await redeemConnectHandoff({ collection, handoff: "" }), null);
});

test("issue refuses a missing user id", async () => {
  await assert.rejects(
    issueConnectHandoff({ collection: memoryCollection(), userId: "", redirectUri: RU }),
    (err) => err.code === "unauthorized"
  );
});

test("connect/go URL is on the callback origin and carries only the handoff", () => {
  const url = new URL(connectGoUrl(RU, "H".repeat(43)));
  assert.equal(url.origin, "http://localhost:5050");
  assert.equal(url.pathname, "/api/v1/integrations/google/connect/go");
  assert.deepEqual([...url.searchParams.keys()], ["h"]);
  assert.throws(() => connectGoUrl("https://api.example.com/oauth/return", "x"), (err) => err.code === "config");
});

test("nonce cookie is HttpOnly, SameSite=Lax, scoped to the callback path, Secure on https", () => {
  const httpCookie = buildNonceCookie("n1", RU);
  assert.match(httpCookie, new RegExp(`^${CONNECT_NONCE_COOKIE}=n1;`));
  assert.match(httpCookie, /Path=\/api\/v1\/integrations\/google\/callback/);
  assert.match(httpCookie, /HttpOnly/);
  assert.match(httpCookie, /SameSite=Lax/);
  assert.match(httpCookie, /Max-Age=600/);
  assert.doesNotMatch(httpCookie, /Secure/);
  assert.match(buildNonceCookie("n1", "https://api.example.com/api/v1/integrations/google/callback"), /Secure/);
  assert.match(clearNonceCookie(RU), /Max-Age=0/);

  assert.equal(readNonceCookie({ headers: { cookie: `a=1; ${CONNECT_NONCE_COOKIE}=abc ; b=2` } }), "abc");
  assert.equal(readNonceCookie({ headers: {} }), "");
});
