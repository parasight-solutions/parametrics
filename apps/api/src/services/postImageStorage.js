import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { isIP } from "node:net";

export const DEFAULT_POST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const codedError = (code, message = code) => Object.assign(new Error(message), { code });

export function detectImageType(buffer) {
  if (buffer?.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extension: "jpg", mime: "image/jpeg" };
  if (buffer?.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { extension: "png", mime: "image/png" };
  if (buffer?.length >= 12 && buffer.subarray(0,4).toString() === "RIFF" && buffer.subarray(8,12).toString() === "WEBP") return { extension: "webp", mime: "image/webp" };
  throw codedError("unsupported_image_type");
}

function isNonPublicIpv4(hostname) {
  const [a, b, c] = hostname.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function isNonPublicIpv6(hostname) {
  const host = hostname.toLowerCase();
  if (host.startsWith("::")) return true;
  if (/^(100:|fc|fd|fe8|fe9|fea|feb|ff)/.test(host) || host.startsWith("2001:db8:")) return true;
  if (host.startsWith("::ffff:")) {
    const tail = host.slice(7);
    if (isIP(tail) === 4) return isNonPublicIpv4(tail);
    const parts = tail.split(":");
    if (parts.length === 2) {
      const left = Number.parseInt(parts[0], 16);
      const right = Number.parseInt(parts[1], 16);
      const mapped = `${left >> 8}.${left & 255}.${right >> 8}.${right & 255}`;
      return isNonPublicIpv4(mapped);
    }
  }
  return false;
}

function isSpecialHostname(hostname) {
  return hostname === "localhost" || hostname.endsWith(".localhost") ||
    [".local", ".internal", ".home", ".lan", ".test", ".invalid"].some((suffix) => hostname.endsWith(suffix));
}

export function validateExternalImageUrl(value) {
  if (!value) return null;
  const original = String(value).trim();
  try {
    const url = new URL(original);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw codedError("image_url_must_be_public_https", "Post images must use a public HTTPS URL without embedded credentials.");
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const ipVersion = isIP(hostname);
    if (isSpecialHostname(hostname) || (ipVersion === 4 && isNonPublicIpv4(hostname)) || (ipVersion === 6 && isNonPublicIpv6(hostname))) {
      throw codedError("image_url_not_public", "Post image URL must not point to localhost, a private network, or a non-public address.");
    }
    return original;
  } catch (error) {
    if (error?.code) throw error;
    throw codedError("invalid_image_url", "Post image URL must be a valid public HTTPS URL.");
  }
}

export async function resolvePostImageSource({ file, imageUrl, storage }) {
  if (!file) return { imageUrl: validateExternalImageUrl(imageUrl), storedFilename: null };

  const stored = await storage.writeValidatedImage(file);
  try {
    return {
      imageUrl: validateExternalImageUrl(stored.url),
      storedFilename: stored.filename,
    };
  } catch (error) {
    await storage.deleteImage(stored.filename).catch(() => {});
    if (["image_url_not_public", "image_url_must_be_public_https"].includes(error?.code)) {
      throw codedError(
        error.code,
        "Uploaded images require publicly accessible HTTPS hosting before they can be published to Google.",
      );
    }
    throw error;
  }
}

export function resolvePostUploadConfig(env = process.env, cwd = process.cwd()) {
  return {
    root: path.resolve(env.POST_UPLOAD_LOCAL_DIR || path.join(cwd, "uploads")),
    publicBaseUrl: String(env.APP_PUBLIC_API_BASE || `http://localhost:${env.PORT || 5050}`).replace(/\/$/, ""),
    maxBytes: Number(env.POST_IMAGE_MAX_BYTES || DEFAULT_POST_IMAGE_MAX_BYTES),
  };
}

export async function validatePostImageStorageConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const config = resolvePostUploadConfig(env, cwd);
  const production = env.NODE_ENV === "production";
  if (production && !env.POST_UPLOAD_LOCAL_DIR) throw codedError("post_upload_config_missing_root");
  if (production && !env.APP_PUBLIC_API_BASE) throw codedError("post_upload_config_missing_public_base");
  if (production) {
    try {
      validateExternalImageUrl(config.publicBaseUrl);
    } catch {
      throw codedError(
        "post_upload_config_invalid_public_base",
        "APP_PUBLIC_API_BASE must be a public HTTPS URL for Google post images.",
      );
    }
  }
  if (!Number.isSafeInteger(config.maxBytes) || config.maxBytes <= 0) throw codedError("post_upload_config_invalid_max_bytes");
  await fs.mkdir(config.root, { recursive: true });
  return { ...config, production, safeRootLabel: `<persistent-root>/${path.basename(config.root)}` };
}

export function createPostImageStorage({ root, publicBaseUrl, maxBytes = DEFAULT_POST_IMAGE_MAX_BYTES }) {
  return {
    async writeValidatedImage(file) {
      if (!file?.buffer?.length || file.buffer.length > maxBytes) throw codedError(file?.buffer?.length ? "image_too_large" : "missing_file");
      const type = detectImageType(file.buffer);
      await fs.mkdir(root, { recursive: true });
      const filename = `${crypto.randomUUID()}.${type.extension}`;
      await fs.writeFile(path.join(root, filename), file.buffer, { flag: "wx" });
      return { filename, url: `${publicBaseUrl}/uploads/${filename}` };
    },
    async deleteImage(filename) {
      if (/^[0-9a-f-]+\.(jpg|png|webp)$/.test(filename || "")) await fs.rm(path.join(root, filename), { force: true });
    },
  };
}

export function createImageUploadMiddleware({ maxBytes = resolvePostUploadConfig().maxBytes, fieldName = "imageFile" } = {}) {
  const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } }).single(fieldName);
  return (req, res, next) => parser(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json({ error: { code: tooLarge ? "image_too_large" : "invalid_upload" } });
  });
}
