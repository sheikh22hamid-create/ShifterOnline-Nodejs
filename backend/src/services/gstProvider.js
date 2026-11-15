const logger = require("../utils/logger");
const rules = require("./gstinRules");

// GST verification provider adapter (spec 2026-11-15). The government GST portal has no free public API (it needs a captcha),
// so a GSP / KYC provider (Appyflow, Surepass, Masters India, ClearTax, Vayana, ...) is called. Which one is a deployment
// choice made with environment variables - nothing here is tied to one vendor:
//
//   GST_API_URL      full URL with {gstin} and (optionally) {key} placeholders, e.g. https://provider.example/gst?gstin={gstin}
//   GST_API_KEY      the provider's key / secret (never sent to the apps, never logged)
//   GST_API_METHOD   GET (default) or POST
//   GST_API_HEADERS  optional JSON object of headers; {key} and {gstin} are replaced, e.g. {"x-api-key":"{key}"}
//   GST_API_BODY     optional JSON template for a POST body; {gstin} and {key} are replaced
//   GST_API_TIMEOUT_MS  default 8000
//
// Any answer that follows the GSTN "searchTaxpayer" fields (lgnm, tradeNam, pradr, sts), flat or inside taxpayerInfo /
// data / result, is understood (see gstinRules.normalizeTaxpayer). Without GST_API_URL the lookup simply reports
// "unavailable": the app then says verification is not possible right now and the customer books without GST details.
// A GSTIN is never reported verified unless the provider returned a legal name for it.

const TIMEOUT_DEFAULT_MS = 8000;

function config(env = process.env) {
  const url = String(env.GST_API_URL || "").trim();
  if (!url) return null;
  let headers = {};
  if (env.GST_API_HEADERS) {
    try {
      headers = JSON.parse(env.GST_API_HEADERS);
    } catch (_err) {
      logger.error("gstProvider: GST_API_HEADERS is not valid JSON, ignoring it");
    }
  }
  return {
    url,
    key: String(env.GST_API_KEY || ""),
    method: String(env.GST_API_METHOD || "GET").toUpperCase() === "POST" ? "POST" : "GET",
    headers,
    body: env.GST_API_BODY ? String(env.GST_API_BODY) : "",
    timeoutMs: Number(env.GST_API_TIMEOUT_MS) > 0 ? Number(env.GST_API_TIMEOUT_MS) : TIMEOUT_DEFAULT_MS,
  };
}

const fill = (text, gstin, key, encode) =>
  String(text).replace(/\{gstin\}/g, encode ? encodeURIComponent(gstin) : gstin).replace(/\{key\}/g, encode ? encodeURIComponent(key) : key);

const NOT_FOUND_TEXT = /invalid|not\s*found|does\s*not\s*exist|no\s*record|incorrect/i;

/** Message text a provider put in its answer, for classifying an error body (never shown to the customer). */
function messageOf(body) {
  if (!body || typeof body !== "object") return "";
  return String(body.message || body.error_message || body.error || body.msg || body.status_message || "");
}

/**
 * Looks one (already format-checked) GSTIN up.
 * Resolves { outcome: 'verified', details } | { outcome: 'invalid', reason } | { outcome: 'unavailable', reason }. Never throws.
 */
async function lookup(gstin, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = config(env);
  if (!cfg) return { outcome: "unavailable", reason: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const headers = Object.fromEntries(Object.entries(cfg.headers).map(([k, v]) => [k, fill(v, gstin, cfg.key, false)]));
    const init = { method: cfg.method, headers: { accept: "application/json", ...headers }, signal: controller.signal };
    if (cfg.method === "POST") {
      init.body = cfg.body ? fill(cfg.body, gstin, cfg.key, false) : JSON.stringify({ gstin });
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) init.headers["content-type"] = "application/json";
    }
    const resp = await fetchImpl(fill(cfg.url, gstin, cfg.key, true), init);

    let body = null;
    try {
      body = await resp.json();
    } catch (_err) {
      body = null;
    }

    if (!resp.ok) {
      // 400/404/422: the provider says this GSTIN does not exist. 401/402/403/429/5xx: our account or their service is
      // the problem - never tell the customer their GSTIN is wrong because of that.
      if ([400, 404, 422].includes(resp.status)) return { outcome: "invalid", reason: `http_${resp.status}` };
      logger.error(`gstProvider: provider answered HTTP ${resp.status} (${messageOf(body).slice(0, 120)})`);
      return { outcome: "unavailable", reason: `http_${resp.status}` };
    }

    const details = rules.normalizeTaxpayer(body, gstin);
    if (!details) {
      // A 200 without taxpayer details: the provider's own "not found" convention, or a shape we do not understand.
      if (NOT_FOUND_TEXT.test(messageOf(body)) && !/key|auth|credit|balance|quota|limit/i.test(messageOf(body))) return { outcome: "invalid", reason: "not_found" };
      logger.error(`gstProvider: unreadable provider answer (${messageOf(body).slice(0, 120) || "no message"})`);
      return { outcome: "unavailable", reason: "unreadable" };
    }
    if (details.gstin && details.gstin !== gstin) {
      logger.error("gstProvider: provider answered for a different GSTIN than asked");
      return { outcome: "unavailable", reason: "mismatch" };
    }
    if (!details.active) return { outcome: "invalid", reason: "inactive", details };
    return { outcome: "verified", details: { ...details, gstin } };
  } catch (err) {
    logger.error(`gstProvider: lookup failed (${err.name === "AbortError" ? "timeout" : err.message})`);
    return { outcome: "unavailable", reason: err.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { lookup, config };
