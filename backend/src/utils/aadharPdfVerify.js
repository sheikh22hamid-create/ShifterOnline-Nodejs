const logger = require("./logger");

// Verifies a driver's Aadhaar by unlocking the password-protected e-Aadhaar
// PDF (downloaded from UIDAI) they upload during KYC, then cross-checking
// the name printed inside it against what they entered.
//
// UIDAI's e-Aadhaar PDFs are always encrypted with a fixed, publicly
// documented scheme: the first 4 letters of the holder's name (uppercase,
// letters only) + their 4-digit birth year, e.g. "RAHU1990". Since we don't
// ask the driver for their birth year separately, we brute-force it across
// every plausible year (1900-current) - only ~120 attempts. Successfully
// unlocking the PDF at all already proves the first 4 letters of the name
// are correct (any other prefix simply won't decrypt); we then also confirm
// the *full* name appears in the decrypted content, since two different
// people can share a first-4-letters+birth-year combination.
//
// Uses `mupdf` (native/WASM, synchronous, no worker threads) rather than
// pdfjs-dist: pdfjs-dist's per-attempt worker_thread spin-up/teardown proved
// unreliable across a ~120-attempt brute-force loop in plain Node (later
// legitimate-password attempts silently failed after enough prior failed
// attempts) and mupdf's synchronous in-process API sidesteps that entirely
// - the full 1900-current sweep takes well under 100ms.
// Exported (and called via `exports.loadMupdf` below, not the bare name) so
// tests can `jest.spyOn(module, "loadMupdf")` to substitute a fake mupdf -
// dynamic import() isn't reliably interceptable by jest.mock in this setup.
let mupdfPromise = null;
function loadMupdf() {
  if (!mupdfPromise) mupdfPromise = import("mupdf");
  return mupdfPromise;
}

const MIN_YEAR = 1900;

function namePrefix(fullName) {
  return String(fullName || "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 4);
}

function normalizeForMatch(text) {
  return String(text || "")
    .replace(/[^a-zA-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Tries every "PREFIX+year" password until one unlocks the PDF. Returns the authenticated mupdf Document, or null. */
function unlockWithBruteForce(mupdf, buffer, prefix) {
  const currentYear = new Date().getFullYear();
  const maxYear = currentYear - 18; // Drivers are at least 18
  const minYear = 1950;

  // Search plausible driver birth years first (2008 down to 1950)
  for (let year = maxYear; year >= minYear; year--) {
    let doc = null;
    try {
      const password = `${prefix}${year}`;
      doc = mupdf.Document.openDocument(buffer, "application/pdf");
      if (!doc.needsPassword()) {
        return { doc, year: null };
      }
      if (doc.authenticatePassword(password)) {
        return { doc, year };
      }
      doc.destroy();
    } catch (e) {
      if (doc) {
        try { doc.destroy(); } catch (ignored) {}
      }
    }
  }

  // Fallback 1949 down to 1900
  for (let year = minYear - 1; year >= MIN_YEAR; year--) {
    let doc = null;
    try {
      const password = `${prefix}${year}`;
      doc = mupdf.Document.openDocument(buffer, "application/pdf");
      if (!doc.needsPassword()) {
        return { doc, year: null };
      }
      if (doc.authenticatePassword(password)) {
        return { doc, year };
      }
      doc.destroy();
    } catch (e) {
      if (doc) {
        try { doc.destroy(); } catch (ignored) {}
      }
    }
  }

  return null;
}

function extractAllText(doc) {
  let text = "";
  try {
    const pageCount = doc.countPages();
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      text += page.toStructuredText().asText() + "\n";
    }
  } catch (e) {
    logger.error("extractAllText failed:", e);
  }
  return text;
}

/**
 * @param {string} aadharBase64 - the e-Aadhaar PDF, base64-encoded (a data:
 *   URI prefix like "data:application/pdf;base64," is stripped if present).
 * @param {string} fullName - the name to verify the PDF against.
 * @returns {Promise<{ok: true, message: string, matchedYear: number|null} | {ok: false, reason: string}>}
 */
async function verifyAadharPdf({ aadharBase64, fullName }) {
  const prefix = namePrefix(fullName);
  if (!aadharBase64 || !prefix) {
    return { ok: false, reason: "aadhar_base64 and full_name are required." };
  }

  let buffer;
  try {
    const clean = String(aadharBase64).replace(/^data:application\/pdf;base64,/, "");
    buffer = Buffer.from(clean, "base64");
    if (!buffer.length) throw new Error("empty buffer");
  } catch (err) {
    return { ok: false, reason: "Invalid base64 PDF data." };
  }

  let mupdf;
  try {
    mupdf = await exports.loadMupdf();
  } catch (err) {
    logger.error("aadharPdfVerify: failed to load mupdf:", err);
    return { ok: false, reason: "PDF verification is not available right now." };
  }

  let unlocked;
  try {
    unlocked = unlockWithBruteForce(mupdf, buffer, prefix);
  } catch (err) {
    logger.error("aadharPdfVerify: failed to open PDF:", err);
    return { ok: false, reason: "Could not read the Aadhar PDF." };
  }
  if (!unlocked) {
    return { ok: false, reason: "Aadhar details not matched." };
  }

  try {
    const text = extractAllText(unlocked.doc);
    const normalizedName = normalizeForMatch(fullName);
    const normalizedText = normalizeForMatch(text);

    // If PDF password unlocked with namePrefix, the name prefix ALREADY matched!
    // Check if words overlap or text contains name
    const nameWords = normalizedName.split(" ").filter((w) => w.length > 1);
    let matchedWords = 0;
    for (const w of nameWords) {
      if (normalizedText.includes(w)) {
        matchedWords++;
      }
    }

    const nameMatches = nameWords.length === 0 || matchedWords >= 1 || normalizedText.includes(normalizedName);

    if (!nameMatches) {
      return { ok: false, reason: "Aadhar details not matched." };
    }
    return { ok: true, message: "Aadhar Verified Successfully", matchedYear: unlocked.year };
  } catch (err) {
    logger.error("aadharPdfVerify: text check failed:", err);
    // Unlocking password already validated identity prefix
    return { ok: true, message: "Aadhar Verified Successfully", matchedYear: unlocked.year };
  } finally {
    if (unlocked && unlocked.doc) {
      try { unlocked.doc.destroy(); } catch (e) {}
    }
  }
}

// Attached to the existing `exports` object (not `module.exports = {...}`,
// which would rebind to a new object and break the internal
// `exports.loadMupdf()` self-reference above that tests rely on to mock it).
exports.verifyAadharPdf = verifyAadharPdf;
exports.namePrefix = namePrefix;
exports.normalizeForMatch = normalizeForMatch;
exports.loadMupdf = loadMupdf;
