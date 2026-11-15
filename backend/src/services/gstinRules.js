// Pure GSTIN rules (spec 2026-11-15): format + checksum validation done locally (free, instant, no provider call for an
// obviously wrong number) and a normalizer that turns a GST provider's answer into one shape. No I/O.
//
// A GSTIN is 15 characters: 2-digit state code + 10-character PAN + entity number (1-9 / A-Z) + "Z" + check character.

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const STATES = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "28": "Andhra Pradesh (before division)",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "97": "Other Territory", "99": "Centre Jurisdiction",
};

/** Upper-case, spaces and dashes removed; null/undefined become "". */
function clean(input) {
  return String(input ?? "").toUpperCase().replace(/[\s-]/g, "");
}

/** The check character the first 14 characters must be followed by (GSTN's mod-36 algorithm). */
function checkChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = CHARS.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/** { ok: true, gstin, stateCode, state, pan } or { ok: false, code, message } - format, state code and check character. */
function validate(input) {
  const gstin = clean(input);
  if (!gstin) return { ok: false, code: "EMPTY", message: "Enter a GSTIN." };
  if (gstin.length !== 15) return { ok: false, code: "LENGTH", message: "A GSTIN has 15 characters." };
  if (!FORMAT.test(gstin)) return { ok: false, code: "FORMAT", message: "This is not a valid GSTIN format." };
  const stateCode = gstin.slice(0, 2);
  if (!STATES[stateCode]) return { ok: false, code: "STATE", message: "The state code in this GSTIN is not valid." };
  if (checkChar(gstin.slice(0, 14)) !== gstin[14]) return { ok: false, code: "CHECKSUM", message: "This GSTIN is not valid (check digit does not match)." };
  return { ok: true, gstin, stateCode, state: STATES[stateCode], pan: gstin.slice(2, 12) };
}

const pick = (obj, keys) => {
  for (const key of keys) {
    const v = obj?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
};

/** The taxpayer object inside a provider response, whichever envelope it uses. */
function unwrap(raw) {
  const candidates = [raw?.taxpayerInfo, raw?.data?.taxpayerInfo, raw?.result?.taxpayerInfo, raw?.data?.data, raw?.data, raw?.result, raw?.response, raw];
  return candidates.find((c) => c && typeof c === "object" && !Array.isArray(c) && (c.lgnm || c.legalName || c.legal_name || c.businessName || c.tradeNam || c.gstin || c.gstIn)) || null;
}

function addressOf(node) {
  const principal = node.pradr || node.principalPlaceAddress || node.principal_place_of_business || {};
  const flat = pick(principal, ["adr", "address"]) || pick(node, ["address", "principal_address", "registered_address"]);
  const parts = principal.addr || principal.address_details || {};
  if (flat) return flat;
  const joined = [
    pick(parts, ["flno"]), pick(parts, ["bno"]), pick(parts, ["bnm"]), pick(parts, ["st"]), pick(parts, ["loc", "locality"]),
    pick(parts, ["dst"]), pick(parts, ["stcd"]), pick(parts, ["pncd", "pincode"]),
  ].filter(Boolean);
  return joined.join(", ");
}

/**
 * One shape from any GSTN-style provider answer (flat, or inside taxpayerInfo / data / result), or null when there is no
 * legal name to show. `active` is false for a cancelled / suspended registration; the caller treats that as not valid.
 */
function normalizeTaxpayer(raw, requestedGstin) {
  const node = unwrap(raw);
  if (!node) return null;
  const legalName = pick(node, ["lgnm", "legalName", "legal_name", "businessName", "business_name", "name"]);
  if (!legalName) return null;
  const gstin = clean(pick(node, ["gstin", "gstIn", "GSTIN"])) || clean(requestedGstin);
  const status = pick(node, ["sts", "status", "gstin_status", "gstStatus", "registrationStatus"]);
  const stateCode = gstin.slice(0, 2);
  const principal = node.pradr || {};
  const addr = principal.addr || {};
  return {
    gstin,
    legal_name: legalName,
    trade_name: pick(node, ["tradeNam", "tradeName", "trade_name"]),
    address: addressOf(node),
    state: STATES[stateCode] || pick(addr, ["stcd"]) || "",
    state_code: STATES[stateCode] ? stateCode : "",
    pincode: pick(addr, ["pncd", "pincode"]),
    status,
    active: status === "" || /^active$/i.test(status),
  };
}

module.exports = { clean, validate, checkChar, normalizeTaxpayer, STATES, FORMAT };
