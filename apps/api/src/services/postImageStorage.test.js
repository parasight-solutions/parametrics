import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPostImageStorage, detectImageType, resolvePostImageSource, validateExternalImageUrl, validatePostImageStorageConfig } from "./postImageStorage.js";

test("detectImageType recognizes supported magic bytes and rejects spoofed content", () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])).extension, "jpg");
  assert.equal(detectImageType(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])).extension, "png");
  assert.throws(() => detectImageType(Buffer.from("not an image")), /unsupported_image_type/);
});

test("validateExternalImageUrl preserves public HTTPS URLs including query parameters", () => {
  const value = "https://cdn.example.org/image?id=42&format=webp";
  assert.equal(validateExternalImageUrl(value), value);
});

test("validateExternalImageUrl rejects non-HTTPS and credential-bearing URLs", () => {
  for (const value of ["http://example.org/a.jpg", "file:///tmp/a", "https://user:pass@example.org/a.jpg"]) {
    assert.throws(
      () => validateExternalImageUrl(value),
      (error) => error.code === "image_url_must_be_public_https" && /public HTTPS/.test(error.message),
    );
  }
});

test("validateExternalImageUrl rejects localhost and special-use hostnames", () => {
  for (const value of ["https://localhost/a", "https://api.localhost/a", "https://printer.local/a", "https://service.internal/a"]) {
    assert.throws(() => validateExternalImageUrl(value), (error) => error.code === "image_url_not_public");
  }
});

test("validateExternalImageUrl rejects private and non-global IP literals", () => {
  for (const value of [
    "https://127.0.0.1/a", "https://2130706433/a", "https://10.0.0.1/a",
    "https://172.16.0.1/a", "https://192.168.1.1/a", "https://169.254.1.1/a",
    "https://100.64.0.1/a", "https://192.0.2.1/a", "https://[::1]/a",
    "https://[fc00::1]/a", "https://[fe80::1]/a", "https://[::ffff:127.0.0.1]/a",
    "https://[::7f00:1]/a", "https://[100::1]/a",
  ]) {
    assert.throws(() => validateExternalImageUrl(value), (error) => error.code === "image_url_not_public", value);
  }
});

test("storage writes a random validated filename and can clean it up", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "post-image-"));
  const storage = createPostImageStorage({ root, publicBaseUrl: "https://api.example.com" });
  const saved = await storage.writeValidatedImage({ buffer: Buffer.from([0xff,0xd8,0xff,0x00]) });
  assert.match(saved.filename, /^[0-9a-f-]+\.jpg$/);
  assert.equal(saved.url, `https://api.example.com/uploads/${saved.filename}`);
  await storage.deleteImage(saved.filename);
  await assert.rejects(fs.stat(path.join(root, saved.filename)));
  await fs.rm(root, { recursive: true, force: true });
});

test("resolvePostImageSource gives an uploaded file priority over a pasted URL", async () => {
  const writes = [];
  const storage = {
    async writeValidatedImage(file) { writes.push(file); return { filename: "new.png", url: "https://cdn.example.org/new.png" }; },
    async deleteImage() { throw new Error("must not delete valid file"); },
  };
  const result = await resolvePostImageSource({ file: { buffer: Buffer.from("x") }, imageUrl: "https://127.0.0.1/ignored", storage });
  assert.equal(result.imageUrl, "https://cdn.example.org/new.png");
  assert.equal(result.storedFilename, "new.png");
  assert.equal(writes.length, 1);
});

test("resolvePostImageSource deletes a new upload whose generated URL is private", async () => {
  const deleted = [];
  const storage = {
    async writeValidatedImage() { return { filename: "new.png", url: "https://127.0.0.1/uploads/new.png" }; },
    async deleteImage(filename) { deleted.push(filename); },
  };
  await assert.rejects(
    resolvePostImageSource({ file: { buffer: Buffer.from("x") }, imageUrl: null, storage }),
    (error) => error.code === "image_url_not_public" && /publicly accessible HTTPS/.test(error.message),
  );
  assert.deepEqual(deleted, ["new.png"]);
});

test("production upload configuration requires a public HTTPS API base", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "post-image-config-"));
  await assert.rejects(
    validatePostImageStorageConfig({ env: { NODE_ENV: "production", POST_UPLOAD_LOCAL_DIR: root, APP_PUBLIC_API_BASE: "http://127.0.0.1:5050" } }),
    (error) => error.code === "post_upload_config_invalid_public_base",
  );
  const config = await validatePostImageStorageConfig({ env: { NODE_ENV: "production", POST_UPLOAD_LOCAL_DIR: root, APP_PUBLIC_API_BASE: "https://api.example.org" } });
  assert.equal(config.publicBaseUrl, "https://api.example.org");
  await fs.rm(root, { recursive: true, force: true });
});
