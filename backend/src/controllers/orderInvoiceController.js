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

    const rows = [
      ["Delivery Charge", row.d_charge],
      ["Service Charge", row.service_charge],
      ["Waiting Charge", row.wating_charge],
      ["Extra Mile Charge", row.extra_mile_charge],
      ["Coupon Discount", row.cou_amt ? -Number(row.cou_amt) : 0],
    ]
      .filter(([, v]) => Number(v))
      .map(([label, v]) => `<div class="row-2col" style="margin:6px 0"><span>${esc(label)}</span><strong>₹${Number(v).toFixed(2)}</strong></div>`)
      .join("");

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Invoice - ${esc(bookingId)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f2f4f7; margin: 0; padding: 20px 0; color: #1a1a1a; }
  .invoice-card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 24px 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
  .brand { text-align: center; margin-bottom: 4px; }
  .brand .logo { font-size: 24px; font-weight: 800; }
  hr.dash { border: none; border-top: 1px dashed #ddd; margin: 16px 0; }
  .row-2col { display: flex; justify-content: space-between; }
  .status-badge { text-align: center; padding: 10px; border-radius: 8px; font-weight: 600; margin: 16px 0; font-size: 14px;
    color: ${isGood ? "#1e9e4d" : "#e08e00"}; background: ${isGood ? "#e8f7ee" : "#fff6e5"}; }
  .total-row { display:flex; justify-content:space-between; font-size:16px; font-weight:800; margin-top:14px; }
</style></head>
<body>
  <div class="invoice-card">
    <div class="brand"><div class="logo">Shifter Online</div></div>
    <div class="status-badge">${esc(row.o_status || "Pending")}</div>
    <div class="row-2col"><span>Booking ID</span><strong>${esc(bookingId)}</strong></div>
    <div class="row-2col"><span>Date</span><strong>${esc(orderDate)}</strong></div>
    <div class="row-2col"><span>Payment Method</span><strong>${esc(paymentMethodName)}</strong></div>
    ${riderName ? `<hr class="dash"><div class="row-2col"><span>Driver</span><strong>${esc(riderName)} (★ ${esc(riderRating)})</strong></div><div class="row-2col"><span>Vehicle No.</span><strong>${esc(riderVehicleNo)}</strong></div>` : ""}
    <hr class="dash">
    <div class="row-2col"><span>Pickup</span><strong>${esc(row.paddress)}</strong></div>
    <div class="row-2col" style="margin-top:6px"><span>Drop</span><strong>${esc(row.daddress)}</strong></div>
    <hr class="dash">
    ${rows}
    <div class="total-row"><span>Total Paid</span><span>₹${Number(row.total_dcharge || row.d_charge || 0).toFixed(2)}</span></div>
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
