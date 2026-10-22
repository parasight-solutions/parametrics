import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { readFile } from "node:fs/promises";
import { assertLocalSeedEnvironment, mongoUriIsLocal, seedLocalAdmin } from "./localDevSeed.js";

const PASSWORD = "local-seed-test-password-1";
const LOCAL_ENV = { NODE_ENV: "development", MONGODB_URI: "mongodb://127.0.0.1:27017", SEED_ADMIN_PASSWORD: PASSWORD };
const fastHash = (password) => bcrypt.hash(password, 4);

function memoryUsers(initial = []) {
  const docs = initial.map((d) => ({ ...d }));
  return {
    docs,
    async findOne(filter) {
      const [key, value] = Object.entries(filter)[0];
      return docs.find((d) => d[key] === value) || null;
    },
    async insertOne(doc) {
      docs.push({ ...doc });
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => d.id === filter.id);
      Object.assign(doc, update.$set);
    },
  };
}

// Mirrors routes/auth.js: normalized_email lookup + bcrypt against `password`.
async function loginWouldSucceed(users, email, password) {
  const user = await users.findOne({ normalized_email: email.trim().toLowerCase() });
  if (!user || !user.password) return false;
  return bcrypt.compare(password, user.password);
}

test("seeded admin satisfies the real login contract", async () => {
  const users = memoryUsers();
  const out = await seedLocalAdmin({ users, env: LOCAL_ENV, hash: fastHash, idFactory: () => "seed-admin-1" });
  assert.deepEqual(out, { action: "created", user_id: "seed-admin-1" });
  assert.equal(await loginWouldSucceed(users, "Admin@Example.com", PASSWORD), true);
  assert.equal(await loginWouldSucceed(users, "admin@example.com", "Admin@123456"), false, "old default password is gone");
  assert.equal(users.docs[0].password, users.docs[0].password_hash);
  assert.equal(users.docs[0].status, "active");
});

test("seed is idempotent and does not reset an existing password", async () => {
  const users = memoryUsers();
  await seedLocalAdmin({ users, env: LOCAL_ENV, hash: fastHash, idFactory: () => "seed-admin-1" });
  const before = users.docs[0].password;
  const again = await seedLocalAdmin({ users, env: { ...LOCAL_ENV, SEED_ADMIN_PASSWORD: "" }, hash: fastHash });
  assert.deepEqual(again, { action: "unchanged", user_id: "seed-admin-1" });
  assert.equal(users.docs.length, 1);
  assert.equal(users.docs[0].password, before);
});

test("legacy password_hash-only admin is repaired; explicit reset rotates", async () => {
  const users = memoryUsers([
    { id: "legacy-admin", email: "admin@example.com", password_hash: await fastHash("Admin@123456"), role: "super_admin" },
  ]);
  assert.equal(await loginWouldSucceed(users, "admin@example.com", "Admin@123456"), false, "legacy row cannot log in");

  const repaired = await seedLocalAdmin({ users, env: LOCAL_ENV, hash: fastHash });
  assert.deepEqual(repaired, { action: "repaired", user_id: "legacy-admin" });
  assert.equal(await loginWouldSucceed(users, "admin@example.com", PASSWORD), true);

  const rotated = await seedLocalAdmin({
    users,
    env: { ...LOCAL_ENV, SEED_ADMIN_PASSWORD: "rotated-local-password-2" },
    hash: fastHash,
    resetPassword: true,
  });
  assert.equal(rotated.action, "password_reset");
  assert.equal(await loginWouldSucceed(users, "admin@example.com", "rotated-local-password-2"), true);
});

test("seed refuses production-like environments and non-local MongoDB", async () => {
  for (const env of [
    { ...LOCAL_ENV, NODE_ENV: "production" },
    { ...LOCAL_ENV, NODE_ENV: "staging" },
    { ...LOCAL_ENV, NODE_ENV: "" },
  ]) {
    await assert.rejects(seedLocalAdmin({ users: memoryUsers(), env }), (err) => err.code === "seed_not_local_env");
  }
  for (const uri of [
    "mongodb+srv://cluster0.example.mongodb.net/parametrics",
    "mongodb://db.example.com:27017",
    "mongodb://127.0.0.1:27017,db.example.com:27017",
  ]) {
    assert.throws(
      () => assertLocalSeedEnvironment({ NODE_ENV: "development", MONGODB_URI: uri }),
      (err) => err.code === "seed_not_local_mongo"
    );
  }
  assert.equal(mongoUriIsLocal("mongodb://localhost:27017/parametrics"), true);
  assert.equal(mongoUriIsLocal("mongodb://[::1]:27017"), true);
});

test("a missing or short password refuses to create an admin", async () => {
  const users = memoryUsers();
  for (const pw of [undefined, "short"]) {
    await assert.rejects(
      seedLocalAdmin({ users, env: { ...LOCAL_ENV, SEED_ADMIN_PASSWORD: pw }, hash: fastHash }),
      (err) => err.code === "seed_password_required"
    );
  }
  assert.equal(users.docs.length, 0);
});

test("seed output never contains the password or a default password", async () => {
  const users = memoryUsers();
  const out = await seedLocalAdmin({ users, env: LOCAL_ENV, hash: fastHash });
  assert.ok(!JSON.stringify(out).includes(PASSWORD));
  const script = await readFile(new URL("../scripts/seed.mongo.js", import.meta.url), "utf8");
  assert.ok(!script.includes("Admin@123456"));
  assert.ok(!/console\.log\([^)]*password/i.test(script));
});
