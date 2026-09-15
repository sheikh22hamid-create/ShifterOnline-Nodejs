const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const logger = require("../utils/logger");
const { uploadBuffer } = require("../utils/cloudinaryStorage");

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function generatePhotoFilename(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : ".jpg";
  return `${Date.now()}_${crypto.randomBytes(8).toString("hex")}${safeExt}`;
}

function buildUploadResponse(file) {
  if (!file) {
    return {
      status: 400,
      body: { Result: false, msg: "No image file provided (field name must be 'photo') or file is not an image" },
    };
  }
  return { status: 200, body: { Result: true, path: `images/order_photos/${file.filename}` } };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
}).single("photo");

function uploadOrderPhoto(req, res) {
  upload(req, res, async (err) => {
    if (err) {
      logger.error("uploadOrderPhoto failed:", err);
      return res.status(400).json({ Result: false, msg: err.message || "Upload failed" });
    }
    if (!req.file) {
      const { status, body } = buildUploadResponse(undefined);
      return res.status(status).json(body);
    }
    try {
      const filename = generatePhotoFilename(req.file.originalname);
      await uploadBuffer(req.file.buffer, `images/order_photos/${filename}`);
      const { status, body } = buildUploadResponse({ filename });
      return res.status(status).json(body);
    } catch (uploadErr) {
      logger.error("uploadOrderPhoto failed:", uploadErr);
      return res.status(500).json({ Result: false, msg: "Upload failed" });
    }
  });
}

async function uploadAdminImage(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No image file uploaded" });
  }
  try {
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : ".png";
    const folder = req.body?.folder ? req.body.folder.replace(/[^a-zA-Z0-9_-]/g, "") : "category";
    const filename = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${safeExt}`;
    const relativePath = await uploadBuffer(req.file.buffer, `images/${folder}/${filename}`);
    return res.status(200).json({
      success: true,
      message: "Image uploaded successfully",
      path: relativePath,
    });
  } catch (uploadErr) {
    logger.error("uploadAdminImage failed:", uploadErr);
    return res.status(500).json({ success: false, message: "Image upload failed" });
  }
}

module.exports = { generatePhotoFilename, buildUploadResponse, uploadOrderPhoto, uploadAdminImage };

