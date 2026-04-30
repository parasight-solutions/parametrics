// apps/api/src/startup/env.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { assertSafeJwtConfig } from "../lib/authConfig.js";

const FLAG = "__PARAMETRICS_ENV_LOADED__";

function isBlank(v) {
  return v == null || String(v).trim() === "";
}

function applyIfMissingOrBlank(parsed, sourceLabel) {
  let applied = 0;
  for (const [k, v] of Object.entries(parsed || {})) {
    if (isBlank(process.env[k])) {
      process.env[k] = String(v);
      applied++;
    }
  }
  return applied;
}

function loadFile(filePath) {
  if (!fs.existsSync(filePath)) return { loaded: false, applied: 0 };
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = dotenv.parse(raw);
  const applied = applyIfMissingOrBlank(parsed, filePath);
  return { loaded: true, applied };
}

function resolveRepoRoot() {
  // Prefer deriving from this file location (works even if cwd is different)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // env.js is: apps/api/src/startup/env.js -> go up 4 levels to repo root
  return path.resolve(__dirname, "../../../../");
}

if (!globalThis[FLAG]) {
  globalThis[FLAG] = true;

  const repoRoot = resolveRepoRoot();
  const candidates = [
    path.join(repoRoot, ".env"),
    path.join(repoRoot, "apps/api/.env"),
  ];

  const loaded = [];
  for (const f of candidates) {
    const out = loadFile(f);
    if (out.loaded) loaded.push({ file: f, applied: out.applied });
  }

  // minimal logs (no secrets)
  const ok = (name) => !isBlank(process.env[name]);
  console.log("[env] loaded files:", loaded.map(x => `${x.file} (applied:${x.applied})`));
  console.log(
    "[env] APP_ENC_KEY set =", ok("APP_ENC_KEY"),
    "JWT_SECRET set =", ok("JWT_SECRET"),
    "MONGODB_URI set =", ok("MONGODB_URI"),
    "OPENAI_API_KEY set =", ok("OPENAI_API_KEY")
  );

  assertSafeJwtConfig();
}
