// apps/api/src/lib/mongo.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findUpEnv(startDir) {
  let dir = startDir;
  while (true) {
    const p = path.join(dir, ".env");
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Load .env only if not already present (prevents overriding prod env)
if (!process.env.MONGODB_URI && !process.env.MONGO_URI && !process.env.MONGO_DB) {
  const envPath = findUpEnv(__dirname);
  if (envPath) dotenv.config({ path: envPath });
}

const uri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017";

const dbName =
  process.env.MONGO_DB ||
  process.env.MONGO_DB_NAME ||
  process.env.MONGODB_DB ||
  "parametrics";

export function maskMongoUri(u) {
  try {
    const x = new URL(u.replace("mongodb+srv://", "http://").replace("mongodb://", "http://"));
    if (x.protocol !== "http:") throw new Error("unexpected scheme");
    if (x.username) x.username = "***";
    if (x.password) x.password = "***";
    return u.startsWith("mongodb+srv://")
      ? x.toString().replace("http://", "mongodb+srv://")
      : x.toString().replace("http://", "mongodb://");
  } catch {
    // Multi-host URIs (h1:27017,h2:27017,...) do not parse as URLs. Never fall
    // back to the raw value: redact everything up to the last "@" instead,
    // keeping only the scheme (if any) and the host part.
    const s = String(u);
    const at = s.lastIndexOf("@");
    if (at === -1) return s;
    const scheme = s.match(/^\s*([a-z][a-z0-9+.-]*:\/\/)/i);
    return `${scheme ? scheme[1] : ""}***:***@${s.slice(at + 1)}`;
  }
}

let _client = null;
let _db = null;

export async function getDb() {
  if (_db) return _db;

  if (!_client) {
    // You already have logs like this; keep it consistent
    console.log(`[mongo] connecting to ${maskMongoUri(uri)} db= ${dbName}`);
    _client = new MongoClient(uri);
    await _client.connect();
  }

  _db = _client.db(dbName);
  return _db;
}

export async function col(name) {
  const db = await getDb();
  return db.collection(name);
}

export async function closeDb() {
  if (_client) {
    await _client.close();
  }
  _client = null;
  _db = null;
}
