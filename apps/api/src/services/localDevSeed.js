import bcrypt from "bcryptjs";
import crypto from "node:crypto";

// Local development admin seed (S2-33).
//
// Login (routes/auth.js) looks the user up by `normalized_email` and checks
// bcrypt against the `password` field. The old seed wrote only
// `password_hash`, so the seeded admin could never log in. `password_hash` is
// kept identical for older tooling that reads it.
//
// The password comes from SEED_ADMIN_PASSWORD and is never printed. The seed
// refuses non-local NODE_ENV values and any non-localhost MongoDB.

const LOCAL_ENVS = new Set(["development", "test"]);
const LOCAL_MONGO_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export const MIN_SEED_PASSWORD_LENGTH = 12;
export const DEFAULT_SEED_ADMIN_EMAIL = "admin@example.com";

function seedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function mongoUriIsLocal(uri) {
  const value = String(uri || "").trim();
  if (!/^mongodb:\/\//i.test(value)) return false; // mongodb+srv and anything else
  const hostPart = value.replace(/^mongodb:\/\//i, "").split(/[/?]/)[0].split("@").pop();
  const hosts = hostPart.split(",").map((h) => h.replace(/:\d+$/, "").toLowerCase());
  return hosts.length > 0 && hosts.every((h) => LOCAL_MONGO_HOSTS.has(h));
}

export function assertLocalSeedEnvironment(env = process.env) {
  const envName = String(env.NODE_ENV || "").trim().toLowerCase();
  if (!LOCAL_ENVS.has(envName)) {
    throw seedError("seed_not_local_env", "seed may only run with NODE_ENV=development or NODE_ENV=test");
  }
  const uri = env.MONGODB_URI || env.MONGO_URI || "mongodb://127.0.0.1:27017";
  if (!mongoUriIsLocal(uri)) {
    throw seedError(
      "seed_not_local_mongo",
      "seed refuses a non-localhost MongoDB; set MONGODB_URI=mongodb://127.0.0.1:27017"
    );
  }
}

function resolveSeedPassword(env) {
  const password = String(env.SEED_ADMIN_PASSWORD || "");
  if (password.length < MIN_SEED_PASSWORD_LENGTH) {
    throw seedError(
      "seed_password_required",
      `set SEED_ADMIN_PASSWORD (at least ${MIN_SEED_PASSWORD_LENGTH} characters) to create or repair the local admin`
    );
  }
  return password;
}

export async function seedLocalAdmin({
  users,
  env = process.env,
  resetPassword = false,
  hash = (password) => bcrypt.hash(password, 10),
  now = () => new Date(),
  idFactory = () => crypto.randomUUID(),
} = {}) {
  assertLocalSeedEnvironment(env);

  const email = String(env.SEED_ADMIN_EMAIL || DEFAULT_SEED_ADMIN_EMAIL).trim().toLowerCase();
  const existing =
    (await users.findOne({ normalized_email: email })) || (await users.findOne({ email }));

  if (existing?.password && !resetPassword) {
    return { action: "unchanged", user_id: existing.id };
  }

  const passwordHash = await hash(resolveSeedPassword(env));
  const at = now();

  if (existing) {
    const action = existing.password ? "password_reset" : "repaired";
    await users.updateOne(
      { id: existing.id },
      { $set: { password: passwordHash, password_hash: passwordHash, normalized_email: email, updated_at: at } }
    );
    return { action, user_id: existing.id };
  }

  const id = idFactory();
  await users.insertOne({
    id,
    email,
    normalized_email: email,
    password: passwordHash,
    password_hash: passwordHash,
    role: "super_admin",
    status: "active",
    created_at: at,
    updated_at: at,
  });
  return { action: "created", user_id: id };
}
