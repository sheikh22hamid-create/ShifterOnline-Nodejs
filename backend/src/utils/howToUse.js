// Customer app "How To Use" button. The admin panel supplies the video link; when it is empty or not a web link the
// customer app must still open something that belongs to Shifter Online, never an unrelated video.
// TODO(owner): replace with the official Shifter Online tutorial video once it exists - this is the only place
// on the backend (the apps and the admin panel carry the same fallback).
const DEFAULT_HOW_TO_USE_URL = "https://shifteronline.com";

function resolveHowToUseUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return DEFAULT_HOW_TO_USE_URL;
  try {
    const u = new URL(value);
    if (u.protocol === "http:" || u.protocol === "https:") return value;
  } catch (_e) { /* not a URL */ }
  return DEFAULT_HOW_TO_USE_URL;
}

module.exports = { DEFAULT_HOW_TO_USE_URL, resolveHowToUseUrl };
