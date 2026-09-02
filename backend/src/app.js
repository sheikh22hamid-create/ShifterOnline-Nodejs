const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const userRoutes = require("./routes/user.routes");
const orderRoutes = require("./routes/orderRoutes");
const riderRoutes = require("./routes/riderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const logger = require("./utils/logger");

const app = express();

app.use(cors());
app.use(express.json());

// The dispatch simulator lives at "/" (public/index.html) — a dev/testing
// tool with no auth of its own (it can create real orders and toggle real
// riders online/offline). Deliberately served in every environment,
// including production, per explicit product decision (2026-08-26) — see
// memory/order_dispatch_auth_gap.md.
app.use(express.static(path.join(__dirname, "..", "public")));

// KYC/vehicle/category document images — legacy PHP DB rows store paths
// like "images/vehicle/x.jpg" (already including the "images/" segment),
// so the mounted folder must be the *parent* of "images" (not "images"
// itself) and mounted at "/", not "/images", or every URL would need a
// stripped-prefix rewrite. LEGACY_IMAGES_DIR is not present in this repo —
// point it at wherever the legacy PHP public_html/admin folder actually
// lives (locally or a synced copy); until then this mount is a safe no-op.
const legacyImagesDir = process.env.LEGACY_IMAGES_DIR || path.join(__dirname, "..", "..", "..", "php backend", "public_html", "admin");
if (fs.existsSync(legacyImagesDir)) {
  app.use(express.static(legacyImagesDir));
  logger.info(`Serving legacy document images from ${legacyImagesDir}`);
} else {
  logger.warn(`LEGACY_IMAGES_DIR not found (${legacyImagesDir}) — KYC document image previews will 404 until this is set.`);
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const locationRoutes = require("./routes/locationRoutes");

app.use("/api/users", userRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/rider", riderRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/v1/admin", adminRoutes);

// Safety net beyond each controller's own try/catch — never leak stack traces.
app.use((err, req, res, next) => {
  logger.error("Unhandled Express error:", err);
  res.status(500).json({ Result: false, msg: "Internal server error" });
});

module.exports = app;
