import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const STORAGE_PROVIDER_LOCAL = "local";
export const SUPPORTED_STORAGE_FORMATS = Object.freeze(["pdf", "xlsx"]);

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_BUFFER_BYTES = 25 * 1024 * 1024;

function cleanStr(value, max = 200) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function makeStorageError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

export function getDefaultLocalStorageRoot(env = process.env) {
  const configured = cleanStr(env.REPORT_STORAGE_LOCAL_DIR, 1000);
  if (configured) return configured;
  return path.join(os.tmpdir(), "parametrics", "report-outputs");
}

function validateId(value, label) {
  const v = cleanStr(value, 200);
  if (!v || !ID_PATTERN.test(v) || v === "." || v === "..") {
    throw makeStorageError("report_storage_invalid_id", `${label} is invalid for storage key`);
  }
  return v;
}

function validateFormat(format) {
  const v = cleanStr(format, 20).toLowerCase();
  if (!SUPPORTED_STORAGE_FORMATS.includes(v)) {
    throw makeStorageError("report_storage_unsupported_format", `unsupported storage format: ${format}`);
  }
  return v;
}

function validateFilename(filename) {
  const v = cleanStr(filename, 200);
  if (!v || !FILENAME_PATTERN.test(v) || v.startsWith(".") || v.includes("..")) {
    throw makeStorageError("report_storage_invalid_filename", "filename is invalid for storage write");
  }
  return v;
}

function ymUtc(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return {
    year: String(d.getUTCFullYear()).padStart(4, "0"),
    month: String(d.getUTCMonth() + 1).padStart(2, "0"),
  };
}

export function buildStorageKey({
  organization_id,
  run_id,
  format,
  now = new Date(),
} = {}) {
  const orgId = validateId(organization_id, "organization_id");
  const runId = validateId(run_id, "run_id");
  const fmt = validateFormat(format);
  const { year, month } = ymUtc(now);
  return `report-outputs/${orgId}/${year}/${month}/${runId}.${fmt}`;
}

export function isUnsafeStorageKey(storageKey) {
  if (typeof storageKey !== "string") return true;
  if (!storageKey) return true;
  if (storageKey.startsWith("/")) return true;
  if (storageKey.includes("\\")) return true;
  if (storageKey.includes("\0")) return true;
  if (path.isAbsolute(storageKey)) return true;
  const segments = storageKey.split("/");
  if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) return true;
  return false;
}

function resolveSafePath(root, storageKey) {
  if (isUnsafeStorageKey(storageKey)) {
    throw makeStorageError("report_storage_invalid_key", "unsafe storage key");
  }
  const rootAbs = path.resolve(root);
  const fullPath = path.resolve(rootAbs, storageKey);
  const rel = path.relative(rootAbs, fullPath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw makeStorageError("report_storage_invalid_key", "storage key resolves outside root");
  }
  return fullPath;
}

function sha256Hex(buffer) {
  const hash = crypto.createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

function ensureLocalProvider(provider) {
  if (provider !== STORAGE_PROVIDER_LOCAL) {
    throw makeStorageError(
      "report_storage_unsupported_provider",
      `unsupported storage provider: ${provider}`
    );
  }
}

export function createLocalReportStorage(options = {}) {
  const root = cleanStr(options.root, 1000) || getDefaultLocalStorageRoot(options.env || process.env);
  const fsImpl = options.fs || fs;
  const rootAbs = path.resolve(root);

  async function writeOutput({
    organization_id,
    run_id,
    format,
    content_type,
    filename,
    buffer,
    now = new Date(),
  } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw makeStorageError("report_storage_empty_buffer", "buffer is required for storage write");
    }
    if (buffer.length > MAX_BUFFER_BYTES) {
      throw makeStorageError("report_storage_buffer_too_large", "buffer exceeds storage size cap");
    }

    const contentType = cleanStr(content_type, 200);
    if (!contentType) {
      throw makeStorageError(
        "report_storage_invalid_content_type",
        "content_type is required for storage write"
      );
    }

    const safeFilename = validateFilename(filename);
    const storageKey = buildStorageKey({ organization_id, run_id, format, now });
    const absPath = resolveSafePath(rootAbs, storageKey);

    await fsImpl.mkdir(path.dirname(absPath), { recursive: true });
    await fsImpl.writeFile(absPath, buffer);

    const written = await fsImpl.readFile(absPath);
    const size = written.length;

    return {
      storage_provider: STORAGE_PROVIDER_LOCAL,
      storage_key: storageKey,
      content_type: contentType,
      filename: safeFilename,
      size,
      checksum: { algorithm: "sha256", value: sha256Hex(written) },
      generated_at: now,
      expires_at: null,
    };
  }

  async function readOutput({ storage_provider, storage_key } = {}) {
    ensureLocalProvider(storage_provider);
    const absPath = resolveSafePath(rootAbs, storage_key);
    return fsImpl.readFile(absPath);
  }

  async function statOutput({ storage_provider, storage_key } = {}) {
    ensureLocalProvider(storage_provider);
    const absPath = resolveSafePath(rootAbs, storage_key);
    try {
      const stats = await fsImpl.stat(absPath);
      return { exists: true, size: stats.size };
    } catch (error) {
      if (error?.code === "ENOENT") return { exists: false, size: null };
      throw error;
    }
  }

  async function deleteOutput({ storage_provider, storage_key } = {}) {
    ensureLocalProvider(storage_provider);
    const absPath = resolveSafePath(rootAbs, storage_key);
    try {
      await fsImpl.unlink(absPath);
      return { deleted: true };
    } catch (error) {
      if (error?.code === "ENOENT") return { deleted: false };
      throw error;
    }
  }

  return Object.freeze({
    provider: STORAGE_PROVIDER_LOCAL,
    root: rootAbs,
    writeOutput,
    readOutput,
    statOutput,
    deleteOutput,
  });
}

let defaultStorageInstance = null;

export function getDefaultReportStorage() {
  if (!defaultStorageInstance) {
    defaultStorageInstance = createLocalReportStorage();
  }
  return defaultStorageInstance;
}

export function resetDefaultReportStorageForTests() {
  defaultStorageInstance = null;
}
