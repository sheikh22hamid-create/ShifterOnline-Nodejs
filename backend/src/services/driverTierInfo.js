// Per-tier info content shown in the driver app's tier cards and info
// popup. Stored on tbl_package.driver_info_sections as a JSON array of
// { heading, body }; array order is display order. Admin input is
// untrusted, so normalizeInfoSections validates on the way in, while
// parseInfoSections is deliberately total - a row with junk in it must
// degrade to "no sections" rather than break the whole tier list.

const MAX_SECTIONS = 12;
const MAX_HEADING_LENGTH = 120;
const MAX_BODY_LENGTH = 2000;

class InvalidSectionsError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidSectionsError";
  }
}

function normalizeInfoSections(input) {
  if (input === undefined || input === null) return null;

  let arr = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
      arr = JSON.parse(trimmed);
    } catch (e) {
      throw new InvalidSectionsError("driver_info_sections must be valid JSON");
    }
  }

  if (!Array.isArray(arr)) {
    throw new InvalidSectionsError("driver_info_sections must be an array of sections");
  }
  if (arr.length > MAX_SECTIONS) {
    throw new InvalidSectionsError(`driver_info_sections cannot have more than ${MAX_SECTIONS} sections`);
  }

  const out = [];
  for (const raw of arr) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new InvalidSectionsError("each section must be an object with a heading and a body");
    }
    const rawHeading = raw.heading === undefined || raw.heading === null ? "" : raw.heading;
    const rawBody = raw.body === undefined || raw.body === null ? "" : raw.body;
    if (typeof rawHeading !== "string" || typeof rawBody !== "string") {
      throw new InvalidSectionsError("section heading and body must be strings");
    }

    const heading = rawHeading.trim();
    const body = rawBody.trim();
    if (!heading && !body) continue;

    if (heading.length > MAX_HEADING_LENGTH) {
      throw new InvalidSectionsError(`section heading cannot exceed ${MAX_HEADING_LENGTH} characters`);
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new InvalidSectionsError(`section body cannot exceed ${MAX_BODY_LENGTH} characters`);
    }
    out.push({ heading, body });
  }

  return out.length ? JSON.stringify(out) : null;
}

function parseInfoSections(stored) {
  if (!stored) return [];

  let arr = stored;
  if (typeof stored === "string") {
    try {
      arr = JSON.parse(stored);
    } catch (e) {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];

  return arr
    .filter((s) => s !== null && typeof s === "object" && !Array.isArray(s))
    .map((s) => ({
      heading: typeof s.heading === "string" ? s.heading : "",
      body: typeof s.body === "string" ? s.body : "",
    }))
    .filter((s) => s.heading || s.body);
}

module.exports = {
  normalizeInfoSections,
  parseInfoSections,
  InvalidSectionsError,
  MAX_SECTIONS,
  MAX_HEADING_LENGTH,
  MAX_BODY_LENGTH,
};
