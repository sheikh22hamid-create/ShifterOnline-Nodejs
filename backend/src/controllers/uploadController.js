const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const logger = require("../utils/logger");

const ORDER_PHOTOS_DIR = path.join(__dirname, "..", "..", "public", "images", "order_photos");
fs.mkdirSync(ORDER_PHOTOS_DIR, { recursive: true });

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ORDER_PHOTOS_DIR),
  filename: (req, file, cb) => cb(null, generatePhotoFilename(file.originalname)),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
}).single("photo");

function uploadOrderPhoto(req, res) {
  upload(req, res, (err) => {
    if (err) {
      logger.error("uploadOrderPhoto failed:", err);
      return res.status(400).json({ Result: false, msg: err.message || "Upload failed" });
    }
    const { status, body } = buildUploadResponse(req.file);
    return res.status(status).json(body);
  });
}

module.exports = { generatePhotoFilename, buildUploadResponse, uploadOrderPhoto, ORDER_PHOTOS_DIR };
