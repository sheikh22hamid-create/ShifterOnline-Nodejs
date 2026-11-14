const crypto = require("crypto");
const logger = require("./logger");

// RazorpayX (payouts) API client. Result shape:
//   { ok: true, ...data } | { ok: false, definitive: boolean, reason: string }
// definitive=true  -> Razorpay rejected the request (4xx, incl. 401/403); safe
//                     to treat as "nothing was created".
// definitive=false -> outcome unknown (network error, timeout, 5xx, unreadable
//                     body, or not configured); caller must not assume failure.

const BASE_URL = "https://api.razorpay.com/v1";
const NOT_CONFIGURED = "RazorpayX is not configured";

function isConfigured() {
  return Boolean(
    process.env.RAZORPAYX_KEY_ID &&
      process.env.RAZORPAYX_KEY_SECRET &&
      process.env.RAZORPAYX_ACCOUNT_NUMBER
  );
}

// Approve also requires the webhook secret: without it payout.processed /
// payout.reversed events are refused and payouts only resolve via the sweeper.
function isWebhookConfigured() {
  return Boolean(process.env.RAZORPAYX_WEBHOOK_SECRET);
}

function toPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAYX_WEBHOOK_SECRET;
  if (!secret || !signature || !rawBody) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// The one rule for "Razorpay genuinely rejected this request" (callers refund
// on definitive). 401/403 = the request was not authenticated / not allowed,
// so it cannot have created anything: definitive whatever the body. 408/409 =
// outcome unknown or same idempotency key in flight, 429 = rate limit; these
// never prove the payout was not made. Any other 4xx must also carry a
// Razorpay error object (a bare 4xx may come from a proxy/WAF).
const AUTH_REJECTED = new Set([401, 403]);
const NON_DEFINITIVE_4XX = new Set([408, 409, 429]);
function isDefinitiveRejection(status, data) {
  if (AUTH_REJECTED.has(status)) return true;
  return status >= 400 && status < 500 && !NON_DEFINITIVE_4XX.has(status) && Boolean(data && data.error);
}

// Single place for auth, timeout and definitive / non-definitive classification.
async function request(label, method, path, { body, headers } = {}) {
  if (!isConfigured()) {
    logger.error(`${label}: RazorpayX env not configured.`);
    return { ok: false, definitive: false, reason: NOT_CONFIGURED };
  }
  const auth = Buffer.from(
    `${process.env.RAZORPAYX_KEY_ID}:${process.env.RAZORPAYX_KEY_SECRET}`
  ).toString("base64");
  let resp;
  try {
    resp = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    logger.error(`${label}: could not reach RazorpayX:`, err);
    return { ok: false, definitive: false, reason: "Could not reach RazorpayX. Try again." };
  }
  let data = null;
  try {
    data = await resp.json();
  } catch (err) {
    logger.error(`${label}: unreadable RazorpayX response (HTTP ${resp.status}):`, err);
  }
  if (!resp.ok) {
    logger.error(`${label}: RazorpayX API error (HTTP ${resp.status}):`, data);
    if (AUTH_REJECTED.has(resp.status)) {
      return { ok: false, definitive: true, reason: "RazorpayX rejected our credentials or permissions" };
    }
    if (isDefinitiveRejection(resp.status, data)) {
      return { ok: false, definitive: true, reason: data.error.description || "RazorpayX rejected the request" };
    }
    return { ok: false, definitive: false, reason: data?.error?.description || "RazorpayX error. Try again." };
  }
  if (!data) {
    return { ok: false, definitive: false, reason: "RazorpayX returned an unreadable response" };
  }
  return { ok: true, data };
}

function missingId(label, r) {
  if (r.data.id) return null;
  logger.error(`${label}: RazorpayX response had no id.`);
  return { ok: false, definitive: false, reason: "RazorpayX returned a response without an id" };
}

async function createContact({ name, mobile, referenceId }) {
  const r = await request("razorpayx.createContact", "POST", "/contacts", {
    body: { name, contact: mobile, type: "vendor", reference_id: referenceId },
  });
  if (!r.ok) return r;
  return missingId("razorpayx.createContact", r) || { ok: true, id: r.data.id };
}

async function createFundAccount({ contactId, method, upiId, accountName, accountNumber, ifsc }) {
  const body =
    method === "upi"
      ? { contact_id: contactId, account_type: "vpa", vpa: { address: upiId } }
      : {
          contact_id: contactId,
          account_type: "bank_account",
          bank_account: { name: accountName, ifsc, account_number: accountNumber },
        };
  const r = await request("razorpayx.createFundAccount", "POST", "/fund_accounts", { body });
  if (!r.ok) return r;
  return missingId("razorpayx.createFundAccount", r) || { ok: true, id: r.data.id };
}

async function createPayout({ fundAccountId, amountRupees, method, referenceId }) {
  const r = await request("razorpayx.createPayout", "POST", "/payouts", {
    headers: { "X-Payout-Idempotency": String(referenceId) },
    body: {
      account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER,
      fund_account_id: fundAccountId,
      amount: toPaise(amountRupees),
      currency: "INR",
      mode: method === "upi" ? "UPI" : "IMPS",
      purpose: "payout",
      queue_if_low_balance: false,
      reference_id: referenceId,
      narration: "Shifter driver payout",
    },
  });
  if (!r.ok) return r;
  const bad = missingId("razorpayx.createPayout", r);
  if (bad) return bad;
  // Only accept a payout that is provably the one we asked for. Anything else
  // is an unknown outcome: the caller keeps the request processing, records
  // the reason and never refunds.
  if (r.data.fund_account_id !== fundAccountId || Number(r.data.amount) !== toPaise(amountRupees)) {
    logger.error(
      `razorpayx.createPayout: response for ${referenceId} did not match the request ` +
        `(sent fund account ${fundAccountId} / ${toPaise(amountRupees)} paise, got ${r.data.fund_account_id} / ${r.data.amount}, payout ${r.data.id}).`
    );
    return {
      ok: false,
      definitive: false,
      reason: `RazorpayX payout ${r.data.id} did not match the request (fund account / amount) — check it in the RazorpayX dashboard`,
    };
  }
  return { ok: true, id: r.data.id, status: r.data.status, utr: r.data.utr ?? null };
}

async function fetchPayout(payoutId) {
  const r = await request("razorpayx.fetchPayout", "GET", `/payouts/${encodeURIComponent(payoutId)}`);
  if (!r.ok) return r;
  const d = r.data;
  return {
    ok: true,
    id: d.id,
    status: d.status,
    utr: d.utr ?? null,
    failureReason: d.status_details?.description ?? d.failure_reason ?? null,
    referenceId: d.reference_id ?? null,
  };
}

module.exports = {
  isConfigured,
  isWebhookConfigured,
  toPaise,
  verifyWebhookSignature,
  createContact,
  createFundAccount,
  createPayout,
  fetchPayout,
};
