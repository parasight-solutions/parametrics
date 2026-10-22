import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Post image uploads (S2-33).
//
// Every upload today is Google Business Profile post media: Google fetches it
// without credentials, so stored files are intentionally public and are served
// under unguessable random names. Nothing private is written here.
//
// New files go to UPLOAD_DIR (absolute, outside the checkout; required outside
// NODE_ENV=development/test). Legacy files under the old in-checkout
// `uploads/` directories stay readable at the same /uploads/<name> URLs and are
// never moved or deleted automatically.

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

const PRODUCTION_BLOCKED_ROOTS = Object.freeze(["/", "/tmp", "/var/tmp"]);
const WRITE_CHECK_FILENAME = ".parametrics-upload-writable-check";

// Raster images only. Never SVG/HTML or anything a browser would execute.
export const SERVABLE_IMAGE_TYPES = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
});

function isLocalNodeEnv(env) {
  const value = String(env?.NODE_ENV ?? "").trim().toLowerCase();
  return value === "development" || value === "test";
}

function defaultRepoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // uploadStorage.js lives at apps/api/src/services -> up 4 levels to repo root.
  return path.resolve(here, "../../../..");
}

function isPathInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isBlockedProductionRoot(absRoot) {
  return PRODUCTION_BLOCKED_ROOTS.some(
    (blocked) => absRoot === blocked || (blocked !== "/" && absRoot.startsWith(`${blocked}/`))
  );
}

function configError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function legacyUploadDirs({ repoRoot = defaultRepoRoot(), cwd = process.cwd() } = {}) {
  return [
    ...new Set([
      path.join(repoRoot, "uploads"),
      path.join(repoRoot, "apps", "api", "uploads"),
      path.resolve(cwd, "uploads"),
    ]),
  ];
}

export function validateUploadConfig({
  env = process.env,
  repoRoot = defaultRepoRoot(),
  cwd = process.cwd(),
  fsImpl = fsSync,
} = {}) {
  const production = !isLocalNodeEnv(env);
  const raw = String(env?.UPLOAD_DIR ?? "").trim();
  const legacyDirs = legacyUploadDirs({ repoRoot, cwd });

  let dir;
  if (!raw) {
    if (production) {
      throw configError("upload_config_missing_dir", "UPLOAD_DIR is required outside NODE_ENV=development or test");
    }
    dir = path.join(os.tmpdir(), "parametrics", "uploads");
  } else {
    if (!path.isAbsolute(raw)) {
      throw configError("upload_config_relative_dir", "UPLOAD_DIR must be an absolute path");
    }
    dir = path.resolve(raw);
    if (production && isBlockedProductionRoot(dir)) {
      throw configError("upload_config_blocked_dir", "UPLOAD_DIR resolves to a non-persistent system path in production");
    }
    if (isPathInside(repoRoot, dir)) {
      throw configError("upload_config_inside_repo", "UPLOAD_DIR must resolve outside the project root");
    }
  }

  try {
    fsImpl.mkdirSync(dir, { recursive: true, mode: 0o750 });
  } catch {
    throw configError("upload_config_mkdir_failed", "UPLOAD_DIR could not be created");
  }
  if (!fsImpl.statSync(dir).isDirectory()) {
    throw configError("upload_config_path_is_file", "UPLOAD_DIR resolves to a file, not a directory");
  }
  const probe = path.join(dir, WRITE_CHECK_FILENAME);
  try {
    fsImpl.writeFileSync(probe, Buffer.from("ok"));
    fsImpl.unlinkSync(probe);
  } catch {
    throw configError("upload_config_not_writable", "UPLOAD_DIR is not writable by the runtime user");
  }

  return Object.freeze({
    dir,
    configured: !!raw,
    production,
    legacyDirs: Object.freeze(legacyDirs.filter((d) => d !== dir)),
    safeDirLabel: raw ? `<upload-dir>/${path.basename(dir)}` : "<os-tmpdir>/parametrics/uploads",
  });
}

// Content check by magic bytes; the client's MIME type and filename are ignored.
export function sniffImageType(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: ".jpg", contentType: "image/jpeg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= png.length && png.every((v, i) => b[i] === v)) {
    return { ext: ".png", contentType: "image/png" };
  }
  return null;
}

export async function storeUpload({ dir, buffer, ext, randomName = () => crypto.randomBytes(16).toString("hex") }) {
  await fs.mkdir(dir, { recursive: true, mode: 0o750 });
  const filename = `${randomName()}${ext}`;
  await fs.writeFile(path.join(dir, filename), buffer, { flag: "wx", mode: 0o640 });
  return { filename };
}

// Request path -> safe relative name, or null. Accepts "<name>" and the legacy
// "generated/<name>" layout; rejects traversal, dotfiles, control characters
// and any extension that is not a raster image.
export function resolveServableUploadPath(requestPath) {
  let rel;
  try {
    rel = decodeURIComponent(String(requestPath || "").replace(/^\/+/, ""));
  } catch {
    return null;
  }
  const parts = rel.split("/");
  if (parts.length > 2 || (parts.length === 2 && parts[0] !== "generated")) return null;
  const name = parts[parts.length - 1];
  if (!name || name.length > 255 || name.startsWith(".") || /[\\\x00-\x1f\x7f]/.test(name)) return null;
  const contentType = SERVABLE_IMAGE_TYPES[path.extname(name).toLowerCase()];
  if (!contentType) return null;
  return { rel: parts.join("/"), contentType };
}

export function createUploadStaticHandler({ getDirs }) {
  return async function uploadStatic(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const target = resolveServableUploadPath(req.path);
    if (target) {
      for (const dir of getDirs()) {
        const full = path.resolve(dir, target.rel);
        if (!isPathInside(dir, full)) continue;
        try {
          const st = await fs.stat(full);
          if (!st.isFile()) continue;
        } catch {
          continue;
        }
        res.set({
          "Content-Type": target.contentType,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          // Public by design: Google and other origins fetch post media.
          "Cross-Origin-Resource-Policy": "cross-origin",
          "Cache-Control": "public, max-age=3600",
        });
        return res.sendFile(full, { dotfiles: "deny", lastModified: true }, (err) => {
          if (err && !res.headersSent) res.status(404).json({ error: { code: "not_found" } });
        });
      }
    }
    return res.status(404).json({ error: { code: "not_found" } });
  };
}
