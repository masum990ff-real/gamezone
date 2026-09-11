const express = require("express");
const multer = require("multer");
const { getBucket } = require("../config/firebase");
const { ok, fail, authMiddleware } = require("../middleware/auth");
const { uploadLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file && file.mimetype && file.mimetype.startsWith("image/")) return cb(null, true);
    return cb(new Error("Only image files allowed"));
  },
});

router.post("/banner", authMiddleware, uploadLimiter, upload.single("banner"), async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, "No image file provided");
    const safe = (req.file.originalname || "banner").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
    const name = "banners/" + Date.now() + "_" + safe;
    const bucket = getBucket();
    const f = bucket.file(name);
    await f.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
    await f.makePublic();
    return ok(res, { url: f.publicUrl() }, "Uploaded");
  } catch (e) {
    console.error("Banner upload failed:", e.message);
    if (/Only image/.test(e.message)) return fail(res, 400, "Only image files allowed");
    if (/File too large|LIMIT_FILE_SIZE/.test(e.message)) return fail(res, 400, "Image must be under 5MB");
    if (/bucket.*not.*exist|notFound|No such object|404/i.test(e.message || "") || e.code === 404)
      return fail(res, 500, "Storage bucket not found — open Firebase Console → Storage → Get started, and check FIREBASE_STORAGE_BUCKET env on Render");
    return fail(res, 500, "Upload failed: " + (e.message || e));
  }
});

router.use((err, req, res, next) => {
  if (!err) return next();
  if (err.code === "LIMIT_FILE_SIZE") return fail(res, 400, "Image must be under 5MB");
  return fail(res, 400, err.message || "Upload failed");
});

module.exports = router;
