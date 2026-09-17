const { v2: cloudinary } = require("cloudinary");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

// Single storage layer for every file upload this backend handles (KYC
// documents, vehicle/bank photos, bill uploads, kit images, order photos,
// profile pictures, legacy pre-migration images). Render's own disk is
// ephemeral — anything written to backend/public/images at runtime is lost
// on the next deploy/restart — so Cloudinary is the actual durable store.
//
// Every DB column that holds one of these paths already stores a relative
// string like "images/vehicle/169999.jpg" (that convention predates this
// file, inherited from the PHP backend), and two already-deployed clients
// construct the display URL themselves by blindly concatenating
// `baseUrl + "/" + storedPath` (ShifterDriver's ProfileActivity.java, and
// by extension anywhere else in that app doing the same) — they do NOT
// check whether the stored value is already an absolute URL. Switching to
// storing raw Cloudinary URLs would silently break every such call site
// with no way to fix already-installed app builds.
//
// So the relative-path convention is kept as the DB format, unchanged.
// Cloudinary's public_id is set to exactly that relative path (Cloudinary
// treats "/" in a public_id as folder structure, so this "just works" as
// a 1:1 mapping with zero extra bookkeeping). app.js registers a
// `GET /images/*` route (imageRedirect below) that recomputes the
// Cloudinary URL from the requested path and 302-redirects to it — so
// every existing caller (old app binaries included) keeps working
// unmodified, whether the file was uploaded before or after this change.

// Optional folder prefix so a non-production deployment (e.g. the dev VPS
// site) uploads under its own Cloudinary folder instead of mixing into the
// same paths production uses. Left unset in production, so its public_ids
// stay exactly as before (already-uploaded assets keep resolving).
const FOLDER_PREFIX = (process.env.CLOUDINARY_FOLDER_PREFIX || "").replace(/^\/+|\/+$/g, "");
function withPrefix(publicId) {
  return FOLDER_PREFIX ? `${FOLDER_PREFIX}/${publicId}` : publicId;
}

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return false;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
  return true;
}

function isConfigured() {
  return ensureConfigured();
}

// "images/vehicle/169999.jpg" -> { publicId: "images/vehicle/169999", format: "jpg" }
function splitPath(relativePath) {
  const clean = relativePath.replace(/^\/+/, "");
  const dot = clean.lastIndexOf(".");
  if (dot <= 0) return { publicId: clean, format: null };
  return { publicId: clean.slice(0, dot), format: clean.slice(dot + 1).toLowerCase() };
}

const IMAGE_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic"]);
// PDFs (e.g. a UPI screenshot saved as PDF) go up as "raw" so Cloudinary
// stores the exact bytes instead of trying to rasterize them as an image.
function resourceTypeFor(format) {
  return IMAGE_FORMATS.has(format) ? "image" : "raw";
}

/**
 * Uploads a buffer under the given relative path (e.g. "images/vehicle/169999123.jpg")
 * and returns that same relative path unchanged, so callers store it in the
 * DB exactly as before. Falls back to writing the file to backend/public
 * (the pre-Cloudinary behavior) when Cloudinary isn't configured, so local
 * dev without credentials still works.
 */
async function uploadBuffer(buffer, relativePath) {
  if (ensureConfigured()) {
    const { publicId, format } = splitPath(relativePath);
    const resourceType = resourceTypeFor(format);
    const mime = resourceType === "image" ? `image/${format || "jpeg"}` : "application/octet-stream";
    await cloudinary.uploader.upload(`data:${mime};base64,${buffer.toString("base64")}`, {
      public_id: withPrefix(publicId),
      format: format || undefined,
      resource_type: resourceType,
      overwrite: true,
    });
    return relativePath;
  }

  const publicDir = path.join(__dirname, "..", "..", "public");
  const absPath = path.join(publicDir, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, buffer);
  logger.warn(`cloudinaryStorage: CLOUDINARY_* env vars not set — wrote ${relativePath} to local disk (not durable in production).`);
  return relativePath;
}

/** The actual Cloudinary delivery URL for a stored relative path, or null if not configured/not resolvable. */
function urlForRelativePath(relativePath) {
  if (!ensureConfigured()) return null;
  const { publicId, format } = splitPath(relativePath);
  if (!format) return null;
  return cloudinary.url(withPrefix(publicId), { secure: true, format, resource_type: resourceTypeFor(format) });
}

/**
 * Express handler for `GET /images/*` — redirects to the Cloudinary URL
 * for the requested relative path. Registered only when Cloudinary is
 * configured (see app.js); otherwise the existing local-disk static
 * mounts handle these paths exactly as before.
 */
function imageRedirect(req, res, next) {
  const relativePath = `images${req.path}`; // req.path already starts with "/"
  const url = urlForRelativePath(relativePath);
  if (!url) return next();
  return res.redirect(302, url);
}

module.exports = { isConfigured, uploadBuffer, urlForRelativePath, imageRedirect, splitPath };
