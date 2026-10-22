import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createUploadsRouter } from "./uploads.js";
import {
  createUploadStaticHandler,
  resolveServableUploadPath,
  sniffImageType,
  validateUploadConfig,
} from "../services/uploadStorage.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { signJwt } from "../lib/jwt.js";

const TEST_JWT_SECRET = "s2-33-uploads-test-secret-0123456789abcdef";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

function withJwtSecret(fn) {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return Promise.resolve(fn()).finally(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });
}

const createdDirs = [];
after(async () => {
  await Promise.all(createdDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `s2-33-${prefix}-`));
  createdDirs.push(dir);
  return dir;
}

// user_a may operate location loc_a; everything else is refused like the real
// helper does (404 for unknown/unowned, 403 for insufficient role).
async function fakeLocationAccess({ userId, locationId, allowedRoles }) {
  assert.deepEqual(allowedRoles, ["owner", "admin", "manager"]);
  if (userId === "user_a" && locationId === "loc_a") return { location: { id: "loc_a" } };
  if (userId === "user_viewer" && locationId === "loc_a") {
    throw Object.assign(new Error("role required"), { status: 403, code: "organization_role_required" });
  }
  throw Object.assign(new Error("location not found"), { status: 404, code: "not_found" });
}

async function withUploadApp({ uploadDir, legacyDir, maxBytes }, fn) {
  const { default: express } = await import("express");
  const audits = [];
  const app = express();
  app.use(
    "/uploads",
    createUploadStaticHandler({ getDirs: () => [uploadDir, legacyDir].filter(Boolean) })
  );
  app.use(
    "/api/v1/uploads",
    createUploadsRouter({
      uploadDir,
      rateLimit: createRateLimiter({ action: "upload", max: 100, windowSeconds: 600, store: new Map() }),
      requireLocationAccess: fakeLocationAccess,
      audit: {
        success: async (_req, action, details) => audits.push(["success", action, details]),
        failure: async (_req, action, details) => audits.push(["failure", action, details]),
      },
      publicBase: () => "http://api.test",
      maxBytes,
    })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    await fn({ base: `http://127.0.0.1:${port}`, audits });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function form(buffer, name = "photo.png", type = "image/png") {
  const fd = new FormData();
  fd.append("file", new Blob([buffer], { type }), name);
  return fd;
}

function upload(base, { token, locationId = "loc_a", body = form(PNG) } = {}) {
  const qs = locationId === null ? "" : `?locationId=${encodeURIComponent(locationId)}`;
  return fetch(`${base}/api/v1/uploads${qs}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
  });
}

test("unauthenticated uploads are refused and nothing is written", async () => {
  const uploadDir = await tempDir("up");
  await withUploadApp({ uploadDir }, async ({ base }) => {
    assert.equal((await upload(base)).status, 401);
    const res = await fetch(`${base}/api/v1/uploads?locationId=loc_a&t=whatever`, { method: "POST", body: form(PNG) });
    assert.equal(res.status, 401);
  });
  assert.deepEqual(await fs.readdir(uploadDir), []);
});

test("ownership: another user's or an unknown location is refused before parsing", async () => {
  const uploadDir = await tempDir("up");
  await withJwtSecret(async () => {
    await withUploadApp({ uploadDir }, async ({ base }) => {
      const otherUser = signJwt({ user_id: "user_b" });
      const viewer = signJwt({ user_id: "user_viewer" });
      const owner = signJwt({ user_id: "user_a" });

      const cross = await upload(base, { token: otherUser });
      assert.equal(cross.status, 404);
      assert.equal((await cross.json()).error.code, "not_found");

      const role = await upload(base, { token: viewer });
      assert.equal(role.status, 403);
      assert.equal((await role.json()).error.code, "organization_role_required");

      const missing = await upload(base, { token: owner, locationId: null });
      assert.equal(missing.status, 400);
      assert.equal((await missing.json()).error.code, "location_required");
    });
  });
  assert.deepEqual(await fs.readdir(uploadDir), []);
});

test("valid PNG and JPEG uploads get random server-side names; client names are ignored", async () => {
  const uploadDir = await tempDir("up");
  await withJwtSecret(async () => {
    await withUploadApp({ uploadDir }, async ({ base, audits }) => {
      const token = signJwt({ user_id: "user_a" });
      const png = await upload(base, { token, body: form(PNG, "../../etc/passport scan.png") });
      assert.equal(png.status, 200);
      const pngBody = await png.json();
      assert.match(pngBody.filename, /^[0-9a-f]{32}\.png$/);
      assert.equal(pngBody.url, `http://api.test/uploads/${pngBody.filename}`);

      // Client says PNG; bytes say JPEG. Bytes win.
      const jpg = await upload(base, { token, body: form(JPEG, "x.png", "image/png") });
      assert.match((await jpg.json()).filename, /^[0-9a-f]{32}\.jpg$/);

      const success = audits.find(([kind]) => kind === "success");
      assert.equal(success[2].location_id, "loc_a");
      assert.ok(!JSON.stringify(audits).includes("passport"), "original filename is not recorded");

      // Uploaded file is publicly served with safe headers (Google fetches it).
      const served = await fetch(`${base}/uploads/${pngBody.filename}`);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), "image/png");
      assert.equal(served.headers.get("x-content-type-options"), "nosniff");
      assert.match(served.headers.get("content-security-policy"), /sandbox/);
      assert.equal(Buffer.compare(Buffer.from(await served.arrayBuffer()), PNG), 0);
    });
  });
  const names = await fs.readdir(uploadDir);
  assert.equal(names.length, 2);
  assert.ok(names.every((n) => /^[0-9a-f]{32}\.(png|jpg)$/.test(n)));
});

test("SVG, HTML and disguised files are rejected with 415", async () => {
  const uploadDir = await tempDir("up");
  await withJwtSecret(async () => {
    await withUploadApp({ uploadDir }, async ({ base }) => {
      const token = signJwt({ user_id: "user_a" });
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const html = Buffer.from("<html><script>alert(1)</script></html>");
      for (const body of [form(svg, "a.svg", "image/svg+xml"), form(html, "a.html", "text/html"), form(html, "a.png")]) {
        const res = await upload(base, { token, body });
        assert.equal(res.status, 415);
        assert.equal((await res.json()).error.code, "unsupported_media_type");
      }
    });
  });
  assert.deepEqual(await fs.readdir(uploadDir), []);
});

test("oversized files get 413 and extra parts are refused", async () => {
  const uploadDir = await tempDir("up");
  await withJwtSecret(async () => {
    await withUploadApp({ uploadDir, maxBytes: 1024 }, async ({ base }) => {
      const token = signJwt({ user_id: "user_a" });
      const big = Buffer.concat([PNG, Buffer.alloc(4096)]);
      const tooBig = await upload(base, { token, body: form(big) });
      assert.equal(tooBig.status, 413);
      assert.equal((await tooBig.json()).error.code, "file_too_large");

      const two = new FormData();
      two.append("file", new Blob([PNG]), "a.png");
      two.append("file", new Blob([PNG]), "b.png");
      assert.equal((await upload(base, { token, body: two })).status, 400);
    });
  });
  assert.deepEqual(await fs.readdir(uploadDir), []);
});

test("legacy in-checkout images stay reachable; active content and traversal do not", async () => {
  const uploadDir = await tempDir("up");
  const legacyDir = await tempDir("legacy");
  await fs.writeFile(path.join(legacyDir, "1770385064097-Untitled.jpeg"), JPEG);
  await fs.writeFile(path.join(legacyDir, "1770000000000-My Photo.png"), PNG);
  await fs.writeFile(path.join(legacyDir, "1770000000001-evil.html"), "<script>alert(1)</script>");
  await fs.writeFile(path.join(legacyDir, "1770000000002-evil.svg"), "<svg/>");
  await fs.writeFile(path.join(legacyDir, ".env"), "SECRET=1");
  await fs.mkdir(path.join(legacyDir, "generated"));
  await fs.writeFile(path.join(legacyDir, "generated", "gen.png"), PNG);

  await withUploadApp({ uploadDir, legacyDir }, async ({ base }) => {
    const legacy = await fetch(`${base}/uploads/1770385064097-Untitled.jpeg`);
    assert.equal(legacy.status, 200);
    assert.equal(legacy.headers.get("content-type"), "image/jpeg");
    assert.equal(legacy.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`${base}/uploads/1770000000000-My%20Photo.png`)).status, 200);
    assert.equal((await fetch(`${base}/uploads/generated/gen.png`)).status, 200);

    for (const p of [
      "1770000000001-evil.html",
      "1770000000002-evil.svg",
      ".env",
      "",
      "generated/",
      "..%2F..%2Fetc%2Fpasswd",
      "%2e%2e/%2e%2e/etc/hosts.png",
      "other/gen.png",
    ]) {
      const res = await fetch(`${base}/uploads/${p}`);
      assert.equal(res.status, 404, `/uploads/${p} must not be served`);
    }
  });
});

test("resolveServableUploadPath and sniffImageType are strict", () => {
  assert.deepEqual(resolveServableUploadPath("/a.png"), { rel: "a.png", contentType: "image/png" });
  assert.equal(resolveServableUploadPath("/a.svg"), null);
  assert.equal(resolveServableUploadPath("/a.html"), null);
  assert.equal(resolveServableUploadPath("/.hidden.png"), null);
  assert.equal(resolveServableUploadPath("/x/y/z.png"), null);
  assert.equal(resolveServableUploadPath("/%E0%A4%A.png"), null);
  assert.equal(sniffImageType(PNG).contentType, "image/png");
  assert.equal(sniffImageType(JPEG).contentType, "image/jpeg");
  assert.equal(sniffImageType(Buffer.from("GIF89a")), null);
  assert.equal(sniffImageType(null), null);
});

test("validateUploadConfig: external dir required in production, never inside the repo", async () => {
  const repoRoot = await tempDir("repo");
  const external = await tempDir("ext");

  assert.throws(
    () => validateUploadConfig({ env: { NODE_ENV: "production" }, repoRoot }),
    (err) => err.code === "upload_config_missing_dir"
  );
  assert.throws(
    () => validateUploadConfig({ env: { NODE_ENV: "production", UPLOAD_DIR: "uploads" }, repoRoot }),
    (err) => err.code === "upload_config_relative_dir"
  );
  assert.throws(
    () => validateUploadConfig({ env: { NODE_ENV: "production", UPLOAD_DIR: "/tmp/parametrics-uploads" }, repoRoot }),
    (err) => err.code === "upload_config_blocked_dir"
  );
  assert.throws(
    () => validateUploadConfig({ env: { NODE_ENV: "development", UPLOAD_DIR: path.join(repoRoot, "uploads") }, repoRoot }),
    (err) => err.code === "upload_config_inside_repo"
  );

  const dev = validateUploadConfig({ env: { NODE_ENV: "development" }, repoRoot, cwd: repoRoot });
  assert.equal(dev.configured, false);
  assert.ok(!dev.dir.startsWith(repoRoot));
  assert.deepEqual([...dev.legacyDirs], [path.join(repoRoot, "uploads"), path.join(repoRoot, "apps", "api", "uploads")]);

  const ok = validateUploadConfig({ env: { NODE_ENV: "development", UPLOAD_DIR: external }, repoRoot });
  assert.equal(ok.dir, external);
  assert.equal(ok.configured, true);
  assert.ok(!ok.safeDirLabel.includes(external), "label does not expose the full path");
});
