const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const userRoutes = require("./routes/user.routes");
const orderRoutes = require("./routes/orderRoutes");
const riderRoutes = require("./routes/riderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const logger = require("./utils/logger");
const cloudinaryStorage = require("./utils/cloudinaryStorage");

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Every uploaded file (KYC docs, vehicle/bank photos, bill uploads, kit
// images, order photos, profile pictures) now lives in Cloudinary, not on
// this server's disk (Render's disk is ephemeral — see
// utils/cloudinaryStorage.js's header comment for why the DB still stores
// plain relative paths like "images/vehicle/x.jpg" rather than full
// Cloudinary URLs). This redirects any such request to the real file.
if (cloudinaryStorage.isConfigured()) {
  app.use("/images", cloudinaryStorage.imageRedirect);
  logger.info("Serving /images/* via Cloudinary redirect");
} else {
  logger.warn("CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET not set — /images/* falls back to local disk, which is NOT durable in production.");
}

// KYC/vehicle/category document images — legacy PHP DB rows store paths
// like "images/vehicle/x.jpg" (already including the "images/" segment),
// so the mounted folder must be the *parent* of "images" (not "images"
// itself) and mounted at "/", not "/images", or every URL would need a
// stripped-prefix rewrite. LEGACY_IMAGES_DIR is not present in this repo —
// point it at wherever the legacy PHP public_html/admin folder actually
// lives (locally or a synced copy). Only a fallback now that the Cloudinary
// redirect above (and the legacy-image migration script) cover the same
// paths from durable storage; kept for any file the migration missed.
const legacyImagesDir = process.env.LEGACY_IMAGES_DIR || path.join(__dirname, "..", "..", "..", "php backend", "public_html", "admin");
if (fs.existsSync(legacyImagesDir)) {
  app.use(express.static(legacyImagesDir));
  logger.info(`Serving legacy document images from ${legacyImagesDir}`);
} else if (!cloudinaryStorage.isConfigured()) {
  logger.warn(`LEGACY_IMAGES_DIR not found (${legacyImagesDir}) — KYC document image previews will 404 until this is set.`);
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const locationRoutes = require("./routes/locationRoutes");

const whatsappRoutes = require("./routes/whatsappRoutes");

app.use("/api/users", userRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/rider", riderRoutes);
app.use("/rider", riderRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/whatsapp", whatsappRoutes);

// Safety net beyond each controller's own try/catch — never leak stack traces.
app.use((err, req, res, next) => {
  logger.error("Unhandled Express error:", err);
  res.status(500).json({ Result: false, msg: "Internal server error" });
});

module.exports = app;
