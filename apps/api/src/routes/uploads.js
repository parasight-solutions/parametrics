import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { uploadRateLimit } from "../middleware/rateLimit.js";
import { auditFailure, auditSuccess } from "../services/auditLog.js";
import { createImageUploadMiddleware, createPostImageStorage, resolvePostUploadConfig } from "../services/postImageStorage.js";

const router = Router();
const config = resolvePostUploadConfig();
const upload = createImageUploadMiddleware({ ...config, fieldName: "file" });
const storage = createPostImageStorage(config);

router.post("/", authenticate, uploadRateLimit, upload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: { code: "missing_file" } });
    const saved = await storage.writeValidatedImage(req.file);
    await auditSuccess(req, "upload.file", {
      target_type: "upload",
      target_id: saved.filename,
      metadata: { filename: saved.filename, mimetype: req.file.mimetype, size: req.file.size },
    });
    return res.json(saved);
  } catch (error) {
    await auditFailure(req, "upload.file", { target_type: "upload", metadata: { reason: error?.code || "upload_failed" } });
    return res.status(400).json({ error: { code: error?.code || "upload_failed" } });
  }
});

export default router;
