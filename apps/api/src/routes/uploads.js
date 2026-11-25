import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { uploadRateLimit } from "../middleware/rateLimit.js";
import { auditFailure, auditSuccess } from "../services/auditLog.js";
import { createImageUploadMiddleware, createPostImageStorage, resolvePostUploadConfig } from "../services/postImageStorage.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

const router = Router();
const config = resolvePostUploadConfig();
const upload = createImageUploadMiddleware({ ...config, fieldName: "file" });
const storage = createPostImageStorage(config);

router.post("/", authenticate, uploadRateLimit, upload, async (req, res) => {
  try {
    if (!req.file) return sendError(res, { statusCode: 400, message: "File is required", errors: [{ code: "missing_file", message: "File is required" }] });
    const saved = await storage.writeValidatedImage(req.file);
    await auditSuccess(req, "upload.file", {
      target_type: "upload",
      target_id: saved.filename,
      metadata: { filename: saved.filename, mimetype: req.file.mimetype, size: req.file.size },
    });
    return sendSuccess(res, { data: saved, message: "File uploaded" });
  } catch (error) {
    await auditFailure(req, "upload.file", { target_type: "upload", metadata: { reason: error?.code || "upload_failed" } });
    const code = error?.code || "upload_failed";
    return sendError(res, { statusCode: 400, message: "Unable to upload file", errors: [{ code, message: "Unable to upload file" }] });
  }
});

export default router;
