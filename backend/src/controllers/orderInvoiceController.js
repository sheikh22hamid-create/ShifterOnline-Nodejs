const crypto = require("crypto");
const prisma = require("../config/db");
const logger = require("../utils/logger");

// Node port of cust_api/invoice_url_generate.php + invoice.php - a live
// endpoint (queries pkg_order, the current live order table, not
// buy_order) that trackingway.dart still opens via the legacy PHP host.
//
// invoice_url_generate.php had `$SECRET_KEY = "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET"`
// hardcoded verbatim (never actually changed) as the HMAC key signing the
// invoice link, so anyone who read that one string out of the PHP source
// could forge a valid link to any order's invoice. Fixed here: a real env
// var, required, no fallback to a guessable default.
const INVOICE_SECRET_KEY = process.env.INVOICE_SECRET_KEY;
// A signed link with no expiry works forever once generated - if one ever
// leaks (chat, screenshot, forwarded email) it stays a valid way to view
// that order's invoice indefinitely. Links are valid for this long instead.
const INVOICE_LINK_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function signToken(orderId, uid, expiresAt) {
  return crypto.createHash("sha256").update(`${orderId}|${uid}|${expiresAt}|${INVOICE_SECRET_KEY}`).digest("hex");
}

// --- invoice_url_generate.php ---
async function generateInvoiceUrl(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const orderId = Number(req.body?.order_id || 0);
    if (!uid || !orderId) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went Wrong!" });
    }
    if (!INVOICE_SECRET_KEY) {
      logger.error("generateInvoiceUrl: INVOICE_SECRET_KEY is not configured.");
      return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Invoice generation is not configured." });
    }

    const order = await prisma.pkg_order.findFirst({ where: { uid, id: orderId }, select: { id: true } });
    if (!order) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Order not found!" });
    }

    const expiresAt = Date.now() + INVOICE_LINK_TTL_MS;
    const token = signToken(orderId, uid, expiresAt);
    const base = process.env.PUBLIC_BASE_URL || "";
    const invoiceUrl = `${base}/api/order/invoice?order_id=${orderId}&uid=${uid}&exp=${expiresAt}&token=${token}`;

    return res.status(200).json({ invoice_url: invoiceUrl, ResponseCode: "200", Result: "true", ResponseMsg: "Invoice URL generated successfully!" });
  } catch (err) {
    logger.error("generateInvoiceUrl failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- invoice.php --- (renders a simple styled HTML invoice, token-gated)
async function renderInvoice(req, res) {
  const orderId = Number(req.query?.order_id || 0);
  const uid = Number(req.query?.uid || 0);
  const expiresAt = Number(req.query?.exp || 0);
  const token = String(req.query?.token || "");

  const notExpired = expiresAt > 0 && Date.now() <= expiresAt;
  const expected = INVOICE_SECRET_KEY && notExpired ? signToken(orderId, uid, expiresAt) : null;
  const tokenValid =
    expected && token.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));

  if (!tokenValid || orderId <= 0 || uid <= 0) {
    return res.status(400).send("Invalid or expired invoice link.");
  }

  try {
    const row = await prisma.pkg_order.findFirst({ where: { uid, id: orderId } });
    if (!row) return res.status(404).send("Invoice not found.");

    let riderName = "";
    let riderVehicleNo = "";
    let riderRating = "5.0";
    if (row.rid) {
      const rider = await prisma.tbl_rider.findUnique({ where: { id: row.rid } });
      if (rider) {
        riderName = `${rider.first_name || ""} ${rider.last_name || ""}`.trim() || rider.full_name || "";
        riderVehicleNo = rider.vehicle_no || "";
        const rateAgg = await prisma.pkg_order.aggregate({ where: { rid: row.rid, is_rate: 1 }, _avg: { cust_rate: true } });
        if (rateAgg._avg.cust_rate != null) riderRating = Number(rateAgg._avg.cust_rate).toFixed(1);
      }
    }

    let paymentMethodName = "Cash";
    if (row.p_method_id) {
      const pm = await prisma.tbl_payment_list.findUnique({ where: { id: row.p_method_id } });
      if (pm) paymentMethodName = pm.title;
    }

    const bookingId = `SO${String(row.id).padStart(10, "0")}`;
    const orderDate = row.odate ? new Date(row.odate).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";
    const statusRaw = String(row.o_status || "").toLowerCase();
    const isGood = statusRaw === "completed" || statusRaw === "delivered";
    const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

    const initials = (riderName || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("") || "?";

    const charges = [
      ["Delivery charge", row.d_charge],
      ["Service charge", row.service_charge],
      ["Waiting charge", row.wating_charge],
      ["Extra mile charge", row.extra_mile_charge],
      ["Coupon discount", row.cou_amt ? -Number(row.cou_amt) : 0],
    ].filter(([, v]) => Number(v));

    const chargeRows = charges
      .map(([label, v]) => {
        const neg = Number(v) < 0;
        return `<div class="fare-row">
          <span class="fare-label"><i class="dot${neg ? " dot--credit" : ""}"></i>${esc(label)}</span>
          <span class="fare-amt${neg ? " fare-amt--credit" : ""}">${neg ? "-" : ""}₹${Math.abs(Number(v)).toFixed(2)}</span>
        </div>`;
      })
      .join("");

    const total = Number(row.total_dcharge || row.d_charge || 0).toFixed(2);

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Invoice - ${esc(bookingId)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #262220; --ink-muted: #756b62; --ink-faint: #a89e93;
    --paper: #faf9f7; --page: #efece6; --line: #e7e1d8;
    --brand: #c2540a; --brand-soft: #fdf0e6;
    --good: #1e9e4d; --good-soft: #e8f7ee; --warn: #e08e00; --warn-soft: #fff6e5;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'IBM Plex Sans', 'Segoe UI', system-ui, Arial, sans-serif;
    background: var(--page); margin: 0; padding: 28px 14px; color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace; }

  .ticket { max-width: 420px; margin: 0 auto; background: var(--paper); border-radius: 18px;
    box-shadow: 0 1px 2px rgba(38,34,32,0.04), 0 12px 28px rgba(38,34,32,0.08); overflow: hidden; }

  .head { padding: 22px 24px 18px; text-align: center; }
  .head .brand-mark { font-size: 15px; font-weight: 700; letter-spacing: 0.01em; color: var(--ink); }
  .head .brand-mark span { color: var(--brand); }
  .status { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; padding: 5px 14px;
    border-radius: 999px; font-size: 12.5px; font-weight: 600;
    color: ${isGood ? "var(--good)" : "var(--warn)"}; background: ${isGood ? "var(--good-soft)" : "var(--warn-soft)"}; }
  .status i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; }

  .meta { display: flex; justify-content: space-between; padding: 0 24px 20px; font-size: 12.5px; color: var(--ink-muted); }
  .meta strong { display: block; margin-top: 2px; font-size: 13px; color: var(--ink); font-weight: 600; }
  .meta .right { text-align: right; }

  .perf { position: relative; height: 0; border-top: 1.5px dashed var(--line); margin: 0 0; }
  .perf::before, .perf::after { content: ""; position: absolute; top: -10px; width: 20px; height: 20px;
    border-radius: 50%; background: var(--page); }
  .perf::before { left: -10px; } .perf::after { right: -10px; }

  .section { padding: 22px 24px; }
  .section-label { font-size: 11px; font-weight: 600; color: var(--ink-faint); margin-bottom: 14px; }

  .route { position: relative; padding-left: 18px; }
  .route .pin { position: absolute; left: 0; width: 9px; height: 9px; border-radius: 50%; }
  .route .pin--from { top: 3px; background: var(--good); }
  .route .pin--to { bottom: 3px; background: var(--brand); }
  .route .stem { position: absolute; left: 3.5px; top: 13px; bottom: 13px; width: 2px;
    background: linear-gradient(to bottom, var(--good), var(--brand)); opacity: 0.35; }
  .route .stop { font-size: 13.5px; line-height: 1.45; color: var(--ink); margin-bottom: 20px; }
  .route .stop:last-child { margin-bottom: 0; }
  .route .stop-label { display: block; font-size: 11.5px; color: var(--ink-faint); margin-bottom: 2px; }

  .driver { display: flex; align-items: center; gap: 12px; margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); }
  .driver .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--brand-soft); color: var(--brand);
    display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
  .driver .name { font-size: 13.5px; font-weight: 600; color: var(--ink); }
  .driver .sub { font-size: 12px; color: var(--ink-muted); margin-top: 1px; }

  .fare-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; font-size: 13px; }
  .fare-label { display: flex; align-items: center; gap: 8px; color: var(--ink-muted); }
  .fare-label .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--ink-faint); }
  .fare-label .dot--credit { background: var(--good); }
  .fare-amt { font-weight: 500; color: var(--ink); }
  .fare-amt--credit { color: var(--good); }

  .total-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 14px;
    padding: 14px 16px; border-radius: 12px; background: var(--brand-soft); }
  .total-row .label { font-size: 13px; font-weight: 600; color: var(--ink); }
  .total-row .amt { font-size: 19px; font-weight: 600; color: var(--brand); }
  .paid-via { margin-top: 10px; font-size: 12px; color: var(--ink-muted); text-align: right; }

  .footer { text-align: center; padding: 18px 24px 22px; font-size: 12px; color: var(--ink-faint); }
  .footer .thanks { font-size: 13px; color: var(--ink-muted); margin-bottom: 4px; }
</style></head>
<body>
  <div class="ticket">
    <div class="head">
      <div class="brand-mark">Shifter <span>Online</span></div>
      <div class="status"><i></i>${esc(row.o_status || "Pending")}</div>
    </div>
    <div class="meta">
      <div>Booking ID<strong class="mono">${esc(bookingId)}</strong></div>
      <div class="right">Date<strong>${esc(orderDate)}</strong></div>
    </div>

    <div class="perf"></div>

    <div class="section">
      <div class="route">
        <div class="pin pin--from"></div>
        <div class="stem"></div>
        <div class="pin pin--to"></div>
        <div class="stop"><span class="stop-label">Pickup</span>${esc(row.paddress)}</div>
        <div class="stop"><span class="stop-label">Drop</span>${esc(row.daddress)}</div>
      </div>
      ${riderName ? `<div class="driver">
        <div class="avatar">${esc(initials)}</div>
        <div>
          <div class="name">${esc(riderName)}</div>
          <div class="sub">★ ${esc(riderRating)}${riderVehicleNo ? ` · ${esc(riderVehicleNo)}` : ""}</div>
        </div>
      </div>` : ""}
    </div>

    <div class="perf"></div>

    <div class="section">
      <div class="section-label">Fare breakdown</div>
      ${chargeRows || `<div class="fare-row"><span class="fare-label"><i class="dot"></i>Trip fare</span><span class="fare-amt mono">₹${total}</span></div>`}
      <div class="total-row">
        <span class="label">Total paid</span>
        <span class="amt mono">₹${total}</span>
      </div>
      <div class="paid-via">Paid via ${esc(paymentMethodName)}</div>
    </div>

    <div class="footer">
      <div class="thanks">Thanks for riding with Shifter.</div>
      Generated ${esc(generatedAt)}
    </div>
  </div>
</body></html>`;

    res.set("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    logger.error("renderInvoice failed:", err);
    return res.status(500).send("Internal server error");
  }
}

module.exports = { generateInvoiceUrl, renderInvoice };
