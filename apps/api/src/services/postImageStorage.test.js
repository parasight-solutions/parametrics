import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPostImageStorage, detectImageType, validateExternalImageUrl } from "./postImageStorage.js";

test("detectImageType recognizes supported magic bytes and rejects spoofed content", () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])).extension, "jpg");
  assert.equal(detectImageType(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])).extension, "png");
  assert.throws(() => detectImageType(Buffer.from("not an image")), /unsupported_image_type/);
});

test("validateExternalImageUrl accepts only absolute http URLs", () => {
  assert.equal(validateExternalImageUrl("https://example.com/a.png"), "https://example.com/a.png");
  assert.throws(() => validateExternalImageUrl("file:///tmp/a"), /invalid_image_url/);
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
