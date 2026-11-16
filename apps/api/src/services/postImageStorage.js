import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";

export const DEFAULT_POST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const codedError = (code) => Object.assign(new Error(code), { code });

export function detectImageType(buffer) {
  if (buffer?.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extension: "jpg", mime: "image/jpeg" };
  if (buffer?.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { extension: "png", mime: "image/png" };
  if (buffer?.length >= 12 && buffer.subarray(0,4).toString() === "RIFF" && buffer.subarray(8,12).toString() === "WEBP") return { extension: "webp", mime: "image/webp" };
  throw codedError("unsupported_image_type");
}

export function validateExternalImageUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString();
  } catch { throw codedError("invalid_image_url"); }
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
